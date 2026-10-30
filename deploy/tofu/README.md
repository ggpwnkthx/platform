# The infrastructure as code of the platform

The deployment of the platform on Azure is written in OpenTofu. The
templates are in [`azure/`](azure/), and they are the platform's
artifacts: they are versioned with the platform, they are reviewed with
it, and they are part of the release line of the deployment.

## The layout

```text
deploy/tofu/
  azure/                          the templates of one cloud
    README.md
    versions.tf                   the tools and the providers
    providers.tf
    variables.tf                  the inputs of the deployment
    locals.tf                     the names, the secrets and the documents
    network.tf                    the network and the private addresses
    registry.tf                   the registry of the images
    observability.tf              the workspace of the logs
    postgres.tf                   the database
    redis.tf                      the cache
    keyvault.tf                   the vault of the credentials
    identity.tf                   the identity of the deployment
    containerapps.tf              the services and the migration
    edge.tf                       the edge that terminates TLS
    outputs.tf                    what the operator needs after the apply
    terraform.tfvars.example      the reference of what a deployment fills
    bootstrap/                    the place where the state of a deployment lives
  runtime/                        the files of a given deployment
    <environment>/
      backend.hcl                 where the state of the deployment lives
      terraform.tfvars            the values of the deployment
      plan.bin                    a plan, between the plan and the apply
```

## The templates and the files of a deployment

The two are kept apart, and the repository says so.

The **templates** are the `.tf` files of `azure/`. They are the platform's
artifacts, and they change with the platform. A change of a template is
a change of the deployment of everybody, and it is reviewed like any
other change of the repository.

The **files of a deployment** are in `runtime/<environment>/`. They name
one deployment: the values it runs with, the place where its state
lives, and the plan that is waiting for its approval. They are not
committed, and `deploy/tofu/runtime/` is in `.gitignore`.

The rule is the rule of the rest of `deploy/`: a file of a deployment is
never committed, and a secret is never in this directory.

## The commands

The templates are run from their own directory, and the files of the
deployment are named:

```bash
# The place where the state of the deployment lives: once per deployment.
tofu -chdir=deploy/tofu/azure/bootstrap init
tofu -chdir=deploy/tofu/azure/bootstrap apply \
  -var name_prefix=platform -var environment=production

# The configuration of the backend, written by hand to the runtime
# directory of the deployment:
#   deploy/tofu/runtime/production/backend.hcl

# The deployment itself.
tofu -chdir=deploy/tofu/azure init \
  -backend-config=../../runtime/production/backend.hcl
tofu -chdir=deploy/tofu/azure plan \
  -var-file=../../runtime/production/terraform.tfvars
tofu -chdir=deploy/tofu/azure apply \
  -var-file=../../runtime/production/terraform.tfvars
```

## The checks

The templates are checked without a cloud, on every change:

```bash
tofu -chdir=deploy/tofu/azure init -backend=false
tofu -chdir=deploy/tofu/azure validate
tofu -chdir=deploy/tofu/azure fmt -check -recursive .
```

The continuous integration runs them; see the job `infrastructure` of
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

The check of the directory of the deployment holds the templates to
their own lines: every variable of the templates is in the example of
the values, the example names no variable that the templates do not
declare, every image is a digest, every provider is pinned, the runtime
directory is ignored, and no file of a deployment is ever committed.

```bash
bun run deploy:check
```
