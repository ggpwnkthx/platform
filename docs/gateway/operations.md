# Operations

How to deploy, run and recover the gateway. Platform-wide steps (first deployment, images, rollback) are in
[platform operations](../platform/operations.md); every variable is in [Configuration](configuration.md).

The gateway is stateless: sessions, rate-limit windows and cached decisions live in Redis or Postgres, so you
can replace any replica at any time. An ingress terminates TLS in front of it.

## Deploy

1. Follow the [platform first deployment](../platform/operations.md#first-deployment).
2. Set the [variables production requires](configuration.md#required-in-production): session secret,
   identity signing key, OIDC client, access service, at least one rate limit, and shared state. Use the
   same `GATEWAY_SESSION_SECRET` and `GATEWAY_IDENTITY_SIGNING_KEY` on every replica.
3. Choose a [shared-state backend](#shared-state) and create its [roles](#roles).
4. Put an [ingress](#ingress) in front.
5. Run the [control plane](#control-plane) to manage routes or sessions at runtime.
6. Set up [monitoring](#monitoring) and walk the [deployment review](#deployment-review).

## Shared state

The URL scheme picks the backend, for example `rediss://:<password>@redis:6379/0` or
`postgres://user:<password>@postgres:5432/gateway`; cluster and Sentinel URLs are in
[spec §4](spec.md#4-environment). Verify the server certificate with `GATEWAY_SESSION_TLS_CA` and
`GATEWAY_SHARED_STATE_TLS_CA`.

Both backends pass the same tests. Redis is faster; Postgres roughly halves request-path throughput.
Compare them on your servers with `bun run benchmark` ([measurements](internals.md#shared-state-backends),
[spec §12.6](spec.md#126-backend-comparison)).

Postgres notes:

- **Schema** (`gateway.sessions`, `gateway.access_decisions`, `gateway.rate_limit_buckets` and two
  functions) is built on connect when `GATEWAY_POSTGRES_AUTO_MIGRATE=true`, the default outside production.
  To apply it yourself, set `false` and run `bun run postgres:migrate -- postgres://user:<password>@host:5432/gateway`.
- **Pool**: ten connections per replica; the server needs replicas × pool. For many replicas add a pooler
  rather than a bigger pool.
- **Durability**: `GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT=off` by default; a crash costs a caller at most a few
  requests of budget ([spec §12.5](spec.md#125-shared-state)).

### Roles

The gateway reads the route table and writes nothing in it; only the control plane writes it
([spec §12.8](spec.md#128-shared-state-roles)).

| Backend | Gateway | Control plane | Setup |
| --- | --- | --- | --- |
| Postgres | `gateway_app` | `control_app` | `bun run postgres:migrate -- --roles postgres://admin:<password>@host:5432/gateway`, with `POSTGRES_GATEWAY_PASSWORD` and `POSTGRES_CONTROL_PASSWORD` (or `ALTER ROLE`). |
| Redis | `gateway` | `gateway-control` | Load [`deploy/redis/gateway.acl`](../../deploy/redis/gateway.acl) as the server's `aclfile`, then set passwords on every start (below). |

```sh
redis-cli ACL SETUSER gateway resetpass >"$REDIS_GATEWAY_PASSWORD"
redis-cli ACL SETUSER gateway-control resetpass >"$REDIS_CONTROL_PASSWORD"
```

> [!WARNING]
> The ACL file holds one rule per line and nothing else: a comment stops Redis from starting. Passwords use
> `>` and key patterns `~` (`%W~` write-only, `%R~` read-only). Keep passwords out of the file and never run
> `ACL SAVE`.

## Control plane

`gateway-control` is the admin surface: same image, separate process, its own socket, acting on the shared
state directly ([spec §12.7](spec.md#127-control-plane)). The gateway has no admin endpoint.

1. Keep its socket internal. It binds loopback by default (`GATEWAY_CONTROL_HOST`); never route it through
   the ingress.
2. Give it a token map in `GATEWAY_CONTROL_TOKENS_FILE`, stored as a secret. Scopes: `read`; `operate` (also
   purges sessions and decisions); `config` (also writes the route table). Never reuse another secret as a
   token: a token equal to the shared-state password stops the process, as does an unreadable map.
3. Give it its own shared-state credentials.

With `GATEWAY_CONFIG_SOURCE=store`, replicas watch the active route-table revision in the shared state. An
empty store falls back to the `GATEWAY_CONFIG` file; an unreachable one keeps the last valid table. Writes
are compare-and-swap on `If-Match`, and `GET /v1/replicas` lists live replicas by heartbeat.

## Route policies

Per-route keys override environment defaults ([spec §3](spec.md#3-configuration-file)):

| Key | Default | Use it to |
| --- | --- | --- |
| `crossSite` | `navigation` | Set `strict` when the upstream changes state on a `GET`. |
| `forwardAuthorization` | `true` | Set `false` when the upstream does not need the caller's token. |
| `accessCacheTtlMs` | environment | Set `0` for immediate revocation. |
| `accessStaleGraceMs` | environment | Serve the last allow decision during an access-service outage. |
| `replayMaxBytes` | environment | Cap bodies resent to the next upstream. |
| `timeouts.upstreamAttemptMs` | environment | Budget one attempt across several upstreams; `0` disables it. |

## Access service

The gateway fails closed: no decision, no request. Point `GATEWAY_ACCESS_URL` at a service that speaks
[spec §6.1](spec.md#61-access-service-protocol). Either run the reference implementation
(`services/access-service.ts`, built from the `access-service` stage of the `Dockerfile`, deployed separately)
with `ACCESS_POLICY_FILE` and `ACCESS_SERVICE_TOKEN`, or check your own with the conformance suite:

```bash
GATEWAY_TEST_ACCESS_URL=https://access.example.com \
GATEWAY_TEST_ACCESS_TOKEN=… \
GATEWAY_TEST_ACCESS_ALLOWED_SUBJECT=alice@example.com \
GATEWAY_TEST_ACCESS_ALLOWED_WORKSPACE=11111111-1111-4111-8111-111111111111 \
bun test test/integration/access-conformance.test.ts
```

The reference policy file maps subjects to `workspaces` (`["*"]` for all), `roles`, and `routes` for routes
with `accessCheck`. Unknown subjects are denied.

```json
{ "version": 1, "subjects": { "alice@example.com": { "workspaces": ["11111111-1111-4111-8111-111111111111"], "roles": ["editor"] }, "carol@example.com": { "workspaces": [], "routes": ["admin-api"] } } }
```

## Secrets

Keep every secret in the secret store, never in the image, route table or repository. Upstreams get only the
public key (`bun run identity:key --public`), so they can verify identities but not mint them.

| Secret | Rotation |
| --- | --- |
| `GATEWAY_SESSION_SECRET` | [Below](#rotating-the-session-secret). |
| `GATEWAY_IDENTITY_SIGNING_KEY` | [Below](#rotating-the-identity-key). |
| `GATEWAY_OIDC_CLIENT_SECRET` | The provider accepts two secrets during rotation; switch, then retire the old one. |
| `GATEWAY_ACCESS_TOKEN` | The access service accepts two tokens during rotation. |
| Shared-state passwords | Change client and server in the same window. |
| `GATEWAY_METRICS_TOKEN` | Change scraper and deployment together. |

### Rotating the session secret

1. Add the new secret to the store.
2. Roll replicas onto it quickly (`maxUnavailable: 0` with a surge, or a maintenance window): replicas with
   different secrets cannot read each other's login state, and callers mid-login must sign in again.
3. Remove the old secret.

### Rotating the identity key

The session secret does not affect the identity signature.

```bash
bun run identity:key                     # new pair
GATEWAY_IDENTITY_SIGNING_KEY=<the pem>   # new private key
bun run identity:key --public            # public key for upstreams
```

Give upstreams the new public key and have them accept both keys, then roll out quickly: during the rollout,
replicas sign with different keys.

## Ingress

The gateway does not terminate TLS or rewrite paths.

| Setting | Value |
| --- | --- |
| Read timeout | ≥ `GATEWAY_SHUTDOWN_TIMEOUT_MS`; no write timeout (event streams outlive it) |
| Request and response buffering | Off |
| HTTP version | `1.1`, passing `Upgrade` and `Connection` for WebSockets |
| Body limit | ≥ the largest route `maxBodyBytes` (the gateway answers `413`) |
| Idle timeout | ≥ `GATEWAY_WS_IDLE_TIMEOUT_SECONDS` |
| Connections | ≥ the deployment's WebSocket count |
| Path | Unchanged; use a route's `rewrite` instead |
| Forwarding headers | `x-forwarded-for`, `x-forwarded-proto`, `x-forwarded-host` |

List the ingress ranges, as narrowly as possible, in `GATEWAY_TRUSTED_PROXIES`, and set
`GATEWAY_TRUSTED_PROXY_HOPS` to the number of proxies in front (`2` for a load balancer plus an ingress), so
a client cannot choose its own address ([spec §7.3](spec.md#73-forwarding-headers-and-client-address)).

> [!IMPORTANT]
> An ingress that rewrites `Host` must send the public host in `x-forwarded-host`, or no route matches.

```nginx
location / {
    proxy_pass http://gateway:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

## Monitoring

Set `GATEWAY_METRICS_TOKEN` and have the scraper send it as a bearer token to `GET /metrics`. Metrics and
labels are listed in [spec §12.1](spec.md#121-health-readiness-and-metrics); logs in
[spec §12.2](spec.md#122-logs). Alert on:

| Signal | Means |
| --- | --- |
| `/readyz` answers `503` | Replica out of rotation. |
| `gateway_access_unavailable_total` | Access service unreachable; callers get `503`. |
| `gateway_access_stale_total` | Outage covered by a grace; revocations are late. |
| `gateway_shared_state_errors_total` | Shared state degraded. |
| `gateway_rate_limit_fallback_total` | Limits counted per replica, not per deployment. |
| `gateway_config_reloads_total{result="failed"}` | Broken route table. |
| `gateway_upstream_failures_total`, `gateway_request_errors_total` | Upstream down. |
| `gateway_rate_limited_total` | A flood. |

To trace a request, search the logs for its `x-request-id`; request and refusal lines name the caller and
workspace.

## Runbooks

| Symptom | Cause | Fix |
| --- | --- | --- |
| Refuses to start | Missing production variable. | Set the one the error names. |
| `/readyz` `503`, `config.lastError` set | Broken route table. | Fix it; the last good table serves meanwhile, and a fixed file loads within a second. |
| `/readyz` `503`, `sessionStore: unavailable` | Shared state down. | Restore it. |
| Every request `404 no_route` | Ingress rewrites `Host`. | Send `x-forwarded-host`, or match the host the ingress sends. |
| Browser requests `403 cross_site_request` | Same, seen through the origin. | Send `x-forwarded-host` and `x-forwarded-proto`. |
| `503 access_unavailable` | Access service down or answering garbage. | Restore it; other routes are unaffected. |
| `gateway_access_stale_total` grows | Grace routes serve old decisions. | Restore the service; set `accessStaleGraceMs: 0` where that is unacceptable. |
| `gateway_shared_state_errors_total` grows | Sessions fail closed (`401`/`503`), decisions are re-asked, limits follow `GATEWAY_RATE_LIMIT_FALLBACK`. | Restore the shared state. |
| `502` on one route | Its upstream is down. | Repair it. With several upstreams, resendable requests move on. |
| Logins fail with `503` | Identity provider down. | Restore it; existing sessions keep working. |
| `gateway_cross_site_refusals_total` grows | A client calls from another site. | Add its origin to `GATEWAY_ALLOWED_ORIGINS`, or fix the client. |
| WebSockets close with `1008` | Session expired, access revoked or route changed. | Nothing, unless unexpected. |

### Revoking sessions

Sessions live under `GATEWAY_SESSION_KEY_PREFIX`; logout also destroys one.

| Goal | How |
| --- | --- |
| One session | `DEL <prefix>:s:<id>` |
| One caller | `GATEWAY_SESSION_URL=redis://127.0.0.1:6379/0 bun run sessions -- --subject alice@example.test` (the provider's `sub`; prints the count removed) |
| Whole deployment | Delete the prefix's keys (`SCAN` + `DEL`, or `FLUSHDB` if it owns the database); repeat per prefix. |

Redis indexes sessions by subject as they are created, so older sessions are missed and expire on their own.
In Postgres, `postgres:migrate` indexes older sessions.

## Rollback

Deploy the previous image ([platform rollback](../platform/operations.md#rollback)) with the same
configuration and secrets.

- Old pods drain: readiness `503`, WebSockets close with `1001`, in-flight requests get
  `GATEWAY_SHUTDOWN_TIMEOUT_MS`. Give pods at least that long.
- Sessions survive unless `GATEWAY_SESSION_SECRET` changes.
- The gateway signs only `v5`, so upstreams keep verifying while `GATEWAY_IDENTITY_SIGNING_KEY` is
  unchanged. A pre-`1.0` gateway signs `v4`, which is removed: update upstreams that verify `v4` first
  ([Upstream identity](upstream-identity.md#versions)).

## Deployment review

Answer once per deployment.

| Area | Check |
| --- | --- |
| Authentication | Which routes take a cookie, a token, both or nothing (`auth.mode`)? Does each `mode: none` upstream authenticate callers itself? |
| Workspaces | Which routes need one, from which placeholder (`auth.workspace`)? |
| Hosts | Which hosts are served, is there a `*` catch-all, and does the ingress keep `Host` or send `x-forwarded-host`? |
| Proxies | Which ranges are trusted, how many hops, and is the ingress the only client? |
| Upstreams | Reachable only from the gateway, over TLS, verifying the signature, in separate trust domains? |
| Metrics | Token set, scraper configured, endpoint not public? |
| Secrets | In the store, the same on every replica, with a rotation plan? |
| Limits | Body limit agrees with the ingress; route budgets exceed ingress timeouts; `GATEWAY_RATE_LIMIT_TOTAL_MAX` set? |
| Capacity | Concurrent requests and WebSockets fit pod memory ([measurements](internals.md#capacity))? |
| Probes | Pod grace period longer than the drain deadline; someone paged on readiness failure? |
| Revocation | `GATEWAY_ACCESS_CACHE_TTL_MS` plus `GATEWAY_WS_REVALIDATE_INTERVAL_MS` acceptable? |
