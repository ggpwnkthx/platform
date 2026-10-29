# Deploy the platform

This guide takes an empty environment to a first production deployment of the gateway, Access, Data and the console, and ends with a verified request through the gateway and a first tenant ready to hand over. It is for the operator who runs the rollout ([sysops](../roles/sysops.md)), working with the database owner ([dba](../roles/dba.md)) on the PostgreSQL steps and with [secops](../roles/secops.md) on the secrets.

## Before you start

| You need | Why | Reference |
| --- | --- | --- |
| A PostgreSQL server you administer | Access keeps its eight tables there and Data its business data; the gateway can keep its shared state there too. The repository is tested on PostgreSQL 18, and Data's backup scripts need PostgreSQL 15 or later. | [Access database role](../access/operations.md#database-role), [Data database roles](../data/operations.md#database-roles) |
| A Redis server | Access stores login codes in it, and the gateway stores sessions, rate-limit windows and cached decisions in it unless you choose PostgreSQL. | [Access requirements](../access/operations.md#requirements), [gateway shared state](../gateway/operations.md#shared-state) |
| An OpenID Connect provider per tenant, reachable over `https` | Access sends each tenant's logins to its own provider. | [Access hardening](../access/operations.md#hardening) |
| An ingress that terminates TLS, and DNS names for the gateway's public hosts, the Access issuer and the console | No service terminates TLS itself. | [Gateway ingress](../gateway/operations.md#ingress) |
| A secret manager that can mount files | Secrets reach the services as mounted files wherever a service reads files. | [Platform security: secrets](../platform/security.md#secrets) |
| One platform release | The three images share one version. | [Images and binaries](../platform/operations.md#images-and-binaries) |
| A checkout of that release's tag, with Bun 1.4.3 or later | The operator commands in the steps below (`provision`, `migrate`, `workspace`, `identity:key`, `postgres:migrate`) run from it. | [Development prerequisites](../platform/development.md#prerequisites) |

The examples use `access.example.com` for the Access issuer, `api.example.com` for the gateway's public host and the Data workspace `11111111-1111-4111-8111-111111111111`. Replace them with your own.

## Steps

### 1. Pin the release

Pick one release and resolve each image to its digest. The release gates ran against that digest, so deploy the digest rather than the moving tag.

```bash
docker pull ghcr.io/ggpwnkthx/gateway:1.0.0
docker pull ghcr.io/ggpwnkthx/access:1.0.0
docker pull ghcr.io/ggpwnkthx/data:1.0.0
```

The console has no published image: build it from `packages/console/Dockerfile` at the same tag ([console build and run](../console/operations.md#build-and-run)). Which mixed versions are proven to work together is recorded in the [compatibility baseline](../platform/internals.md#compatibility).

### 2. Generate the secrets as files

Create every secret once, in your secret manager, before any process starts. Each service validates its whole environment at start and names every missing or weak value in one message, so a gap here shows up as a refused start rather than a half-working service ([environment conventions](../platform/operations.md#environment-conventions)).

| Secret | Variable it feeds | How to make it | Rule |
| --- | --- | --- | --- |
| Identity signing key pair | `GATEWAY_IDENTITY_SIGNING_KEY` (private half); the Data binding's `publicKeyFile` (public half) | `bun run --cwd packages/gateway identity:key`, then `identity:key --public` for the public half | P-256 PEM, one key for every gateway replica; only the gateway's deployment holds the private half |
| Gateway session secret | `GATEWAY_SESSION_SECRET` | The gateway pages give no generator or length | One value for every gateway replica |
| Control-plane token map | `GATEWAY_CONTROL_TOKENS_FILE` | A JSON file `{token: {operator, scope}}`, see `deploy/config/control-tokens.example.json` | Tokens of 16 characters or more, one scope each, never equal to another secret; the map of the example is refused in production |
| Access state secret and encryption key | `ACCESS_STATE_SECRET`, `ACCESS_SECRET_ENCRYPTION_KEY` | `openssl rand -base64 32` | At least 32 bytes as decoded; the state secret is shared by every Access replica |
| Access signing key | `ACCESS_SIGNING_KEY`, `ACCESS_SIGNING_KID` | `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` | Pick a key ID such as `access-1` |
| Access administration token | `ACCESS_ADMIN_TOKEN`, or per-operator credentials in `ACCESS_ADMIN_TOKENS` | Random value | At least 16 bytes in production |
| Decision token | `ACCESS_DECISION_TOKEN` at Access and `GATEWAY_ACCESS_TOKEN` at the gateway, the same value | Random value | Optional and deprecated at Access; see [Access spec: gateway credentials](../access/spec.md#88-gateway-credentials) |
| Access context credential | A key of `ACCESS_CONTEXT_TOKENS` at Access; the file named by `DATA_ACCESS_CONTEXT_TOKEN_FILE` at Data | Random value | At least 32 bytes in production, scoped to tenant UUIDs; a scope of `null` needs `ACCESS_CONTEXT_ALLOW_PLATFORM_TOKEN=true` |
| Data cursor key | `DATA_CURSOR_KEY_FILE` | Random bytes | At least 32 bytes |
| Metrics tokens | `GATEWAY_METRICS_TOKEN`, `ACCESS_METRICS_TOKEN`, `DATA_METRICS_TOKEN_FILE` | Random values | Without one, that service serves no metrics; the token of the gateway is at least 32 bytes in production |
| Database role passwords | `DATA_OWNER_PASSWORD`, `DATA_RUNTIME_PASSWORD`, `DATA_REGISTRY_PASSWORD`, `DATA_DELIVERY_PASSWORD`, `DATA_MAINTENANCE_PASSWORD`; the Access role's password | Random values | Read by the provisioning commands, never printed |
| Console session secret and client secret | `CONSOLE_SESSION_SECRET`, `CONSOLE_CLIENT_SECRET` | Random values | The session secret is at least 32 characters, the client secret at least 16 |

How each service takes a secret differs:

- Access reads `ACCESS_<NAME>_FILE` for every secret in its [file list](../access/configuration.md#secrets-in-files); `ACCESS_ADMIN_TOKENS` has no file form.
- Data takes its secrets only as files (`DATA_CURSOR_KEY_FILE`, `DATA_ACCESS_CONTEXT_TOKEN_FILE`, `DATA_METRICS_TOKEN_FILE`, and the key files its bindings name).
- The gateway's [configuration](../gateway/configuration.md#files) lists a file form only for the control-plane token map; its other secrets come from the environment your secret store fills, and keys also accept a `_BASE64` form.
- The console reads only environment variables ([console configuration](../console/configuration.md#variables)).

`bun run scripts/dev-keys.ts` and the values in [`.env.min`](../../.env.min) are for development and trials only. Every service refuses the values the repository publishes in production, and the stacks refuse the published passwords of the database and the map of the example of the control plane ([published values](../platform/security.md#published-values)). A token of the platform is at least thirty-two bytes long.

The stacks of the deployment put the services in their production environment: the gateway reads `NODE_ENV=production`, and Access and Data read their own environment variable. A deployment that leaves them out runs the rules of a development machine, and the rules of a development machine let a published credential through.

### 3. Create the database roles

Each service connects with a role that cannot do another role's work, and both Access and the gateway refuse to start in production on a role that bypasses row-level security ([least privilege](../platform/security.md#least-privilege)).

Access needs one non-superuser role that owns its tables, because its migrations run as that role:

```sql
create role access_app login password '…';
alter database platform owner to access_app;
grant usage, create on schema public to access_app;
```

Access also ships `scripts/cli/provision.ts`, which creates the role and database from `ACCESS_ADMIN_DATABASE_URL`, `ACCESS_OWNER_PASSWORD` and `ACCESS_DATABASE_NAME` ([script variables](../access/configuration.md#variables-of-the-scripts-and-tests)).

Data needs five roles (`data_owner`, `data_runtime`, `data_registry`, `data_delivery`, `data_maintenance`). Create them once, as the server administrator, with the role passwords in the environment:

```bash
DATA_ADMIN_DATABASE_URL=postgres://admin:…@postgres:5432/postgres \
DATA_OWNER_PASSWORD=… DATA_RUNTIME_PASSWORD=… DATA_REGISTRY_PASSWORD=… \
DATA_DELIVERY_PASSWORD=… DATA_MAINTENANCE_PASSWORD=… \
  bun run --cwd packages/data provision
```

The gateway and its control plane get separate shared-state users, so only the control plane can write the route table ([gateway roles](../gateway/operations.md#roles)):

```bash
# PostgreSQL backend: creates gateway_app and control_app
POSTGRES_GATEWAY_PASSWORD=… POSTGRES_CONTROL_PASSWORD=… \
  bun run --cwd packages/gateway postgres:migrate -- --roles postgres://admin:…@postgres:5432/gateway

# Redis backend: load deploy/redis/gateway.acl as the aclfile, then on every server start
redis-cli ACL SETUSER gateway resetpass >"$REDIS_GATEWAY_PASSWORD"
redis-cli ACL SETUSER gateway-control resetpass >"$REDIS_CONTROL_PASSWORD"
```

### 4. Apply the schemas

Data's schema is applied by an operator command, with the schema owner's credentials and never the API's:

```bash
DATA_OWNER_DATABASE_URL=postgres://data_owner:…@postgres:5432/data \
  bun run --cwd packages/data migrate
```

On Kubernetes, run it once per deployment with `deploy/kubernetes/base/data/migrate-job.yaml`; it is not part of the base ([Kubernetes manifests](../../deploy/README.md#kubernetes-manifests)).

Access applies its own migrations when it starts, under an advisory lock, so there is nothing to run by hand; a binary needs the `migrations/` directory of its archive beside it ([Access spec §3.8](../access/spec.md#38-migrations)).

With a PostgreSQL shared state, the gateway builds its schema on connect only outside production. In production run `bun run --cwd packages/gateway postgres:migrate -- postgres://user:…@host:5432/gateway`, or set `GATEWAY_POSTGRES_AUTO_MIGRATE=true` deliberately ([gateway shared state](../gateway/operations.md#shared-state)). Redis needs no schema.

### 5. Start Access

Access comes first: Data's readiness depends on Access's access context discovery, and the gateway asks Access for every decision. Set `ACCESS_ENVIRONMENT=production` and the eight required variables, with secrets as files:

```bash
ACCESS_ENVIRONMENT=production
ACCESS_ISSUER=https://access.example.com
ACCESS_DATABASE_URL=postgres://access_app:…@postgres:5432/platform
ACCESS_REDIS_URL=redis://redis:6379/0
ACCESS_ADMIN_TOKEN_FILE=/run/secrets/access-admin-token
ACCESS_STATE_SECRET_FILE=/run/secrets/access-state-secret
ACCESS_SECRET_ENCRYPTION_KEY_FILE=/run/secrets/access-encryption-key
ACCESS_SIGNING_KEY_FILE=/run/secrets/access-signing-key.pem
ACCESS_SIGNING_KID=access-1
ACCESS_CONTEXT_TOKENS_FILE=/run/secrets/access-context-tokens.json
ACCESS_METRICS_TOKEN_FILE=/run/secrets/access-metrics-token
```

The full replica environment is in [Access operations](../access/operations.md#replica-environment) and every variable in [Access configuration](../access/configuration.md#variables). Give each pod a 10 s grace period and gate the rollout on `GET /readyz`, which answers `503` until the database answers and the migrations are applied ([Access deploy and roll back](../access/operations.md#deploy-and-roll-back)).

### 6. Register the first tenant

With Access ready, register the tenant, its principals and their grants through Access's administration API. Choose the gateway's client ID, client secret and callback now: you send them to Access as `clientId`, `clientSecret` and `clientRedirectUris`, and the gateway uses the same values in step 9.

```bash
export ACCESS=https://access.example.com
curl -sS -X POST $ACCESS/v1/admin/tenants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"acme","displayName":"Acme Inc","issuer":"https://login.acme.example",
       "idpClientId":"access-acme","idpClientSecret":"…",
       "clientId":"gateway-acme","clientSecret":"…",
       "clientRedirectUris":["https://api.example.com/auth/callback"]}'
```

Keep the `id` from the answer: it is the tenant UUID that Data's workspace registry and the access context credential refer to. Then register each principal by the provider's `sub` and grant it a permission on the workspace and on the route the gateway will check (`data-api` in `deploy/config/routes.json`).

The CLI does the same with `platformctl access tenants create`, `access principals create` and `access grants put`, using `PLATFORMCTL_ADMIN_TOKEN` ([CLI spec §5.5](../cli/spec.md#55-access)). The full procedure, including batches and the hand-off to the tenant's administrators, is in [Onboard a tenant](onboard-a-tenant.md); the endpoints are in [Access first tenant](../access/operations.md#first-tenant).

### 7. Register the workspace and start Data

The workspace is Data's unit of access control, and Data reads it from its registry before any principal's context exists. Register it as the schema owner, with the Access tenant UUID from step 6:

```bash
DATA_OWNER_DATABASE_URL=postgres://data_owner:…@postgres:5432/data \
  bun run --cwd packages/data workspace create \
    --id 11111111-1111-4111-8111-111111111111 \
    --tenant <Access tenant UUID> \
    --slug acme
```

Then start the API process. It connects only as `data_runtime` and `data_registry`, never with operator credentials:

```bash
DATA_ENVIRONMENT=production
DATA_PROCESS_ROLE=api
DATA_HOST=0.0.0.0
DATA_DATABASE_URL=postgres://data_runtime:…@postgres:5432/data?sslmode=require
DATA_REGISTRY_DATABASE_URL=postgres://data_registry:…@postgres:5432/data?sslmode=require
DATA_ACCESS_URL=https://access.example.com
DATA_ACCESS_CONTEXT_TOKEN_FILE=/run/secrets/access-context.token
DATA_CURSOR_KEY_FILE=/run/secrets/cursor.key
DATA_GATEWAY_BINDINGS_FILE=/etc/platform/bindings.json
DATA_SCHEMA_BUNDLE_FILE=/app/packages/data/manifests/schema.json
DATA_POLICY_BUNDLE_FILE=/app/packages/data/manifests/policies.json
DATA_METRICS_TOKEN_FILE=/run/secrets/data-metrics-token
```

In production Data refuses a remote database URL without `sslmode=` and an Access URL that is not `https` ([production checks](../data/configuration.md#production-checks)). The bindings file must name the gateway's public host, the forwarded path and the route ID, with the public key from step 2:

```json
{
  "version": 2,
  "bindings": [
    {
      "id": "data-api",
      "host": "api.example.com",
      "upstreamPathPattern": "/ws/{workspaceId}/v1/*",
      "routeId": "data-api",
      "identity": { "version": "v5", "algorithm": "ES256", "publicKeyFile": "/run/secrets/identity-signing.public.pem" }
    }
  ]
}
```

Add `worker` processes when the deployment has delivery subscribers ([process roles](../data/operations.md#process-roles)). Data's `/readyz` stays `503` until its role, its migrations and Access discovery all pass ([Data probes](../data/operations.md#probes)).

### 8. Write the route table

The gateway forwards nothing without a route table. Start from `deploy/config/routes.json`, which sends `/ws/{workspaceId}/` on one host to Data, and set the host to your public name:

```json
{
  "id": "data-api",
  "match": { "host": "api.example.com", "path": "/ws/{workspaceId}/" },
  "upstream": "http://data:8082",
  "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } },
  "websocket": true,
  "accessCacheTtlMs": 0
}
```

The route's `id` must equal the binding's `routeId` and the route in the Access grants, and its host must equal the binding's `host`. The format is in the [gateway spec: configuration file](../gateway/spec.md#3-configuration-file).

You can serve the table from a file (`GATEWAY_CONFIG`, the default `GATEWAY_CONFIG_SOURCE=file`) or from the shared state (`GATEWAY_CONFIG_SOURCE=store`), where the control plane writes revisions ([gateway spec §3.4](../gateway/spec.md#34-route-table-source)). In store mode, publish the first revision once the control plane runs, through its API or the CLI:

```bash
platformctl routes validate ./routes.json
platformctl routes apply ./routes.json
```

The raw `curl` calls (`POST /v1/config/validate`, then `PUT /v1/config` with `If-Match`) are in [changing the route table](../gateway/operations.md#changing-the-route-table). An empty store falls back to the `GATEWAY_CONFIG` file.

### 9. Start the gateway and its control plane

Set `NODE_ENV=production` and every [variable production requires](../gateway/configuration.md#required-in-production). The four provider values point at Access and must match the tenant registration character for character ([Access spec §13.2](../access/spec.md#132-settings-that-must-agree)):

```bash
NODE_ENV=production
GATEWAY_OIDC_ISSUER=https://access.example.com
GATEWAY_OIDC_CLIENT_ID=gateway-acme
GATEWAY_OIDC_CLIENT_SECRET=…
GATEWAY_OIDC_REDIRECT_URI=https://api.example.com/auth/callback
GATEWAY_ACCESS_URL=https://access.example.com
GATEWAY_ACCESS_TOKEN=…
GATEWAY_SESSION_SECRET=…
GATEWAY_IDENTITY_SIGNING_KEY=…
GATEWAY_SESSION_URL=rediss://:…@redis:6379/0
GATEWAY_SHARED_STATE_URL=rediss://:…@redis:6379/1
GATEWAY_RATE_LIMIT_TOTAL_MAX=1000
GATEWAY_METRICS_TOKEN=…
GATEWAY_EXTERNAL_PROTO=https
```

Run the control plane from the same image with the command `bun run src/control-main.ts`, on port `9090`, with its own shared-state user in `GATEWAY_CONTROL_STATE_URL` and its token map in `GATEWAY_CONTROL_TOKENS_FILE`. Keep it on the internal network and never route it through the ingress ([control plane](../gateway/operations.md#control-plane)). Its key prefixes must match the gateway's.

Give gateway pods a grace period longer than `GATEWAY_SHUTDOWN_TIMEOUT_MS` (15 s by default), since that is how long a draining replica keeps serving.

### 10. Put the ingress in front

The ingress terminates TLS for the gateway's public hosts, the Access issuer and the console. For the gateway, turn buffering off, pass WebSocket upgrades, leave paths alone and send `x-forwarded-host` when it rewrites `Host`; the full settings table and an nginx example are in [gateway ingress](../gateway/operations.md#ingress). Then tell the gateway which addresses to trust:

```bash
GATEWAY_TRUSTED_PROXIES=10.0.0.0/8
GATEWAY_TRUSTED_PROXY_HOPS=2   # a load balancer plus an ingress
```

`ACCESS_ISSUER` must be the address that both browsers and the gateway use, so publish Access under exactly that URL.

### 11. Start the console

The console reaches Access directly and Data only through the gateway, like any client. Register `{CONSOLE_PUBLIC_URL}/auth/callback` in the tenant's `clientRedirectUris`, grant operators `console.status`, `console.admin` or `console.platform` on the `console` route with the tenant slug as the workspace, and give the console the matching credentials ([set up Access](../console/operations.md#set-up-access)):

```bash
CONSOLE_PUBLIC_URL=https://console.example.com
CONSOLE_ACCESS_URL=https://access.example.com
CONSOLE_GATEWAY_URL=https://api.example.com
CONSOLE_CLIENT_ID=…
CONSOLE_CLIENT_SECRET=…
CONSOLE_SESSION_SECRET=…
CONSOLE_ACCESS_CONTEXT_TOKEN=…
CONSOLE_TENANT_ADMIN_TOKENS='{"acme":"…"}'
```

Its sessions live in process memory, so run one replica or pin each browser to one ([replicas and limits](../console/operations.md#replicas-and-limits)).

### 12. Start the whole stack in one go (Compose or Kubernetes)

If you deploy with the bundled files, the production Compose stack already encodes the order above through its dependencies: PostgreSQL and Redis, then Access once its role exists, then Data's provisioning and migrations, then Data, then the gateway after Access and Data, with the control plane started as soon as Redis is healthy. The Kubernetes overlay applies all three services at once, so run the migration job and the tenant and workspace registration yourself.

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d

kubectl apply -k deploy/kubernetes/overlays/platform
```

The production Compose stack reads secrets from the shell environment and refuses to start when one is missing; the Kubernetes bases carry only a `secret.example.yaml` naming each key, and you apply the real secrets from your store ([deploy/README.md](../../deploy/README.md#compose-stacks)). Replace every `.env.min` value before real traffic.

### 13. Wire up monitoring

Point your scraper at each `/metrics` endpoint with its token and load the alerts before the first tenant goes live. The signals and thresholds are in [Monitor the platform](monitor-the-platform.md); walk the gateway's [deployment review](../gateway/operations.md#deployment-review) once as well.

## Check that it worked

Each service should report itself alive and ready:

```bash
for port in 8080 8081 8082; do curl -sS http://localhost:$port/healthz; echo; done
for port in 8080 8081 8082; do curl -sS -o /dev/null -w "$port %{http_code}\n" http://localhost:$port/readyz; done
```

Expect `200` on all six; the console answers the same probes on `8083`. From an operator machine, `platformctl status` reads every probe and `platformctl doctor` checks the profile, credential and services together ([CLI usage](../cli/usage.md#everyday-work)).

Then run the end-to-end checks:

1. Run the twelve-call administration session against Access: `ACCESS_URL=https://access.example.com ACCESS_ADMIN_TOKEN=… bun run --cwd packages/access admin:smoke`.
2. Open `https://api.example.com/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me` in a browser and sign in as a principal you granted. Data answers with the principal, tenant and workspace as JSON, which proves the login, the Access decision, the identity signature and Data's access context all work.
3. From a script, the same read is `platformctl data me --workspace 11111111-1111-4111-8111-111111111111` with `PLATFORMCTL_TOKEN` set.
4. Call Data directly, bypassing the gateway: it must answer `401 UNAUTHENTICATED`, because no gateway signed the request.
5. Fetch each `/metrics` with its bearer token and confirm a `200`.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| Access stops with `the environment is invalid:` | [Access start refusals](../access/troubleshooting.md#start-refusals) |
| Access names a role that bypasses tenant isolation | [Access start refusals](../access/troubleshooting.md#start-refusals) |
| The gateway or its control plane refuses to start | [The gateway refuses to start](../gateway/troubleshooting.md#the-gateway-refuses-to-start), [the control plane refuses to start](../gateway/troubleshooting.md#the-control-plane-refuses-to-start) |
| Data stops with `the environment is invalid` | [Data startup](../data/troubleshooting.md#startup-fails-with-the-environment-is-invalid) |
| Data `/readyz` answers `503` | [Data 503 on readiness](../data/troubleshooting.md#503-on-readiness) |
| Every gateway request gets `503 not_ready` | [Gateway: every request gets 503](../gateway/troubleshooting.md#every-request-gets-503-not_ready) |
| `404 no_route` on every request | [Gateway: no route](../gateway/troubleshooting.md#404-no_route-on-every-request) |
| The login fails at Access, or the gateway refuses Access's discovery document | [Access failed logins](../access/troubleshooting.md#failed-logins), [token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems) |
| `403 workspace_forbidden` from the gateway | [Gateway: workspace forbidden](../gateway/troubleshooting.md#403-workspace_forbidden), [Access decisions denied](../access/troubleshooting.md#decisions-denied) |
| Data answers `401 UNAUTHENTICATED` through the gateway | [Data 401](../data/troubleshooting.md#401-unauthenticated) |
| Data answers `503 AUTHORIZATION_UNAVAILABLE` | [Data 503 authorization unavailable](../data/troubleshooting.md#503-authorization_unavailable) |
| Data answers `404 NOT_FOUND` for the new workspace | [Data 404 for an existing workspace](../data/troubleshooting.md#404-not_found-for-an-existing-workspace) |

## Related

- [Platform operations: first deployment](../platform/operations.md#first-deployment)
- [Platform security](../platform/security.md)
- [deploy/README.md](../../deploy/README.md)
- [Gateway operations](../gateway/operations.md)
- [Access operations](../access/operations.md)
- [Data operations](../data/operations.md)
- [Console operations](../console/operations.md)
- [Onboard a tenant](onboard-a-tenant.md)
- [Put a service behind the gateway](put-a-service-behind-the-gateway.md)
- [Monitor the platform](monitor-the-platform.md)
- [Rotate secrets](rotate-secrets.md)
- [Back up and restore](back-up-and-restore.md)
