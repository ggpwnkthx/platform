# The place where the state of the deployment lives

The state of a deployment holds the value of every secret of the
deployment, so the state is a secret store. This stack creates the
store: an account of Azure Storage that is encrypted at rest, that keeps
the versions of the state, whose shared key is off, and that only the
addresses of the operator reach.

The stack runs once per deployment, before the first apply of the
templates of [`../`](../), and it is the only stack of the platform that
runs without a backend:

```bash
tofu -chdir=deploy/tofu/azure/bootstrap init
tofu -chdir=deploy/tofu/azure/bootstrap apply \
  -var name_prefix=platform -var environment=production \
  -var resource_group_name=platform-production-state \
  -var 'operator_addresses=["203.0.113.4/30"]' \
  -var operator_principal_id=00000000-0000-0000-0000-000000000000 \
  -var subscription_id=00000000-0000-0000-0000-000000000000
```

The state of this stack is local, and it is written in the directory the
tool runs in. The wizard of the deployment copies these templates into
the directory of the files of the deployment
(`deploy/tofu/runtime/<environment>/bootstrap`) and runs them there, so
that the state of the bootstrap — which holds the name of the account of
the state — is not written in the checkout of the templates.

## What the subscription needs

The templates of the deployment do not register the resource providers
of the subscription: registering one is a permission that a deployment
of the platform does not need and does not have. This stack runs as the
operator, and it registers the providers the deployment needs:

```text
Microsoft.App             the container apps and the job of the migration
Microsoft.Cache           the cache of the deployment
Microsoft.Cdn             the edge of the deployment
Microsoft.ContainerRegistry  the registry of the images
Microsoft.DBforPostgreSQL   the database of the deployment
Microsoft.Insights        the workspace of the logs
Microsoft.KeyVault        the vault of the secrets
Microsoft.Network         the network of the deployment and the edge
Microsoft.Storage         the account of the state
```

The registration takes a minute, and the first apply of this stack waits
for it. A subscription that forbids the registration needs the providers
registered by hand, and this stack then refuses to register them.

## Who reads the state

The shared key of the account is off, and the access to the state is a
role of Entra ID: the tool signs its requests with the token of the
operator, and the operator holds the **Storage Blob Data Contributor**
role on the account. This stack grants that role to the identity of the
operator, whose identifier is the value of `operator_principal_id` — the
identity of the `az login` session of the operator:

```bash
az account show --query user.id --output tsv
```

Granting the role needs the permission to grant roles: the operator
holds **Owner** or **User Access Administrator** on the subscription, or
**Role Based Access Control Administrator** on the resource group. The
role reaches the token of the operator a little after it is created, and
the container waits a minute for it. A first apply that is refused
because of it is an apply that is run again.

The value of `operator_principal_id` is empty when the operator is not
known: the stack then creates the account and the container with the
permissions the operator already holds, and a contributor that is not an
owner has to create the container itself.

## The configuration of the backend

The output `backend_config_hcl` is the configuration of the backend of
the deployment. Write it to the runtime directory of the deployment, as
`backend.hcl`:

```bash
mkdir -p deploy/tofu/runtime/production
tofu -chdir=deploy/tofu/azure/bootstrap output -raw backend_config_hcl \
  > deploy/tofu/runtime/production/backend.hcl
```

The configuration carries the name of the file of the state: the key of
the backend is the name of the blob that holds the state, and the tool
asks for it. The shared key of the account is off, and the access to the
state is a role of Entra ID.

The state of **this** stack is local, and it holds the name of the
account of the state of the deployment. It is not committed, and the
directory of the tools is in `.gitignore`.

## The subscription of the place

The place where the state of the deployment lives is created in the
subscription of the deployment, and in no other: `subscription_id` names
it, and the wizard of the deployment writes the subscription it reads at
the sign-in. A value that is empty takes the subscription of the
session of the operator:

```bash
az account show --query id --output tsv
```
