# The deployment of the platform on Azure

The deployment of the gateway, Access, Data and the console on Azure,
written in OpenTofu. The templates are the platform's artifacts and
they are part of the release line of the deployment; the values of one
deployment are in [`../runtime/`](../README.md#the-templates-and-the-files-of-a-deployment).

## What the deployment is made of

| The platform | Azure |
| --- | --- |
| The gateway, Access, Data, the console and the control plane | Five container apps in one environment |
| The images of the release | A container registry, and the images are pulled **by digest** |
| The digests of the images | The file `digests.json` of the release, read by the wizard |
| PostgreSQL | Azure Database for PostgreSQL Flexible Server, injected into the network |
| Redis | Azure Managed Redis, behind a private endpoint |
| The secrets | A Key Vault, with the access of Entra ID |
| The ingress that terminates TLS | The ingress of the environment of the container apps, with one custom domain per public name and the managed certificate of Azure |
| The logs | A Log Analytics workspace |
| The state of the deployment | A storage account, created by the bootstrap |

The names of the environment, the ports and the names of the secrets are
the names of the Compose stack and of the Kubernetes bases: a deployment
runs the same platform wherever it runs it.

## Before you start

| You need | Why |
| --- | --- |
| A subscription of Azure, and the right to create resources in it | The deployment creates the network, the database, the cache and the services |
| OpenTofu 1.9 or later, and a login of Entra ID | The templates are applied by a person, and the state is read and written by the identity of the person |
| A checkout of the tag of the release | The templates and the images of a deployment come from the same tag |
| The images of the release, pushed to the registry of the deployment | The deployment runs the bytes that the gates of the release proved, and it runs them by digest |
| A network of the deployment that the operator can reach | The database and the cache are private, and the operator commands of the platform run against them |

The resource providers of the deployment are not registered by the
templates: a deployment of the platform does not have the permission to
register them. The bootstrap registers them, because it runs as the
operator: the first apply of the bootstrap registers the providers the
deployment needs, and it waits for them. A subscription that forbids the
registration needs them registered by hand:

```bash
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.Cache
az provider register --namespace Microsoft.Cdn
az provider register --namespace Microsoft.ContainerRegistry
az provider register --namespace Microsoft.KeyVault
az provider register --namespace Microsoft.Insights
az provider register --namespace Microsoft.Network
az provider register --namespace Microsoft.Storage
```

## The steps

The wizard of the deployment runs these steps: `platformctl deploy azure`
creates the place where the state lives, writes the configuration of the
backend, initializes the templates, shows the plan and applies it. The
steps below are what it runs, for the operator who runs them by hand.

### 1. The place where the state of the deployment lives

The state of a deployment holds the value of every secret of the
deployment: **the state is a secret store**. It lives in a storage
account of Azure that is encrypted at rest, that keeps its versions, and
that the shared key of which is off.

```bash
tofu -chdir=deploy/tofu/azure/bootstrap init
tofu -chdir=deploy/tofu/azure/bootstrap apply \
  -var name_prefix=platform -var environment=production \
  -var 'operator_addresses=["203.0.113.4/32"]'
```

The account of the state is closed to everything but the addresses of
the operator: the shared key is off, the access is a role of Entra ID,
and the network of the account denies every address that is not named.
The addresses are named because the private endpoint of the state would
live in the network of the deployment, and the network is created by the
templates that the state is for.

The output `backend_config_hcl` is the configuration of the backend. Write
it to the runtime directory of the deployment:

```bash
mkdir -p deploy/tofu/runtime/production
tofu -chdir=deploy/tofu/azure/bootstrap output -raw backend_config_hcl \
  > deploy/tofu/runtime/production/backend.hcl
```

### 2. The values of the deployment

```bash
cp deploy/tofu/azure/terraform.tfvars.example \
   deploy/tofu/runtime/production/terraform.tfvars
```

Fill it in. The two identifiers of the tenant and of the workspace come
from the platform: the tenant is a record of Access, and the workspace
is a record of Data. The images are digests, never tags.

The identifier of the operator is the one the client of Azure reads at
the sign-in, and the wizard of the deployment writes it: the operator
writes the secrets of the deployment in the vault of the deployment,
and the permission to write them is a role of Entra ID.

The digests of the four images of the platform are in the file
`digests.json` of the release, and the wizard of the deployment reads
that file: `platformctl deploy azure`. The digest of the image of the
client of PostgreSQL — the one image of a deployment that the platform
does not publish — is read from the registry that holds it.

### 3. The deployment

```bash
tofu -chdir=deploy/tofu/azure init \
  -backend-config=../../runtime/production/backend.hcl
tofu -chdir=deploy/tofu/azure plan \
  -var-file=../../runtime/production/terraform.tfvars
tofu -chdir=deploy/tofu/azure apply \
  -var-file=../../runtime/production/terraform.tfvars
```

This apply is the first half of the deployment: it creates the environment,
the applications and the vault, and the public names of the deployment are
bound to the gateway in the second half, in step 4.

### 4. The names of the deployment, and their certificate

The gateway is the front door of the platform: it is the only service the
callers reach, and it serves the three public names of the deployment. The
names are bound to the gateway as custom domains of its application, and
the environment of the container apps proves the ownership of a name with a
record of DNS.

The certificate of the names is one of Azure: the environment of the
container apps issues it and renews it, and the ingress of the environment
terminates the TLS of the callers with it. The gateway does not terminate
the TLS in this deployment: the environment is the edge, and it does that
part itself.

The names are the second half of the deployment, because the record of DNS
needs the application to exist:

1. the first apply creates the environment, the applications and the vault,
   and the zone of the names with the records of the names;
2. the operator delegates the zone at the registrar with the `NS` records
   that the output `dns_name_servers` names, and waits for the delegation
   to be live;
3. the operator sets `public_names_enabled = true` in the values of the
   deployment;
4. the second apply binds the names to the gateway, and the environment
   issues their certificates.

```bash
tofu -chdir=deploy/tofu/azure output dns_name_servers
```

A deployment that does not write the records of the names leaves them to
the operator: the output `dns_records` names them — a `CNAME` of every name
at the application of the gateway, and a `TXT` record named `asuid` and the
label of the name, holding the code of the verification
(`dns_verification_id`).

```bash
tofu -chdir=deploy/tofu/azure output dns_records
tofu -chdir=deploy/tofu/azure output -raw dns_verification_id
```

#### The zone of the names

The names of the deployment are the labels of the services in the zone of
the deployment: the zone is the domain of the names, and the public name
of a service is the label of the service and the zone.

```hcl
dns_zone_name = "platform.example.com"
gateway_name  = "api"
access_name   = "auth"
console_name  = "app"
```

The names are `api.platform.example.com`, `auth.platform.example.com` and
`app.platform.example.com`, and the zone holds every one of them: the
templates write the name once, and the deployment refuses a label that is
not a name.

The records of the names are the records of the zone, and the zone can be a
zone of Azure. The deployment writes the records of the names itself, and
the operator writes one thing only: the delegation of the zone.

The zone the deployment creates lives in the group of the deployment and
dies with it. A zone that is named in the group the operator names
outlives the deployment, and the operator owns it:

```hcl
dns_zone_name = "platform.example.com"
dns_zone_resource_group_name = "the-group-of-the-zone"
```

A deployment that does not write the records leaves them to the operator,
and the output `dns_records` names them:

```hcl
dns_records_managed = false
```

The operator delegates the zone at the registrar with the `NS` records
that the output `dns_name_servers` names, and waits for the delegation to
be live:

```bash
tofu -chdir=deploy/tofu/azure output dns_name_servers
```

The delegation moves the names of the zone and nothing else, when the zone
is a subdomain of the domain of the operator. A zone that is the domain of
the operator moves every record of the domain, and the records of the
domain that the operator keeps elsewhere have to move with it.

The order of the two halves is the same with a zone of Azure: the zone and
the records are written by the first apply, the delegation is written by
the operator, and the second apply binds the names.

### 5. The address of the caller

The gateway is behind the ingress of the environment, and the ingress is
the peer of the gateway: the address of the caller is the address of the
ingress, and every caller of the deployment shares it. The gateway trusts
a range of at most sixteen addresses ([gateway spec §7.3](../../../docs/gateway/spec.md#73-forwarding-headers-and-client-address)),
and the ranges of the ingress of an environment are far more than that, so
`trusted_proxy_cidrs` is empty and the budgets of the callers are the
budgets of the deployment.

Two things follow, and they are the next work: the address of the caller
has to reach the gateway through a proxy that proves itself, and the
gateway has to reach its identity provider at its internal address
instead of at the public name of the deployment.

### 6. The migration of the schema

The migration is an operator command, and not a resource of the
deployment. The job of the deployment applies it once, with the
credentials of the administrator of the server and of the owner of the
schema:

```bash
az containerapp job start --name platform-production-migrate \
  --resource-group platform-production
```

The job creates the five roles of Data, creates the role of Access, and
applies the migrations of the schema of Data.

### 7. The tenant

The tenant is created through the administration API of Access, and the
templates do not create it: the platform creates the tenants through
that API, and the identifiers it carries are the ones the deployment
tells the templates about. The credentials the registration needs are
the outputs of the deployment:

```bash
tofu -chdir=deploy/tofu/azure output -raw access_admin_token
tofu -chdir=deploy/tofu/azure output -raw gateway_client_id
tofu -chdir=deploy/tofu/azure output -raw gateway_client_secret
```

The procedure is in [Onboard a tenant](../../../docs/guides/onboard-a-tenant.md).

The secret of the client of the gateway is a credential of the
deployment, and the templates generate it. An apply that changes it is
an apply that changes the secret of the tenant: the registration is
repeated with the new value, and the gateway is rolled, because Access
keeps the old secret for ten minutes.

## The three things that are not like the Compose stack

The deployment is the platform, and it is not the Compose stack. Three
things differ, and an operator who knows the Compose stack should know
them.

### The access control list of the cache

The cache holds the sessions of the callers, the windows of the limits
and the decisions that Access answered. The templates give the services
the **access key** of the cache, because the provider of Azure cannot
create the users of the access control list of the cache: the users are
created by hand, once, with the client of Redis, from inside the
network of the deployment.

The list of the users is [`deploy/redis/gateway.acl`](../../redis/gateway.acl),
and the two users of the deployment are `gateway` and `gateway-control`.
The password of a user is written into the vault of the deployment, and
the addresses of the services are changed to carry it. Until that is
done, the access key of the cache is the credential, and it has the
whole cache.

The cache is an Azure Managed Redis, the service that replaces Azure
Cache for Redis: the old one is retired, and Azure refuses to create
it. The client of Redis that creates the users of the list is the client
of the new service.

### The transport of the database

The addresses of the database ask for `sslmode=require`, and that is
what a production deployment of Data insists on. `require` is not
`verify-full`: the transport is protected and the certificate of the
server is not verified. Verifying it needs the certificate of the root
of Azure in the container and a `sslrootcert` in the address, and the
platform has no convention for a certificate of the root yet. The
templates do not pretend to do it, and the README of the platform says
the same in [Data configuration](../../../docs/data/configuration.md).

### The delegation of the subnet of the environment

The environment of the container apps is joined to the network of the
deployment, and the subnet that carries the environment is delegated to
`Microsoft.App/environments` — the name the provider of Azure accepts.
The documentation of Azure names `Microsoft.App/managedEnvironments` for
the same delegation. If the apply refuses the delegation, that value is
the one thing to change.

### The link of the zone of the database

The server of the database is injected into the network of the
deployment, and the name of the server is a name of the zone of the
private names of Azure: `privatelink.postgres.database.azure.com`. The
resolver of Azure answers that zone for the networks that are linked to
it, and for no other, so the templates link the zone of the database to
the network of the deployment.

A deployment whose services fail to start with a name they cannot find
— `getaddrinfo ENOTFOUND …postgres.database.azure.com` — is a
deployment whose zone of the database is not linked to its network.

The zone of the cache is not linked by the templates: the cache is
reached through a private endpoint, and Azure writes the link of the
zone of an endpoint when it writes its zone group.

## The state of a deployment is a secret store

The templates write the value of every secret of the deployment into
the vault, and the value of every secret is in the state. The state is
therefore a secret store, and it is protected as one:

- it lives in a storage account that is not published and whose shared
  key is off;
- it keeps its versions, and a deleted blob is kept for seven days;
- the identity that reads it is the identity of the operator, and the
  identity of the deployment.

The templates of the provider of Azure can write a secret without
keeping it (`value_wo`). It is not used here: the secrets of the
deployment are generated, and a generated secret cannot be written
without a value in the state.

A secret that is in the vault and that the state does not know is a
secret the plan wants to create, and the tool refuses because it is
already there. The wizard writes it in the state and runs the plan
again, and the plan writes the secret again with the value of the
state: the secret of the vault gets a new version, and the version
before it is kept for ninety days.

The value of a secret is in the state and nowhere else, and a state
that is lost is a deployment with new credentials. The roles of the
database are set by the migration, and the migration sets them again
with the values of the state: the roles follow the state. The password
of the administrator of the server does not follow it: the server keeps
the password it was created with, and the value of the state is the
value the deployment expects. A state that was rebuilt is a server whose
administrator password has to be set again.

The vault is written through its data plane, and the data plane answers
to the roles of Entra ID: the operator holds the role that writes the
secrets, and the services hold the role that reads them. The role of
the operator reaches the token of the operator a little after the role
is created, and the templates wait for it before they write the first
secret: the wait is a resource of the templates, and it is not paid
again by the deployments that follow.

## The checks

The templates are checked without a cloud:

```bash
tofu -chdir=deploy/tofu/azure init -backend=false
tofu -chdir=deploy/tofu/azure validate
tofu -chdir=deploy/tofu/azure fmt -check -recursive .
```
