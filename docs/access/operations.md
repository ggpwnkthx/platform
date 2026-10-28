# Operations

Deploy, configure, monitor, repair and cut tenants over to the access service. Behavior is in [spec.md](spec.md), endpoints in [api.md](api.md), and procedures shared by all services in [platform operations](../platform/operations.md).

## Requirements

| What | Variable |
| --- | --- |
| PostgreSQL for the eight tables | `ACCESS_DATABASE_URL` |
| Redis for login codes, shared by all replicas | `ACCESS_REDIS_URL` |
| URL browsers and the gateway use | `ACCESS_ISSUER` |
| PEM key that signs the service's tokens | `ACCESS_SIGNING_KEY`, `ACCESS_SIGNING_KID` |
| Secret that signs and encrypts login state | `ACCESS_STATE_SECRET` |
| Key that encrypts tenant client secrets at rest | `ACCESS_SECRET_ENCRYPTION_KEY` |
| Token that guards the twelve administrative endpoints | `ACCESS_ADMIN_TOKEN` |
| Tenant gateway credentials, scoped to the tenant | Tenant registration (§3.1) |
| Shared decision token: **optional, deprecated**, unscoped | `ACCESS_DECISION_TOKEN` |

All variables are in §4 and, with local values, in `.env.example`. With `ACCESS_ENVIRONMENT=production` the service refuses to start if any of the eight required variables is missing, and names every problem at once.

Once every gateway presents tenant credentials, leave `ACCESS_DECISION_TOKEN` unset and the bearer scheme is refused (§8.8). `ACCESS_PREVIOUS_DECISION_TOKEN` without `ACCESS_DECISION_TOKEN` is refused, since the old shared secret would stay valid.

### Database role

Table policies only bind roles subject to them, so production refuses a superuser or a `BYPASSRLS` role (§3.10). Use a non-superuser role that owns the tables; migrations run as it:

```sql
create role access_app login password '…';
alter database platform owner to access_app;
grant usage, create on schema public to access_app;
```

The repository is tested on PostgreSQL 18 (embedded `pglite` is 18.6). The service never reads the server version (§3.9), and the schema needs nothing newer than PostgreSQL 13.

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

Give secrets as files, for example `ACCESS_SIGNING_KEY_FILE=/run/secrets/access-signing-key.pem`, so a private key never passes through a shell. The trailing newline is stripped; setting both forms is an error, and an unreadable file stops the service (§4.5).

### Image

The image runs as non-`root` with no shell, writes nothing (mount it read-only apart from the runtime's temporary directory) and logs to standard output. Build from the repository root; labels carry version and revision:

```bash
docker build -f packages/access/Dockerfile -t access:$(git rev-parse --short HEAD) \
  --build-arg REVISION=$(git rev-parse HEAD) \
  --build-arg VERSION=$(node -p "require('./packages/access/package.json').version") .
docker image inspect access:<tag> --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

Promote one **digest** from development to staging to production, by rolling replacement gated on readiness. A replica drains on `SIGTERM` (§12.4): give it a 10 s grace period and let the rollout wait for the pod to be gone. To roll back, redeploy the previous digest; migrations are backward compatible for one release. Rehearse it:

```bash
kubectl -n platform rollout undo deployment/platform-access
kubectl -n platform rollout status deployment/platform-access
```

## First tenant

1. **Register the tenant** with its provider and gateway (upsert by slug):
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
2. **Register principals**, one per external identity ([`POST /v1/admin/users`](api.md#post-v1adminusers)).
3. **Create grants**, one per permission on a workspace and route ([`PUT /v1/admin/grants`](api.md#put-v1admingrants)).
4. **Configure the gateway**; values must match character for character (§13.2):
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
   The last two are the gateway's own; gateway `1.0.0` and later refuse to start in production without them.
5. **Check** with the twelve calls of the session:
   ```bash
   ACCESS_URL=https://access.example.com ACCESS_ADMIN_TOKEN=… bun run scripts/cli/admin-smoke.ts
   ```

## Monitoring

`GET /readyz` gates rolling replacement: `503` when the database is down or migrations are missing, `503 {"status":"draining"}` during a drain. `GET /healthz` is liveness. Metrics are at `/metrics` behind `ACCESS_METRICS_TOKEN` (§12.2).

| # | Alert | Expression | For | Meaning |
| --- | --- | --- | --- | --- |
| 1 | Denial rate | `rate(access_decisions_total{result="deny"}[5m]) / rate(access_decisions_total[5m]) > 0.2` | 10 min | A tenant grants nothing, or an attack; reasons are in the decision log. |
| 2 | Decision latency | `histogram_quantile(0.99, rate(access_decision_duration_seconds_bucket[5m])) > 0.02` | 5 min | Target is 20 ms at `p99`. |
| 3 | Login failures | `rate(access_logins_total{result!="success"}[10m]) > 0.1` | 10 min | Provider down, tenant disabled, or state refused. |
| 4 | Store failures | `rate(access_store_errors_total[5m]) > 0` | 5 min | Database or store unreachable. |
| 5 | Pool saturation | `pg_stat_activity_count{application_name='access'} > 7` | 5 min | Pool at 70 % of 10. |
| 6 | Schema older than code | New replicas stay `503 not-ready`; the start log names an unknown migration | 5 min | Refused schema (§3.8); not a metric. |
| 7 | Admin refusals | `rate(access_admin_requests_total{status="401"}[5m]) > 0` | 5 min | Token guessing; five failures get `429`. |
| 8 | Readiness | `probe_success{job="access"} == 0` | 2 min | Database down, or draining. |

Platform metrics cover four more: replicas not ready, pod memory (200 MB), the ingress certificate, and the last dump's age.

> [!IMPORTANT]
> Alerts never restart replicas: a replica that cannot reach the database fails again, and restarts hide the cause. A person follows the runbook.

## Runbooks

| Symptom | Check | Fix |
| --- | --- | --- |
| One tenant's logins get `502 upstream_unavailable` | `curl -sS -o /dev/null -w '%{http_code}\n' https://login.acme.example/.well-known/openid-configuration`, also from a pod | Wait: other tenants work, and logins resume once the provider is back (caches last ten minutes). Don't raise `ACCESS_IDP_TIMEOUT_MS` (5 s). |
| Readiness `503 not-ready`; decisions `503 service_unavailable` and the gateway denies | `pg_isready -h "$ACCESS_DATABASE_HOST" -p 5432 -U access_app -d platform` | Restore the database. Replicas start only once it answers. Decisions are never cached. |
| Logins fail at the exchange; decisions work | `redis-cli -u "$ACCESS_REDIS_URL" ping` | Restore the store; callers retry. Only a single node may set `ACCESS_ALLOW_MEMORY_STATE=true` (codes die with the process). |
| Start stops: `the role "<role>" of the database bypasses the isolation of the tenants` | `psql "$ACCESS_DATABASE_URL" -c "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user"` | Point `ACCESS_DATABASE_URL` at a [non-superuser owner role](#database-role) and roll. Never add `BYPASSRLS`. |
| One tenant's logins fail after registration | `curl -sS $ACCESS/v1/admin/tenants -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"` | Repeat the [create call](api.md#post-v1admintenants) with the right issuer, client id or redirect URI; wait ten minutes or roll for the cache. A client id owned by another tenant gets `409 conflict`. |
| Warning `the service cannot issue a token: it has no signing key`; JWKS empty | Environment | Set `ACCESS_SIGNING_KEY` and `ACCESS_SIGNING_KID`, roll. |
| Slow | `access_decision_duration_seconds`; `access_store_errors_total`; log `the statement is slow` (over 50 ms); `pg_stat_activity` | Fix the slow dependency. |

## Rotating secrets

**Secret encryption key.** Generate one (`openssl rand -base64 32`) and re-encrypt in one transaction; the script prints a tenant count, never a secret, and changes nothing on failure. Then set the new key, roll, and run `scripts/cli/admin-smoke.ts`.

```bash
ACCESS_DATABASE_URL=postgres://… ACCESS_SECRET_ENCRYPTION_KEY=the-old-key \
ACCESS_NEW_SECRET_ENCRYPTION_KEY=the-new-key bun run scripts/cli/rotate-secrets.ts
```

**Signing key.** Generate one (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`). Move the old key to `ACCESS_PREVIOUS_SIGNING_KEY` and `ACCESS_PREVIOUS_SIGNING_KID`, set the new one, and roll; the JWKS publishes both. After five minutes, remove the previous key and roll.

**State secret.** Change it and roll; in-flight logins restart.

**Admin and decision tokens** rotate rolling (§4.3.1):

1. Copy the current values to `ACCESS_PREVIOUS_ADMIN_TOKEN` and `ACCESS_PREVIOUS_DECISION_TOKEN`; roll.
2. Change the gateway's copy, then `ACCESS_ADMIN_TOKEN` and `ACCESS_DECISION_TOKEN`; roll.
3. Once every gateway is updated, remove both `ACCESS_PREVIOUS_*` variables; roll. Nothing is refused before this step.

To retire the shared token, remove `ACCESS_DECISION_TOKEN` and `ACCESS_PREVIOUS_DECISION_TOKEN` together.

## Backup and restore

The eight tables are the only data; login state lives in the cookie, codes for sixty seconds in the store, and tokens are signed. Back up the database only.

```bash
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --file "access-$(date -u +%Y%m%dT%H%M%SZ).dump" "$ACCESS_DATABASE_URL"
createdb --owner=access_app access_restore
pg_restore --dbname=access_restore --no-owner --no-privileges \
  --exit-on-error access-20260108T100000Z.dump
```

Store dumps outside the pod. Each quarter, and before changing the backup process, rehearse a restore outside production: no error; tables and the `grants` indexes present (`select indexname from pg_indexes where tablename = 'grants'`); the current release starts on it with `ACCESS_ENVIRONMENT=development` and applies no migration. Targets: recovery point 24 h, recovery time 2 h. An older dump restores with its schema, and the runner applies the missing migrations (tracked in `access_schema_migrations`).

## Tuning

| Knob | Effect | Limit |
| --- | --- | --- |
| `ACCESS_DECISION_TIMEOUT_MS` | Decision ceiling and pool statement deadline | 2 000 ms |
| Pool size | Database concurrency | 10 per replica |
| Provider JWKS and discovery caches | Calls to a tenant's provider | 10 minutes |
| Code lifetime | Replay window | 60 s |

Capacity targets and measurements: [Internals](internals.md#capacity).

## Hardening

- Move gateways to tenant credentials, then unset `ACCESS_DECISION_TOKEN` ([open finding 2](internals.md#open-findings)).
- Register tenants with `https` issuers; over `http` the provider secret and id token travel in clear (finding 3).
- Give operators per-tenant credentials in `ACCESS_ADMIN_TOKENS` (§4.6), so the audit names them.
- Production refuses provider issuers that resolve to private addresses.

Platform-wide model: [platform security](../platform/security.md). Review: [Internals](internals.md#security-review).

## Rollout

| Phase | State | Rollback |
| --- | --- | --- |
| 0. Dark | Deployed with probes, metrics and alerts; nobody calls it. | Stop it. |
| 1. Shadow | Answers decisions alongside the old service; daily [comparison](#shadow-comparison). | Stop the shadow. |
| 2. First tenant, staging | One tenant lives here. | Point its gateway back; data stays. |
| 3. First tenant, production | Real traffic for a week, then the second tenant. | Same. |
| 4. Last tenant | Decommission the old service. | Its data is kept for the audit retention period. |

Switching a tenant changes four gateway settings: issuer, client id, client secret, access URL. Callers log in again; there is no other interruption.

## Shadow comparison

```
OLD_ACCESS_URL=https://old-access.example.com OLD_ACCESS_TOKEN=… \
ACCESS_URL=https://access.example.com ACCESS_DECISION_TOKEN=… \
bun run scripts/compat/shadow.ts --requests decisions.jsonl
```

Each line of `decisions.jsonl` is `{"subject":"…","workspaceId":"…","routeId":"…","roles":[]}`. The tool asks both services, reports differences per subject and workspace with a fingerprint that makes a recurring set recognisable, and **exits non-zero while any difference remains**. Only the old service's hard-coded decisions may differ; anything else is a bug here. It never writes to either service.

## Tenant cutover

Gates for every phase: `bun run test:compat` green, [alerts](#monitoring) silent, zero shadow differences.

**Staging.**

1. Register the tenant ([First tenant](#first-tenant)).
2. Register principals, keyed by the provider's `sub` (§6.2), in one batch (§10.4).
3. Create grants in one batch (§10.6), copying the first ones from the old service.
4. Run the shadow for a day.
5. Point the staging gateway at this service.
6. A browser logs in and reaches a staging upstream; gateway metrics count this service's decisions.

**Production.** Record the gateway's configuration and apply it once on staging to prove the rollback. Repeat the steps, switch, and watch login refusals, latency and denials for a day. Roll back by restoring the gateway configuration; this service keeps its data.

Never during cutover: gateway code changes, data migration from the old service, gateway session changes, schema changes.

- [ ] Tenant, principals and grants registered.
- [ ] A day at zero shadow differences; compatibility suite green.
- [ ] The twelve calls of the session answer (`scripts/cli/admin-smoke.ts`).
- [ ] Signing key is the environment's; the gateway uses the same issuer.
- [ ] Gateway rollback written down; dashboards watched the first day.
