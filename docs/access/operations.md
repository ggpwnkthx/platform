# Operations

How to deploy, configure, monitor and repair the access service. The contract is in [spec.md](spec.md); endpoints are in [api.md](api.md).

Terms used here: **deployment** means the access service replicas behind the ingress; **database** is the PostgreSQL holding the eight tables; **store** is the Redis holding authorization codes; a **tenant's provider** is that tenant's external identity provider; the **operator** runs the deployment.

## Requirements

| What | Why | Variable |
| --- | --- | --- |
| PostgreSQL | The platform's eight tables. | `ACCESS_DATABASE_URL` |
| Redis | Login authorization codes, shared across replicas. | `ACCESS_REDIS_URL` |
| Issuer | The URL browsers and the gateway use to reach the service. | `ACCESS_ISSUER` |
| Signing key | PEM key for the service's tokens. | `ACCESS_SIGNING_KEY`, `ACCESS_SIGNING_KID` |
| State secret | Signs and encrypts login state. | `ACCESS_STATE_SECRET` |
| Secret encryption key | Encrypts tenant client secrets at rest. | `ACCESS_SECRET_ENCRYPTION_KEY` |
| Admin token | It guards the twelve administrative endpoints. | `ACCESS_ADMIN_TOKEN` |
| Tenant gateway credentials | Presented by the gateway on decisions; scoped to the tenant. | The tenant registration, §3.1 |
| Decision token | Shared deployment bearer token. **Optional and deprecated**: not scoped to a tenant. | `ACCESS_DECISION_TOKEN` |

All variables are listed in §4; `.env.example` has the same list with local development values.

In **production** (`ACCESS_ENVIRONMENT=production`) the service refuses to start if any of the eight required variables is missing, and reports every problem at once by variable name.

The shared decision token is not required: once every gateway uses its tenant's credentials, leave it unset and the service refuses the bearer scheme (§8.8). Setting `ACCESS_PREVIOUS_DECISION_TOKEN` without `ACCESS_DECISION_TOKEN` is refused, because the shared secret would still be accepted after you meant to remove it.

### Database role

Tenant isolation is enforced by table policies, which only bind roles subject to them. Production refuses to start with a superuser or a role with `BYPASSRLS` (§3.10). Use a non-superuser role that owns the tables:

```sql
create role access_app login password '…';
alter database platform owner to access_app;
grant usage, create on schema public to access_app;
```

Migrations run as that role, so it owns the tables it creates.

### Database version

The repository is developed and tested against **PostgreSQL 18**: local compose, CI jobs and release gates run it, and the embedded `pglite` is PostgreSQL 18.6. One version everywhere means a migration the tests accept is one CI accepts.

A deployment names its server in `ACCESS_DATABASE_URL`, and the service **does not read its version** (§3.9). The schema uses nothing newer than PostgreSQL 13 (row level security, `coalesce` in a unique index, constraint triggers, `set_config` for the scope), so it does not constrain the deployment's database version.

### Replica environment

```
ACCESS_ENVIRONMENT=production
ACCESS_HOST=0.0.0.0
ACCESS_PORT=8081
ACCESS_ISSUER=https://access.example.com
ACCESS_PUBLIC_URL=https://access.example.com
ACCESS_DATABASE_URL=postgres://access_app:…@postgres:5432/platform
ACCESS_REDIS_URL=redis://redis:6379/0
ACCESS_ADMIN_TOKEN=…
ACCESS_DECISION_TOKEN=…
ACCESS_METRICS_TOKEN=…
ACCESS_STATE_SECRET=…            # 32 bytes at least, the same on every replica
ACCESS_SECRET_ENCRYPTION_KEY=…   # 32 bytes at least
ACCESS_SIGNING_KEY=…             # PEM
ACCESS_SIGNING_KID=access-1
ACCESS_LOG_LEVEL=info
```

**Secrets may come from files.** Any secret can be given as `ACCESS_<NAME>_FILE` instead of `ACCESS_<NAME>`; the file's trailing newline is stripped. Setting both is an error, and an unreadable file stops the service (§4.5).

```
ACCESS_SIGNING_KEY_FILE=/run/secrets/access-signing-key.pem
ACCESS_ADMIN_TOKEN_FILE=/run/secrets/access-admin-token
```

This is how secrets reach containers: a secret manager writes the file, and a private key never passes through a shell that could mangle it.

### Image

The image runs as non-`root` and writes nothing, so the container file system can be read-only apart from the runtime's temporary directory. Logs go to standard output.

```bash
docker build -f Dockerfile -t access:$(git rev-parse --short HEAD) \
  --build-arg REVISION=$(git rev-parse HEAD) \
  --build-arg VERSION=$(node -p "require('./package.json').version") .
```

The base image is pinned by digest. For image delivery, see [release.md](release.md#5-delivery).

### First tenant

1. **Register the tenant** with its provider and gateway:
   ```bash
   export ACCESS=https://access.example.com
   curl -sS -X POST $ACCESS/v1/admin/tenants \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
     -H "content-type: application/json" \
     -d '{"slug":"acme","displayName":"Acme Inc","issuer":"https://login.acme.example",
          "idpClientId":"access-acme","idpClientSecret":"…",
          "idpRedirectUri":"https://access.example.com/oauth/tenant/callback",
          "emailDomain":"acme.example","clientId":"gateway-acme","clientSecret":"…","clientRedirectUris":["https://gateway-acme.example.com/auth/callback"]}'
   ```
2. **Register principals**, one call per external identity:
   ```bash
   curl -sS -X POST $ACCESS/v1/admin/users \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
     -H "content-type: application/json" \
     -d '{"tenant":"acme","externalSubject":"00u1a2b3c4d5","email":"alice@acme.example"}'
   ```
3. **Create grants**, one call per permission on a workspace and route:
   ```bash
   curl -sS -X PUT $ACCESS/v1/admin/grants \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
     -H "content-type: application/json" \
     -d '{"tenant":"acme","userId":"b1c2…","permission":"workspace.read",
          "workspaceId":"11111111-1111-4111-8111-111111111111","routeId":"workspace-api"}'
   ```
4. **Configure the gateway deployment:**
   ```
   GATEWAY_OIDC_ISSUER=https://access.example.com
   GATEWAY_OIDC_CLIENT_ID=gateway-acme
   GATEWAY_OIDC_CLIENT_SECRET=the-secret-of-the-gateway
   GATEWAY_OIDC_REDIRECT_URI=https://gateway-acme.example.com/auth/callback
   GATEWAY_ACCESS_URL=https://access.example.com
   GATEWAY_ACCESS_TOKEN=the-access-token-of-the-access-service
   GATEWAY_SESSION_SECRET=the-secret-of-the-sessions
   GATEWAY_IDENTITY_SIGNING_KEY=the-private-key-of-the-deployment
   ```
   Both sides must match character for character (§13.2). The last two belong to the gateway, not the access service: gateway `1.0.0` and later refuse to start in production without the browser session secret and the private key that signs request identities (upstreams verify with the deployment's public key).
5. **Check** with the twelve calls of the session:
   ```bash
   ACCESS_URL=https://access.example.com ACCESS_ADMIN_TOKEN=… bun run scripts/cli/admin-smoke.ts
   ```

## Probes

| Probe | Purpose |
| --- | --- |
| `GET /healthz` | Liveness: `200` while the process is alive. |
| `GET /readyz` | Readiness: the database answers and migrations are applied. `503 {"status":"draining"}` during a drain, which gates rolling replacement. |

## Metrics

Served at `/metrics`; requires `ACCESS_METRICS_TOKEN`.

| Metric | Type | Labels |
| --- | --- | --- |
| `access_decisions_total` | counter | `result` (`allow`, `deny`), `tenant` |
| `access_decision_duration_seconds` | histogram | `tenant` |
| `access_logins_total` | counter | `result` (`success`, `refused`, `error`), `tenant` |
| `access_admin_requests_total` | counter | `endpoint`, `status` |
| `access_store_errors_total` | counter | `store` (`redis`, `postgres`) |

The `tenant` label is bounded at a hundred values, then `overflow`, so neither callers nor providers can grow series without limit.

## Alerts

Each alert is backed by a service metric.

| # | Alert | Expression | For | Meaning |
| --- | --- | --- | --- | --- |
| 1 | **Denial rate** | `rate(access_decisions_total{result="deny"}[5m]) / rate(access_decisions_total[5m]) > 0.2` | 10 min | A fifth of requests are denied: a tenant that grants nothing, or an attack. The reason is in the decision log. |
| 2 | **Decision latency** | `histogram_quantile(0.99, rate(access_decision_duration_seconds_bucket[5m])) > 0.02` | 5 min | The decision is on every gateway request's path. Target: 20 ms at `p99`. |
| 3 | **Login failures** | `rate(access_logins_total{result!="success"}[10m]) > 0.1` | 10 min | Tenant logins fail: a provider is down, a tenant is disabled, or login state is refused. |
| 4 | **Store failures** | `rate(access_store_errors_total[5m]) > 0` | 5 min | Database or store unreachable. Readiness turns `503` and the deployment leaves rotation. |
| 5 | **Pool saturation** | `pg_stat_activity_count{application_name='access'} > 7` | 5 min | The database pool is at 70 % (10 connections per replica). |
| 6 | **Schema older than code** | New replicas stay `503 not-ready` and the start log names a migration the code does not know | 5 min | The service refuses to start against a schema it does not understand (§3.8); migrations are applied before the listener accepts. Schema age is not a metric: readiness is the signal. |
| 7 | **Admin refusals** | `rate(access_admin_requests_total{status="401"}[5m]) > 0` | 5 min | Someone is guessing the admin token. The limiter refuses the address after five failures (`429`). |
| 8 | **Readiness** | `probe_success{job="access"} == 0` | 2 min | Replicas fail readiness: the database does not answer, or the deployment is draining. |

Four more need platform metrics: replicas not ready (the `/readyz` probe), pod memory (200 MB), the ingress certificate, and the age of the last database dump.

> [!IMPORTANT]
> Alerts never restart replicas automatically. A replica that cannot reach the database restarts and fails again, and restarts hide the cause. A person reads the alert and follows the runbook.

## Runbooks

### A tenant's provider is down

**Symptoms.** That tenant's logins get `502 upstream_unavailable` and `access_logins_total{result="refused"}` grows. Other tenants keep working, since providers are called per tenant.

1. Check the provider answers:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://login.acme.example/.well-known/openid-configuration
   ```
2. Repeat the call from a replica's pod to check the deployment can reach it.
3. If the provider is down, there is nothing to do: that tenant's logins fail and other tenants are unaffected.
4. Logins resume on their own once the provider is back; discovery and keys are cached for ten minutes.

**Don't** raise the provider timeout: a slow provider must not hold logins (`ACCESS_IDP_TIMEOUT_MS`, default 5 s).

### Database is down

**Symptoms.** Readiness answers `503 not-ready` and the deployment leaves rotation. Decisions answer `503 service_unavailable` and the gateway denies requests (fails closed).

1. Check the database:
   ```bash
   pg_isready -h "$ACCESS_DATABASE_HOST" -p 5432 -U access_app -d platform
   ```
2. Check the replicas' pools: `access_store_errors_total{store="postgres"}` grows and readiness is `503`.
3. **Replicas do not start** against an unreachable database, because migrations run before the listener accepts. This is deliberate: the service never starts against a schema it does not understand.
4. Once the database answers, replicas start and readiness recovers on its own.

Decisions are not cached, so none can be served while the database is down: a decision that cannot be computed is a denial.

### Store is down

**Symptoms.** Logins that reach the exchange fail because the code cannot be stored; `access_store_errors_total{store="redis"}` grows. Decisions keep working: they do not use the store.

1. Check the store:
   ```bash
   redis-cli -u "$ACCESS_REDIS_URL" ping
   ```
2. **A down store is an error, never a silent allow**: no login succeeds without its code. Callers retry the login.
3. A single-node deployment can start with `ACCESS_ALLOW_MEMORY_STATE=true`: codes then live in the process and are lost on restart. Multi-replica deployments cannot, because one replica's codes are unknown to the others.

### Startup refused: database role bypasses isolation

**Symptoms.** The process stops with `the role "<role>" of the database bypasses the isolation of the tenants` and never accepts a request.

**Cause.** Tenant isolation relies on the eight tables' policies, which only bind roles subject to them (§3.10).

1. Inspect the deployment's role:
   ```bash
   psql "$ACCESS_DATABASE_URL" -c "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user"
   ```
2. Create a non-superuser role that owns the tables (see [Database role](#database-role)).
3. Point `ACCESS_DATABASE_URL` at that role and roll the deployment.

**Don't** add `BYPASSRLS` to the role to get the service running: tenant isolation would become a promise rather than a rule.

### Tenant misconfigured

A tenant registered with the wrong issuer, client id or redirect URI fails its own logins; other tenants are unaffected.

1. Find the tenant:
   ```bash
   curl -sS https://access.example.com/v1/admin/tenants \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
   ```
2. Fix it with the same create call: the slug is the key and the call is an upsert (see [`POST /v1/admin/tenants`](api.md#post-v1admintenants)).
3. Provider discovery and keys are cached for ten minutes, so a corrected tenant that still fails is hitting the cache. Wait ten minutes or roll the deployment.

A tenant that uses another tenant's client id gets `409 conflict`: a gateway client id belongs to one tenant (§3.1).

### Signing key missing

**Symptoms.** The service starts with the warning `the service cannot issue a token: it has no signing key`. Logins fail at the exchange and the JWKS is empty.

**Fix.** Set `ACCESS_SIGNING_KEY` and `ACCESS_SIGNING_KID` and roll the deployment. In production the service refuses to start without them.

### Service is slow

1. Readiness: `503 not-ready` means the database is not answering.
2. Metrics: `access_decision_duration_seconds` gives decision latency per tenant; `access_store_errors_total` gives store failures.
3. Statement log: statements slower than 50 ms log a warning (`the statement is slow`).
4. Pool: the service's database connections are visible in `pg_stat_activity`.

## Rotating secrets

Each secret rotates differently.

### Secret encryption key (`ACCESS_SECRET_ENCRYPTION_KEY`)

1. Generate a key: `openssl rand -base64 32`.
2. Re-encrypt stored secrets in one transaction:
   ```bash
   ACCESS_DATABASE_URL=postgres://… \
   ACCESS_SECRET_ENCRYPTION_KEY=the-old-key \
   ACCESS_NEW_SECRET_ENCRYPTION_KEY=the-new-key \
   bun run scripts/cli/rotate-secrets.ts
   ```
   The script prints how many tenants it re-encrypted, never a secret. On failure, stored secrets are left exactly as they were.
3. Set the new `ACCESS_SECRET_ENCRYPTION_KEY` and roll the deployment.
4. Check tenant logins still work by running `scripts/cli/admin-smoke.ts` against the deployment.

### Signing key (`ACCESS_SIGNING_KEY`)

1. Generate a key: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`.
2. Move the **old** key to `ACCESS_PREVIOUS_SIGNING_KEY` (with `ACCESS_PREVIOUS_SIGNING_KID`) and put the **new** one in `ACCESS_SIGNING_KEY`.
3. Roll the deployment. The JWKS publishes both keys, so tokens signed with the old key stay valid.
4. Once the last old-key token has expired (five minutes), remove `ACCESS_PREVIOUS_SIGNING_KEY` and roll again.

### State secret (`ACCESS_STATE_SECRET`)

Change the value and roll the deployment. In-flight logins are lost and the browser must start again.

### Service tokens (`ACCESS_ADMIN_TOKEN`, `ACCESS_DECISION_TOKEN`)

Rotation is **rolling**: the current value and the one it replaces are both accepted until the old one is removed (§4.3.1).

1. Copy the current values to `ACCESS_PREVIOUS_ADMIN_TOKEN` and `ACCESS_PREVIOUS_DECISION_TOKEN` and roll the deployment. Nothing changes yet.
2. Change `ACCESS_ADMIN_TOKEN` and `ACCESS_DECISION_TOKEN` and roll. **The gateway uses the same value (§13.2): change it on the gateway first.**
3. Remove both `ACCESS_PREVIOUS_*` variables and roll again. Old values are refused from then on.

The window between steps 2 and 3 is how long it takes to update every gateway; no call is refused during it.

**Retiring the shared token.** Once every gateway presents its tenant's credentials, remove `ACCESS_DECISION_TOKEN` and `ACCESS_PREVIOUS_DECISION_TOKEN` together and roll. The bearer scheme is refused from then on, and the platform-wide secret is gone.

## Backup and restore

The eight tables are the service's only data. Everything else is derived: login state is in the browser cookie, login codes live in the store for sixty seconds, and tokens are signed. **Backing up the database backs up the service.** The code store is not backed up; a lost code only means the login restarts.

### Dump

```bash
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --file "access-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$ACCESS_DATABASE_URL"
```

Write the dump outside the pod and keep it with the platform's other backups.

### Restore

```bash
createdb --owner=access_app access_restore
pg_restore --dbname=access_restore --no-owner --no-privileges \
  --exit-on-error access-20260108T100000Z.dump
```

Rehearse the restore outside production once a quarter and before any change to the backup process. The rehearsal checks:

1. The dump restores without error (`pg_restore --exit-on-error`).
2. The eight tables are present with their constraints and indexes:
   ```sql
   select count(*) from tenants;
   select count(*) from users;
   select count(*) from permissions;
   select count(*) from grants;
   select count(*) from groups;
   select indexname from pg_indexes where tablename = 'grants';
   ```
3. The current release runs against it: start the service with `ACCESS_ENVIRONMENT=development` and check the probes. Migrations run against an up-to-date database and change nothing.

| Measurement | Target |
| --- | --- |
| Recovery point objective | 24 h |
| Recovery time objective | 2 h |
| Rehearsal | Once a quarter, in the rehearsal environment |

**Migrations and backups.** Migrations are backward compatible for one release, so rolling back the image never requires rolling back the schema. A column is dropped two releases after the code stops using it. A dump taken before a migration restores with the old schema, and the runner applies the missing migrations; migration bookkeeping lives in the database (`access_schema_migrations`).

## Capacity

These numbers are **measured**, not estimated, each by a repository script on the named environment. Unmeasured numbers are not published.

```
ACCESS_DATABASE_URL=postgres://… bun run scripts/ops/load.ts --requests 20000 --concurrency 100
```

The script measures the **production statement**: it calls the service's decision repository with the deployment's deadline. It runs on every CI build against the job's PostgreSQL, and the numbers are in the build log.

**The measurement is a gate.** With thresholds, a measurement outside them fails the run:

```
ACCESS_DATABASE_URL=postgres://… bun run scripts/ops/load.ts --requests 20000 --concurrency 100 \
  --max-p50-ms=25 --max-p95-ms=50 --max-p99-ms=100 --min-per-second=100
```

| Option | Fails when |
| --- | --- |
| `--max-p50-ms` | `p50` is above the value. |
| `--max-p95-ms` | `p95` is above the value. |
| `--max-p99-ms` | `p99` is above the value. |
| `--min-per-second` | Throughput is below the value. |

CI thresholds are far above the targets below because CI runners are shared machines. The gate catches a decision that got slower (a changed plan, a dropped index, a statement scanning the policy table) without failing on a busy runner. Without thresholds, the script only measures and reports, and exits with the measurement's status.

### Targets

| Measurement | Target | Shape |
| --- | --- | --- |
| Decision, `p50` | ≤ 3 ms | One principal, a hundred grants. |
| Decision, `p99` | ≤ 20 ms | Same. |
| Decision under load | ≤ 50 ms at `p99` | 500 decisions per second, two replicas. |
| Database pool | ≤ 70 % used at peak | 10 connections per replica. |
| Login, broker overhead | ≤ 150 ms | Time spent in the access service around the provider round trip. |
| Process memory | ≤ 200 MB | 1 000 concurrent logins. |
| Decisions per second per replica | ≥ 500 | The shape above. |

### Measured

**PostgreSQL server.** PostgreSQL 18 over loopback on a 16-core development machine (load average one), five thousand requests, twenty in flight, one principal with a hundred grants. Median of three runs:

| Measurement | Platform decision | Tenant decision |
| --- | --- | --- |
| `p50` | 1.44 ms | 1.95 ms |
| `p95` | 1.85 ms | 2.81 ms |
| `p99` | 2.49 ms | 3.87 ms |
| Decisions per second | 13 639 | 9 765 |

The columns are the two §8.8 paths. A **platform decision** uses the deployment bearer token (the reference gateway's scheme). A **tenant decision** uses tenant credentials, whose scope needs a transaction because statement scope is transaction-local; that costs about a third more time.

The targets are met on this machine. Deployment numbers are measured with the same script against the deployment's server and published here once measured.

**Embedded PostgreSQL** (one connection, so requests are serialized), 1 000 requests, one principal with a hundred grants:

| Measurement | Value |
| --- | --- |
| `p50` | 0.45 ms |
| `p95` | 0.57 ms |
| `p99` | 0.64 ms |
| Maximum | 0.71 ms |
| Decisions per second | 2 146 |

With twenty requests in flight, `p50` is 42.7 ms and `p99` is 48.9 ms at the same throughput: the single connection's queue is the limit. That is a property of the **measurement environment**, not of the query.

Query plan with 1 000 principals and 1 000 000 grants, for a principal holding a thousand:

| Measurement | Value |
| --- | --- |
| Plan | `Bitmap Index Scan on grants_user_live`, `Index Cond: (user_id = u.id)` |
| Execution time | 1.5 ms |

The planner uses the index from the spec; the decision never scans the policy table.

### Not measured here

These are **not** deployment numbers: the embedded database is not a PostgreSQL server, and a CI runner is not deployment hardware. Pool saturation, process memory under a thousand logins and broker overhead need deployment hardware; they are measured during the first tenant's cutover ([release.md](release.md#4-tenant-cutover)).

### Tuning

| Knob | Effect | Limit |
| --- | --- | --- |
| `ACCESS_DECISION_TIMEOUT_MS` | Decision ceiling and pool statement deadline | 2 000 ms |
| `ACCESS_PREVIOUS_ADMIN_TOKEN` | The replaced token, during a rotation | — |
| `ACCESS_PREVIOUS_DECISION_TOKEN` | The replaced token, during a rotation | — |
| Pool size | Database concurrency | 10 per replica |
| Provider JWKS cache | Calls to a tenant's provider | 10 minutes |
| Provider discovery cache | Calls to a tenant's discovery | 10 minutes |
| Code lifetime | Replay window | 60 s |

## Compatibility suite offline

The compatibility suite clones the reference gateway, which needs network access. Offline, give the runner a mirror (`COMPAT_MIRROR`), a local repository (`GATEWAY_REPOSITORY=/path/to/platform bun run test:compat`), or an already-prepared checkout, which is checked before the run (`ACCESS_GATEWAY_PATH=/path/to/platform bun run test:compat`). An unusable override is an error; the runner never falls back. See [Compatibility](compatibility.md#reference-sources) for setup and precedence.
