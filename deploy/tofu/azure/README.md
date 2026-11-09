# The deployment of the platform on Azure

The deployment of the gateway, Access, Data and the console on Azure,
written in OpenTofu. The templates are the platform's artifacts and
they are part of the release line of the deployment; the values of one
deployment are in [`../runtime/`](../README.md#the-templates-and-the-files-of-a-deployment).

## What the deployment is made of

| The platform | Azure |
| --- | --- |
| The gateway, Access, Data, the console and the control plane | Five container apps in one environment |
| The images of the release | The registry of GitHub (`ghcr.io`), and the images are pulled **by digest** |
| The digests of the images | The file `digests.json` of the latest release, read by the wizard |
| PostgreSQL | Azure Database for PostgreSQL Flexible Server, injected into the network |
| Redis | Azure Managed Redis, behind a private endpoint |
| The secrets | A Key Vault, behind a private endpoint, with the access of Entra ID |
| The ingress that terminates TLS | The ingress of the environment of the container apps, with one custom domain per public name and the managed certificate of Azure |
| The logs | A Log Analytics workspace, that keeps the logs for ninety days |
| The identity of the callers | An application registration of Entra ID: the client of Access at the provider of the tenant |
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
| The images of the release, published at `ghcr.io` by the release | The deployment runs the bytes that the gates of the release proved, and it runs them by digest. The packages are public, and the pull needs no credential |
| A network of the deployment that the operator can reach | The database and the cache are private, and the operator commands of the platform run against them |
| The right to register an application in the tenant of Entra ID of the deployment | The templates create the application of Access at Entra ID, and the creation of an application is a permission in the directory |

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

The state of the bootstrap is local, and it holds the name of the
account of the state. The wizard of the deployment runs the bootstrap in
the directory of the files of the deployment
(`deploy/tofu/runtime/<environment>/bootstrap`), and the state of the
bootstrap is written there: the state holds the credentials of the
account of the state, and the checkout of the templates is not the place
of a credential. A bootstrap that is run by hand writes its state next
to its templates, and the directory of the tools is in `.gitignore`.

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

The subscription of the deployment is the one the client of Azure reads
at the sign-in, and the wizard of the deployment writes it too: the
templates write their resources in the subscription that the values of
the deployment name, and not in the subscription of the session of the
operator. A subscription that is named in the values is the only one
the templates write in; a value that is empty takes the subscription of
the session.

The digests of the four images of the platform are in the file
`digests.json` of the release, and the wizard of the deployment reads
that file: `platformctl deploy azure`. The digest of the image of the
client of PostgreSQL — the one image of a deployment that the platform
does not publish — is read from the registry that holds it.

### The images of the deployment

The images are pulled from the registry of GitHub, and the deployment
holds **no registry of its own**: the packages of the release are
public, and a public package is pulled without a credential.

The templates name **no registry at all**: an application without a
registry pulls its images anonymously, and the identity of the
deployment reads the secrets of the vault and nothing else.

The reference of an image names the registry it is in, and the
templates pull every image from the registry its reference names:

```
ghcr.io/ggpwnkthx/gateway@sha256:…
ghcr.io/ggpwnkthx/access@sha256:…
ghcr.io/ggpwnkthx/data@sha256:…
ghcr.io/ggpwnkthx/console@sha256:…
docker.io/library/postgres:18-alpine@sha256:…
```

The image of the client of PostgreSQL names the registry of Docker, and
it is never pulled from the registry of the platform: the job of the
migration is the one place of the deployment that uses an image of
somebody else.

The registry of the deployment was a mirror of the packages of the
release, and it was paid for. The packages of the release are public,
and the environment of the container apps pulls them from where they
are published.

A package that is **not** public needs a credential, and the templates
do not hold one: the deployment reads its secrets out of the vault of
the deployment, and a token of the registry is a secret of the
deployment like the other ones. The environment of the container apps
reads the credential of the registry out of the vault, with the
identity of the deployment:

```hcl
registry {
  server = "ghcr.io"
  username = "the-name-of-the-account-of-the-registry"
  password_secret_name = "the-name-of-the-secret-of-the-vault"
}
```

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

The templates write the names without a certificate: the provider of the
infrastructure of Azure writes a custom domain without a certificate,
because it has no resource that binds the certificate of the environment
of the container apps to a name of an application
([the issue](https://github.com/hashicorp/terraform-provider-azurerm/issues/27362)
is open). A name without a certificate answers in plain HTTP only, and
the callers of the deployment reach the names over HTTPS.

The certificate of a name is bound by the client of Azure, and the
wizard of the deployment binds it after the apply: the environment of
the container apps issues the certificate of the name and renews it, and
the ingress of the environment terminates the TLS of the callers with
it. A deployment that is applied by hand binds the certificates with the
same command, once for every public name:

```bash
az containerapp hostname bind \
  --hostname api.platform.example.com \
  --name platform-production-gateway \
  --resource-group platform-production \
  --environment platform-production-environment \
  --validation-method HTTP
```

The binding waits for the records of DNS of the name: the environment
proves the ownership of a name with them, and a name whose records are
not in place yet is a name the environment cannot prove. The wizard says
what it bound and what it could not bind, and the binding is written
again the next time the deployment goes on.

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
deployment. The job of the deployment applies it, with the credentials
of the administrator of the server and of the owner of the schema:

```bash
az containerapp job start --name platform-production-migrate \
  --resource-group platform-production
```

The wizard of the deployment starts the job when the deployment is
applied, and the job runs again at every apply: the roles that are
missing are created, the passwords of the roles that are there are
written again, and the migrations that are missing are applied. The job
is started by hand when the wizard could not start it.

The job creates the five roles of Data, creates the role of Access, and
applies the migrations of the schema of Data. The grants of the roles
belong to the database the roles work in: the role of Access creates
the eight tables of its schema in the database of the platform, and the
owner of the schema of Data creates the schemas of the service in the
database of Data.

### 7. The tenant

The tenant is created through the administration API of Access, and the
templates do not create it: the platform creates the tenants through
that API, and the identifiers it carries are the ones the deployment
tells the templates about. The credentials the registration needs are
the outputs of the deployment:

```bash
tofu -chdir=deploy/tofu/azure output -raw access_admin_token
tofu -chdir=deploy/tofu/azure output -raw client_id
tofu -chdir=deploy/tofu/azure output -raw client_secret
tofu -chdir=deploy/tofu/azure output -json client_redirect_uris
```

The tenant has **one** client at Access, and the gateway and the
console are that client: Access holds one set of credentials for a
tenant, and it resolves the tenant of a login from the identifier of the
client. The registration of the tenant therefore carries the identifier
and the secret above, and the redirect URIs of the client are the
callback of the gateway and the callback of the console:

```
https://<the-gateway>/auth/callback
https://<the-console>/auth/callback
```

#### The provider of the tenant

The provider of the identity of the tenant of the deployment is **Entra
ID**, and the templates create the client of Access at it: the
application of Access, a confidential client with a secret of its own,
and with the callback of Access as its only redirect URI. The
application is in the tenant of the deployment and in no other, and it
asks for no permission of any other application: it is a client and not
a resource.

The outputs of the deployment carry what the registration of the tenant
needs of the provider:

```bash
tofu -chdir=deploy/tofu/azure output -raw entra_issuer
tofu -chdir=deploy/tofu/azure output -raw entra_client_id
tofu -chdir=deploy/tofu/azure output -raw entra_client_secret
tofu -chdir=deploy/tofu/azure output -raw entra_redirect_uri
```

The issuer is the second version of the endpoint of the directory, and
not the first: the discovery document of the first version names another
issuer, and Access refuses a provider whose document names an issuer
that is not the issuer of the tenant.

The scopes of the provider are the three that every provider knows —
`openid`, `profile` and `email` — and the deployment tells the gateway
so (`GATEWAY_OIDC_SCOPES`). The gateway asks for the groups of a caller
by default, and Entra ID does not know that scope: the scopes of a
provider are the ones its discovery document names, and a scope it does
not know is a scope its authorization refuses. The groups of a caller
are read in the grants of Access, and not in the directory.

The secret of the client is rotated by the operator: the value of
`entra_secret_rotation` is the key of the secret, and a change of the
key is a new secret. A rotation is a change of the registration of the
tenant — the tenant holds the secret of its provider — and the
registration is repeated with the new value. The registration takes
effect at once: a change of the registration of a tenant drops the
client of the provider that Access built for it, and the next login
builds a new one.

The identity of a caller is the subject of the directory, and it is the
key of the principal: the e-mail of the directory is published by Entra
ID for the users that carry a mail attribute, and it is not an identity
in any case. The principal of a caller is registered by its subject, and
the grants of the tenant are the work of the operator of the platform.

A deployment whose tenant has another provider turns the application
off with `entra_tenant_enabled = false`, and the registration of the
tenant is the work of the operator.

The procedure is in [Onboard a tenant](../../../docs/guides/onboard-a-tenant.md).
The registration of the tenant of the deployment is one call:

```bash
ACCESS=$(tofu -chdir=deploy/tofu/azure output -raw access_issuer)
ADMIN=$(tofu -chdir=deploy/tofu/azure output -raw access_admin_token)
CLIENT=$(tofu -chdir=deploy/tofu/azure output -raw client_id)
SECRET=$(tofu -chdir=deploy/tofu/azure output -raw client_secret)
CALLBACKS=$(tofu -chdir=deploy/tofu/azure output -json client_redirect_uris)
ISSUER=$(tofu -chdir=deploy/tofu/azure output -raw entra_issuer)
IDP_CLIENT=$(tofu -chdir=deploy/tofu/azure output -raw entra_client_id)
IDP_SECRET=$(tofu -chdir=deploy/tofu/azure output -raw entra_client_secret)
IDP_CALLBACK=$(tofu -chdir=deploy/tofu/azure output -raw entra_redirect_uri)

curl -sS -X POST $ACCESS/v1/admin/tenants \
  -H "authorization: Bearer $ADMIN" -H "content-type: application/json" \
  -d '{"slug":"<the-slug-of-the-tenant>","displayName":"<the-name-of-the-tenant>",
       "issuer":"'"$ISSUER"'",
       "idpClientId":"'"$IDP_CLIENT"'","idpClientSecret":"'"$IDP_SECRET"'",
       "idpRedirectUri":"'"$IDP_CALLBACK"'",
       "idpScopes":["openid","profile","email"],
       "clientId":"'"$CLIENT"'","clientSecret":"'"$SECRET"'",
       "clientRedirectUris":'"$CALLBACKS"'}'
```

The wizard of the deployment makes that call when the deployment is
applied: it reads the tenant among the tenants of Access — the tenant
the values name as `access_tenant_id` — and registers it again with the
application of Entra ID as its provider, keeping the flags of the
tenant. The registration is repeated at every apply, and a deployment
whose Access is not up yet is a deployment whose tenant is registered by
hand.

The identifier of the tenant that the answer carries is the one the
values of the deployment name as `access_tenant_id`: the access context
credentials of Data and of the console ask about that tenant, and a
placeholder names no tenant.

The console reads the scope of the people who sign in through the
credential of the access context, and it opens nothing without the
grants that name its route. The grant of a person is one call, with
the slug of the tenant as the workspace and the route of the console as
the route:

```bash
curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ADMIN" -H "content-type: application/json" \
  -d '{"tenant":"<the-slug-of-the-tenant>","userId":"<the-id-of-the-principal>",
       "permission":"console.admin","workspaceId":"<the-slug-of-the-tenant>",
       "routeId":"console"}'
```

The steps of the console are in [Console operations](../../../docs/console/operations.md#set-up-access).

The console holds no credential of the administration of Access: the
deployment gives the platform's token to Access, and the console reads
the scope of the people who sign in through the credential of the
access context. An operator who administers the tenants from the
console gives the console a credential of the administration — the
token of the platform, or the token of a tenant — and the steps are in
[Console operations](../../../docs/console/operations.md#credentials-it-holds).

The secret of the client is a credential of the deployment, and the
templates generate it. An apply that changes it is an apply that
changes the secret of the tenant: the registration is repeated with the
new value, and the gateway and the console are rolled, because Access
keeps the old secret for ten minutes.

## The environment of the services

Every variable of a service that carries a secret is a **reference** to
a secret of the vault of the deployment, and never a value: the portal
of Azure shows the variable as a secret, and the configuration of an
application holds the name of the secret and not its value.

```
GATEWAY_SESSION_SECRET  ->  secretName: gateway-session-secret
```

The templates write every secret of the deployment into the vault — the
credentials, the addresses of the databases and of the cache, and the
documents that the services read — and the identity of the deployment
reads them with the role of Entra ID that reads the secrets of the
vault. The application resolves the reference when the revision starts,
and a revision that starts after a rotation of the vault reads the new
value without a new apply.

A secret that a service reads from a file is a secret of the vault too:
the init container of the service reads it out of the vault and writes
it to the file that the service reads it from, and the service never
sees the variable that carried it.

The variables that carry no secret — the ports, the levels of the logs,
the names of the routes — are values, and the portal of Azure shows them
as manual entries. That is what they are.

## The three things that are not like the Compose stack

The deployment is the platform, and it is not the Compose stack. A few
things differ, and an operator who knows the Compose stack should know
them.

### The addresses the services reach each other at

The address of a service inside the environment of the container apps is
the **name of its application**:

```
http://<the-application>
```

The name resolves in the internal DNS of the environment, and it reaches
the ingress of the service itself. The ingress answers on the standard
ports, and it forwards to the port of the container. The port of the
container on the name of the environment is **not** an address: the
traffic to it is dropped, and the call to it waits for a timeout that
never ends. A service that answers
`http://<the-service>.<the-environment>:8081` is a service that nobody
reaches.

The name of the environment,
`<the-service>.<the-environment>.<the-region>.azurecontainerapps.io`, is
the **public** name of the service. A service that is not published has
no answer there: the environment answers `404` for a request that
arrives at the public name of an application whose ingress is internal,
and the answer is a page of the environment and not an answer of the
service. The internal name of an application carries `internal` between
the name of the application and the name of the environment,
`<the-service>.internal.<the-environment>.<the-region>.azurecontainerapps.io`,
and it answers as well — but the name of the application alone is the
shortest of the three.

The three services that are not published — Access, Data and the
console — have an ingress that speaks the plain HTTP, and the gateway
reaches them at their internal address. The gateway is published, and
its ingress terminates the TLS of the three public names: the console
reaches the gateway at its public name, and the browsers reach it at the
same name.

The console reaches Access and Data at their internal addresses: it
probes the two of them for its status board, and it reads the data of
a workspace through the gateway. A console that is given no address of
a service shows that service as not configured, and the check of the
deployment reports it.

The browsers are not the services: they reach Access and the gateway at
their public names, and the addresses they use are the ones the
discovery document of Access carries. The console is ready when Access
answers its discovery document, and it can only know it when it reaches
it.

The gateway reaches Access at the public name of the deployment, and
that is the next work: the gateway discovers its identity provider at
the issuer it was configured with, and the issuer is the public name of
the deployment.

### The vault and its two addresses

The vault of the deployment holds the credentials of the deployment, and
it has two addresses:

- the **private** address, which is the private endpoint of the vault in
  the network of the deployment. The name of the vault resolves to it
  inside the network, and the services of the deployment read the
  secrets of the vault over it;
- the **public** address, which stays open because the operator writes
  the secrets of the deployment in the vault from a machine that is not
  in the network of the deployment.

The vault is protected by the roles of Entra ID and not by the address:
the operator holds the role that writes the secrets, the services hold
the role that reads them, and neither of them is a credential that a
person knows. A deployment whose operator is inside the network of the
deployment can close the public address of the vault by writing
`public_network_access_enabled = false` in the templates.

### The access control list of the cache

The cache holds the sessions of the callers, the windows of the limits
and the decisions that Access answered. The templates give the services
the **access key** of the cache, because the provider of Azure cannot
create the users of the access control list of the cache: there is no
resource for them in the provider, and the users are created by hand,
once, with the client of Redis, from inside the network of the
deployment.

The tier of the cache is **Balanced**, and the tier is not a matter of
the databases: an Azure Managed Redis holds **one** database, the
database `0`. The service that replaces Azure Cache for Redis does not
have the databases of the tiers of the old service, and a cache that is
asked for a second database does not hold it: the gateway then serves
the sessions of the callers and says that the shared state is not
reachable, and the rate limits and the cached decisions of the
deployment are not kept.

The two stores of the deployment — the sessions of the callers and the
state that the replicas share — live in that one database, and they are
apart by the keys they use: the sessions use the keys `gateway:s:` and
`gateway:u:`, the state that the replicas share uses the keys
`gateway:cfg:`, `gateway:rl:`, `gateway:dec:` and `gateway:control:`.

The cache is a **cluster** on every tier and every size: an Azure
Managed Redis is built on Redis Enterprise, and the policy of the cluster
decides how a client reaches it. The templates choose the policy of the
proxy, `EnterpriseCluster`: the proxy routes every command to the shard
that holds the key, and the cache looks like a server to a client that
knows one server. The default of the service is the policy of the Redis
of the community edition, `OSSCluster`, and a client that knows one
server cannot use it: the server answers a command on a key it does not
hold with a redirection, `MOVED <the-slot> <the-node>`, and the gateway
then says that the shared state is not reachable while the server answers
every ping. The policy is chosen when the database is created, and
changing it recreates the database: the sessions of the callers are lost,
and nothing else is.

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

The zone of the cache is linked to the network of the deployment by the
templates, like the zone of the database and the zone of the vault: the
resolver of Azure answers a zone for the networks that are linked to it,
and the records that the zone group of the private endpoint writes are
not answered by the resolver of a network that is not linked to the
zone.

### The zone of the cache

The cache is an Azure Managed Redis, and its name is a name of the zone
of the private names of Azure Managed Redis:
`privatelink.redis.azure.net`. The name of the cache is
`<the-name-of-the-cache>.<the-region>.redis.azure.net`.

The private endpoint of the cache has the subresource `redisEnterprise`.
The cache is served by the resource provider
`Microsoft.Cache/redisEnterprise`, and the name of the subresource is
the name of that provider, not the name of the service. Azure refuses
the endpoint with any other name, and the answer is `GroupIds weren't
provided or do not match 'redisEnterprise'`.

The zone of the Azure Cache for Redis, `privatelink.redis.cache.windows.net`,
and the zone of the Redis Enterprise,
`privatelink.redisenterprise.cache.windows.net`, are the zones of the
other services: a zone of one of those names holds the record of the
cache in a zone the name of the cache is not a name of, and the name of
the cache then resolves to its public address, which is closed.

A deployment whose gateway reports that the session store is not
reachable, and that the shared state is not reachable, with a `Connection
timeout` in the log, is a deployment whose name of the cache resolves to
the public address of the cache. The name of the cache is resolved from
inside the network of the deployment:

```bash
# From a machine that is in the network of the deployment.
nslookup <the-name-of-the-cache>.<the-region>.redis.azure.net
```

The answer is the private address of the endpoint of the cache, in the
subnet of the private endpoints, and not a public address.

The transport of the cache is TLS, and the address of the cache is a
`rediss://` address. A gateway whose log says that the certificate of the
cache cannot be verified is a gateway that is not given the authority of
the certificate of the cache: the gateway reads it from
`GATEWAY_SESSION_TLS_CA` and `GATEWAY_SHARED_STATE_TLS_CA`, and the
templates of the deployment do not write them.

The port of the cache is the port of the database of the cache, and the
database of an Azure Managed Redis answers on the port `10000`: the
port of the Redis of the community edition (`6379`) is not the port of
the cache. The templates take the port the service reports and the port
`10000` when the service reports none, and an address that names a port
the cache does not answer on is an address that times out.

The log of a gateway that cannot reach the cache says three things, and
the three are one thing: the session store is not reachable, the shared
state is not reachable, and the certificate of the deployment cannot be
read. The certificate of the deployment lives in the shared state, and
the client of the cache refuses every command while it is not connected:
`The client is offline` is the offline queue of the client of the cache
being disabled, and not a certificate that cannot be read.

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

The token of the control plane is a secret of the vault: the file
`gateway-control-tokens` holds the map of the tokens, and the control
plane reads it. The token of the operator is the one that holds the
scope `operate`, and the commands of the operator carry it in
`PLATFORMCTL_CONTROL_TOKEN`. It is a credential of its own, and it is
not the secret of the client of the tenant: the console is the service
that the browsers reach, and it holds no credential of the control
plane.

## The checks

The templates are checked without a cloud:

```bash
tofu -chdir=deploy/tofu/azure init -backend=false
tofu -chdir=deploy/tofu/azure validate
tofu -chdir=deploy/tofu/azure fmt -check -recursive .
```
