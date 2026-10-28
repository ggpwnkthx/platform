# Operations

How to deploy, configure, run and review the gateway. The behaviour it implements is in
[spec.md](spec.md); when a deployment misbehaves, see [Recovery](recovery.md).

```
                 ┌──────────────┐
                 │   ingress    │  TLS, connection limits
                 └──────┬───────┘
                        │ http, proxy headers
                 ┌──────▼───────┐
                 │   gateway    │  × N replicas, same image
                 └──────┬───────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    upstreams       identity         access
    (the apps)      provider         service
                                     (workspaces)
                        │
                        ▼
                    ┌─────────┐
                    │  redis  │  sessions, limits, decisions
                    └─────────┘
```

The gateway is stateless: everything that must survive a restart lives in the shared state, so any replica
can be replaced at any time.

## Environment

[.env.example](../../packages/gateway/.env.example) is the canonical list of variables, with each default
and its reason. The environment check compares it with the gateway source and fails the build when they
disagree.

A **production** deployment refuses to start without:

- `GATEWAY_SESSION_SECRET` and `GATEWAY_IDENTITY_SIGNING_KEY`;
- `GATEWAY_OIDC_ISSUER`, `GATEWAY_OIDC_CLIENT_ID`, `GATEWAY_OIDC_REDIRECT_URI` and
  `GATEWAY_OIDC_CLIENT_SECRET`;
- `GATEWAY_ACCESS_URL` and `GATEWAY_ACCESS_TOKEN`;
- at least one of `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_GLOBAL_MAX`,
  `GATEWAY_RATE_LIMIT_PRINCIPAL_MAX` or `GATEWAY_RATE_LIMIT_TOTAL_MAX`;
- `GATEWAY_SESSION_URL` and `GATEWAY_SHARED_STATE_URL` naming a shared server.

The startup error names the missing variable; the reasons are in [spec §4](spec.md#4-environment).

The control plane is a separate process with its own variables: `GATEWAY_CONTROL_HOST`,
`GATEWAY_CONTROL_PORT`, `GATEWAY_CONTROL_TOKENS` or `GATEWAY_CONTROL_TOKENS_FILE`,
`GATEWAY_CONTROL_STATE_URL`, `GATEWAY_CONTROL_KEY_PREFIX`, `GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX` and
`GATEWAY_PROTECTED_ROUTES` ([spec §12.7](spec.md#127-control-plane)). It accepts no request without a token, so it refuses to
start without one.

All other variables are tuning. Their defaults are the values [Capacity](capacity.md) was measured with.

## Control plane

The control plane (`gateway-control`, same image as the gateway) is a deployment's administrative surface.
It is a separate process on its own socket and acts on the shared state directly ([spec §12.7](spec.md#127-control-plane)).

```
                    ┌───────────────────┐
   operator ───────▶│  gateway-control  │  internal network only
                    └─────────┬─────────┘
                              │ shared state, with the
                              │ control plane's credentials
                    ┌─────────▼─────────┐
                    │      redis        │  sessions, decisions,
                    │   (or postgres)   │  route-table revisions
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │     gateway       │  × N replicas, read only
                    └───────────────────┘
```

A control-plane deployment needs:

1. **A socket callers cannot reach.** The listener binds loopback by default (`GATEWAY_CONTROL_HOST`).
   Reach it over the deployment's internal network, never through the ingress.
2. **A token map.** `GATEWAY_CONTROL_TOKENS_FILE` points at a JSON map of `{token: {operator, scope}}`.
   Scopes: `read` (read endpoints), `operate` (`read` plus purging sessions and decisions) and `config`
   (`read` plus route-table writes). Token length rules are in [spec §12.7](spec.md#127-control-plane). The map is a
   **secret**: keep it in the platform secret store and never reuse another secret as a token. An
   unreadable map stops the process, and so does a token equal to the shared-state password.
3. **Its own shared-state credentials.** The control plane writes the route table, its history and the
   write trail; the gateway reads them and writes nothing there.

### Shared-state roles

The control plane's real boundary is the shared-state credential, not the caller's token
([spec §12.8](spec.md#128-shared-state-roles)).

**Postgres.** The migration script creates and grants both roles:

```sh
bun run postgres:migrate -- --roles postgres://admin:<password>@host:5432/gateway
```

| Role | Permissions |
| --- | --- |
| `gateway_app` | Reads the route table (`gateway.config_revisions`, `gateway.config_active`) and writes nothing in it. Writes sessions, limits, cached decisions and heartbeats. |
| `control_app` | Writes the route table, its history and the trail (`gateway.audit`); may revoke sessions and purge cached decisions. |

The gateway runs as `gateway_app` and the control plane as `control_app`. Set their passwords with the
migration script's `POSTGRES_GATEWAY_PASSWORD` and `POSTGRES_CONTROL_PASSWORD`, or with your own
`ALTER ROLE`.

**Redis.** The same split uses ACL users declared in the server's `aclfile`. The project ships them in
[`deploy/redis/gateway.acl`](../../deploy/redis/gateway.acl):

```
user gateway on ~gateway:s:* ~gateway:u:* ~gateway:rl:* ~gateway:global:rl:* ~gateway:principal:rl:* ~gateway:total:rl:* ~gateway:login:rl:* ~gateway:dec:* %W~gateway:cfg:hb:* %R~gateway:cfg:active %R~gateway:cfg:rev:* %R~gateway:cfg:revs -@all +@read +set +del +sadd +srem +pexpire +incr +hincrby +hdel +eval +ping
user gateway-control on ~gateway:* -@all +@read +@write +eval +ping
```

Rules apply in order: everything is denied first, then each user's commands are granted. The file format
([spec §12.8](spec.md#128-shared-state-roles)) has three traps:

- **One rule per line**, nothing else. Any other line, such as a comment, stops the server from starting.
- A **password** is written with `>` and a **key pattern** with `~`. What happens when they are confused
  is in [spec §12.8](spec.md#128-shared-state-roles).
- Key patterns are `~` (read/write), `%W~` (write only) and `%R~` (read only). The route table is read-only
  for the gateway; a replica's heartbeat is the only key it writes there.

**Passwords are not in the file.** Set them after the server starts, on every start:

```sh
redis-cli ACL SETUSER gateway resetpass >"$REDIS_GATEWAY_PASSWORD"
redis-cli ACL SETUSER gateway-control resetpass >"$REDIS_CONTROL_PASSWORD"
```

`resetpass` drops any earlier password, so only the deployment's secret authenticates. Do **not** run
`ACL SAVE`: the deployment's file holds no secret, and secrets stay in the secret store.

The `gateway` user may **read** the route table (`gateway:cfg:active`, `gateway:cfg:rev:*`,
`gateway:cfg:revs`) and writes sessions, limits and heartbeats. Revisions and the pointer are hashes and
the history is a list, and this user can neither write a hash nor push to a list, so it cannot change the
route table. The `gateway-control` user writes everything. The write trail (`<prefix>:audit`) belongs to
the control plane; the gateway never writes it.

### Route table in the shared state

With `GATEWAY_CONFIG_SOURCE=store`, the route table is a list of **immutable revisions** in the shared
state, plus a pointer to the active one. Every replica watches the pointer and converges on the same table.

- An **empty** store falls back to the `GATEWAY_CONFIG` file, and the deployment starts with it.
- An **unreachable** store keeps the last valid table. The failure shows in `config.lastError` of
  `/readyz` and in `gateway_config_reloads_total{result="failed"}`.
- Each replica writes a **heartbeat** with a TTL, so `GET /v1/replicas` lists only live replicas.

A table write is a compare-and-swap: send the revision you replace in `If-Match`; the pointer moves only
if it still names that revision.

## Shared state

The shared-state URL scheme selects the backend, and the URL names the server shape
([spec §4](spec.md#4-environment)). A cluster has one database, so the URL path is ignored there. The server certificate
is verified against the deployment's CA (`GATEWAY_SESSION_TLS_CA` and `GATEWAY_SHARED_STATE_TLS_CA`).

```bash
GATEWAY_SESSION_URL=rediss://:<password>@redis:6379/0                  # Redis
GATEWAY_SESSION_URL=postgres://user:<password>@postgres:5432/gateway   # Postgres
```

The two backends are interchangeable. [Capacity](capacity.md#shared-state-backends) compares them and
shows the benchmark command; [spec §12.6](spec.md#126-backend-comparison) covers how to choose.

### Postgres

The backend uses these objects in the `gateway` schema:

| Object | Holds |
| --- | --- |
| `gateway.sessions` | Caller sessions: the record is `jsonb`, expiry is a column. |
| `gateway.access_decisions` | Cached access-service decisions. |
| `gateway.rate_limit_buckets` | Limiter window buckets. |
| `gateway.session_touch(...)` | Reads a session and refreshes its expiry in one transaction (Redis: `TOUCH_SCRIPT`). |
| `gateway.rate_limit_check(...)` | Counts a request in a caller's window in one transaction (Redis: `WINDOW_SCRIPT`). |

- **Schema.** The gateway builds it when `GATEWAY_POSTGRES_AUTO_MIGRATE=true`, the default outside
  production. Statements are idempotent, and an advisory lock lets one replica build while others wait. A
  production deployment that applies its own migrations sets it to `false` and runs:

  ```bash
  bun run postgres:migrate -- postgres://user:<password>@host:5432/gateway
  ```

- **Pool.** `GATEWAY_POSTGRES_POOL_MAX`, ten per replica by default. The server needs replicas × pool size
  connections; Postgres connection limits are low, so put a pooler in front when you run many replicas.
- **Durability.** `GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT=off` (default): the server does not wait for the
  disk, and a crash costs a caller at most a few requests of budget ([spec §12.5](spec.md#125-shared-state)).
- **Expiry.** Expiry is a column, not a vanishing key: the adapters sweep expired rows, and an expired row
  is never served whatever the sweep did.

## Route policies

Some policies belong to a route, not the deployment. Set them in the route table; they override the
defaults.

| Key | Default | Effect |
| --- | --- | --- |
| `crossSite` | `navigation` | `strict` refuses cross-site navigations on the route. Use it when the upstream changes state on a `GET`. |
| `forwardAuthorization` | `true` | `false` stops forwarding the caller's `Authorization` header. The upstream still gets the identity in the gateway headers and the signature. |
| `accessCacheTtlMs` | from the environment | Lifetime of cached access decisions on the route. `0` asks the service on every request, so revocation is immediate. |
| `replayMaxBytes` | from the environment | Largest body that may be resent to a second upstream. A fitting body is held in memory so the request can move to the next upstream on failure. |
| `timeouts.upstreamAttemptMs` | from the environment | Budget of one attempt when the route names several upstreams. `0` disables it. |

```jsonc
{
  "id": "workspace-api",
  "match": { "host": "api.example.com", "path": "/ws/{workspaceId}/" },
  "upstream": "http://upstream-b:3000",
  "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } },
  // The upstream changes state on a `GET`: only reachable from the site itself.
  "crossSite": "strict",
  // The upstream does not need the caller's token.
  "forwardAuthorization": false
}
```

A route can also declare `rewrite` (the path its upstream receives), several upstreams (tried in list
order), `accessCheck` and `accessStaleGraceMs` (see [Access service](#access-service)). The full file
format is in [spec §3](spec.md#3-configuration-file).

## Access service

The access service is a deployment dependency, not part of the gateway. The gateway fails closed: no
decision, no request.

Configure **service addresses**, never a repository URL: `GATEWAY_ACCESS_URL` names the service that speaks
the protocol, and `GATEWAY_OIDC_ISSUER` names the token issuer. An upstream such as the data service is
named in its route's `upstream`.

The protocol is in [spec §6.1](spec.md#61-access-service-protocol). If you write your own service, run the conformance suite
against it:

```bash
GATEWAY_TEST_ACCESS_URL=https://access.example.com \
GATEWAY_TEST_ACCESS_TOKEN=… \
GATEWAY_TEST_ACCESS_ALLOWED_SUBJECT=alice@example.com \
GATEWAY_TEST_ACCESS_ALLOWED_WORKSPACE=11111111-1111-4111-8111-111111111111 \
bun test test/integration/access-conformance.test.ts
```

Otherwise run the **reference implementation**, `services/access-service.ts`, which applies a policy file:

```bash
ACCESS_POLICY_FILE=/etc/platform/access-policy.json \
ACCESS_SERVICE_TOKEN=… \
bun run services/access-service.ts
```

Build its image from the `access-service` stage of the `Dockerfile`. It is **not** in the gateway image;
deploy the two separately.

```json
{
  "version": 1,
  "subjects": {
    "alice@example.com": {
      "workspaces": ["11111111-1111-4111-8111-111111111111"],
      "roles": ["editor"]
    },
    "bob@example.com": { "workspaces": ["*"] },
    "carol@example.com": { "workspaces": [], "routes": ["admin-api"] }
  }
}
```

An unknown subject is denied: when the file says nothing, the answer is no. A subject's `routes` apply to
requests that name **no workspace**: a route with `accessCheck` asks about itself, and the service decides
from the subject's routes.

**Outage grace.** A route may keep using the service's last decision while the service is down:

```jsonc
{
  "id": "workspace-api",
  "accessStaleGraceMs": 30000
}
```

The default is `0`: an unreachable service is an outage, answered with `503 access_unavailable` so
operators see it. A grace keeps the route's traffic flowing but delays revocations by that much. Stale
decisions are counted in `gateway_access_stale_total{route}`, and their age in
`gateway_access_stale_age_seconds{route}`.

## Secrets

| Secret | Source | Protects | Rotation |
| --- | --- | --- | --- |
| `GATEWAY_SESSION_SECRET` | Secret store | Login state | In-flight logins fail; callers sign in again. |
| `GATEWAY_IDENTITY_SIGNING_KEY` | Secret store | The identity signature upstreams verify | Give upstreams the new **public key** at the same time; old-key signatures are refused meanwhile. |
| `GATEWAY_OIDC_CLIENT_SECRET` | Secret store | The code exchange | The provider accepts two secrets during client rotation; change the value afterwards. |
| `GATEWAY_ACCESS_TOKEN` | Secret store | Access-service calls | The service accepts two tokens during rotation. |
| Redis password | Secret store | Sessions and limits | Change client and server passwords in the same window. |
| `GATEWAY_METRICS_TOKEN` | Secret store | Metrics | Change it in the scraper and the deployment together. |
| Identity public key | `bun run identity:key --public` | Upstream verification of the identity | Upstreams get the public key, never the private one. |

Rules:

- Never put a secret in the image, the configuration file or the repository.
- Upstreams verify the identity with the **public key**, never the private key or the session secret, so
  a verifying upstream cannot mint an identity.
- Use the same session secret on every replica. A replica with a different secret cannot read callers'
  sessions or verify login state.

Rotation procedures are in [Recovery](recovery.md#rotating-the-session-secret).

## Ingress

The gateway does not terminate TLS or rewrite request paths. The ingress in front of it must preserve body
streaming and WebSockets.

| Setting | Value | Why |
| --- | --- | --- |
| Timeouts | Read timeout ≥ `GATEWAY_SHUTDOWN_TIMEOUT_MS`; **no** write timeout. | An event stream outlives any write timeout. |
| Request buffering | Off | Bodies stream upstream; buffering breaks body budgets and limits. |
| Response buffering | Off | Same, for responses. |
| `proxy_http_version` | `1.1` | Needed for WebSockets. |
| `proxy_set_header Upgrade` / `Connection` | On | Needed for WebSockets. |
| Body limit | The route's `maxBodyBytes`, or the largest one. | The gateway answers oversized bodies with `413`; the ingress may refuse earlier with its own answer. |
| Idle connection timeout | ≥ `GATEWAY_WS_IDLE_TIMEOUT_SECONDS` | Editor WebSockets are mostly idle. |
| Connection count | ≥ the deployment's WebSocket count | The ingress is the connection limit. |
| Health check | `GET /healthz` | Always available. |
| Readiness check | `GET /readyz` | `503` when the gateway cannot serve traffic. |

### Proxy headers

The ingress must set `x-forwarded-for`, `x-forwarded-proto` and `x-forwarded-host`, and its ranges must be
in `GATEWAY_TRUSTED_PROXIES` (or the file's `trustedProxies`). Headers from a client that is not a trusted
proxy are ignored. Keep the ranges as narrow as possible: a range that covers callers lets each of them
write the forwarding chain.

`GATEWAY_TRUSTED_PROXY_HOPS` (default one) is the number of proxies. Each proxy appends the address it saw
to `x-forwarded-for`, and the gateway reads the chain from the right: the caller is the entry that many
positions from the right. With an ingress and a load balancer in front, set it to `2`. This makes the
caller address **unforgeable**: client-written entries sit left of the proxies' entries and are dropped,
so a client's own `x-forwarded-for` cannot change its rate-limiter key.

> [!IMPORTANT]
> The effective host picks the route, is compared with the browser's origin, and is covered by the identity
> signature. An ingress that rewrites `Host` to its own name must send the public host in
> `x-forwarded-host`, or requests match no route.

A typical nginx configuration:

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

The ingress must not rewrite the path or add a prefix. The path is forwarded unchanged unless the route
declares a `rewrite` (for example `/{rest}` strips the route prefix), which applies to the path the caller
sent. Upstreams are mounted under their route's path, and the identity signature covers the path the
upstream receives.

## Metrics

`GET /metrics` serves the Prometheus text format. It answers `404` when `GATEWAY_METRICS_TOKEN` is unset
and `401` when the bearer token does not match. Metric definitions and labels are in
[spec §12.1](spec.md#121-health-readiness-and-metrics).

| Metric | Watch it for |
| --- | --- |
| `gateway_requests_total` | Route traffic. |
| `gateway_request_errors_total` | Gateway or upstream errors. |
| `gateway_auth_failures_total` | Platform policy at work, not gateway errors. |
| `gateway_access_unavailable_total` | Access-service outage; callers are refused until it recovers. |
| `gateway_access_stale_total` | Access-service outage covered by a route's grace; revocations are late. |
| `gateway_cross_site_refusals_total` | An attack or a broken client. |
| `gateway_websocket_connections_total` | Capacity. |
| `gateway_websocket_refusals_total` | Capacity and origins. |
| `gateway_request_duration_seconds` | Route budgets. |
| `gateway_upstream_duration_seconds` | Slow upstreams. |
| `gateway_upstream_failures_total` | Upstreams that are down. |
| `gateway_upstreams_skipped_total` | The upstream breaker at work. |
| `gateway_active_requests` | Draining. |
| `gateway_config_reloads_total` | A broken file on disk. |
| `gateway_rate_limited_total` | A flood. |
| `gateway_rate_limit_fallback_total` | Limits running per replica instead of per deployment. |
| `gateway_shared_state_errors_total` | Deployment degradation. |

Labels are bounded: a workspace, subject, URL or request id is never a label, so a busy gateway's metrics
do not grow its memory. What to do when a metric grows is in [Recovery](recovery.md#symptoms).

The scraper sends the token as a bearer token:

```yaml
scrape_configs:
  - job_name: gateway
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <the token of the secret store>
```

## Logs

Logs are JSON, one object per line. Content, redaction and the startup policy log are in
[spec §12.2](spec.md#122-logs). Use them for:

- **Request id**, also returned as `x-request-id`: a caller that sends a valid id can trace its request.
- **Proxied request line**: route, method, path, status, duration, bytes and outcome (`complete` or
  `aborted`).
- **Caller and workspace**, also on refusal lines, so you can answer "who used this workspace" and "who was
  denied".

## Deployment review

Complete this checklist once per deployment. Each item names where the setting lives, so a reviewer need
not read the code. The rules under each table are enforced by the gateway; the questions are for the
reviewer.

### 1. Route authentication

| Question | Where | Answer |
| --- | --- | --- |
| Which routes accept a session cookie, a bearer token, or both? | `auth.mode` in the route table | |
| Which routes need a workspace, and which placeholder carries it? | `auth.workspace` in the route table | |
| Does any route accept no credential (`mode: none`)? | `auth.mode` in the route table | |
| Does the upstream of each `mode: none` route authenticate the caller? | Route table and the application | |

Rule: a `mode: none` route passes the caller's `Authorization` header through unchanged, so its upstream is
the one that authenticates.

### 2. Accepted hosts

| Question | Where | Answer |
| --- | --- | --- |
| Which hosts does the gateway answer for? | `match.host` in the route table | |
| Is there a catch-all host (`*`)? What does it serve? | Route table | |
| Do route hosts match the hosts callers use? | Route table and ingress | |
| Does the ingress keep `Host` or send the public host in `x-forwarded-host`? | Ingress | |

Rules: see the host note under [Proxy headers](#proxy-headers). The gateway's own paths (`/healthz`,
`/readyz`, `/metrics`, `/auth/login`, `/auth/callback`, `/auth/logout`) are always reserved, and a route
claiming one is refused at load.

### 3. Trusted proxies

| Question | Where | Answer |
| --- | --- | --- |
| Which ranges may send forwarding headers? | File `trustedProxies` and `GATEWAY_TRUSTED_PROXIES` | |
| How many proxies sit in front of the gateway? | `GATEWAY_TRUSTED_PROXY_HOPS` | |
| Is the ingress the only client of the gateway? | Network policy | |
| Is the caller address the one the rate limiter counts? | `x-forwarded-for` and trusted proxies | |

Rule: without a trusted proxy, the peer address is the caller address and forwarding headers are ignored.
An over-wide range lets any caller inside it write the whole chain.

### 4. Upstream access

| Question | Where | Answer |
| --- | --- | --- |
| Which upstream is behind each route? | Route table | |
| Can the upstreams be reached from the internet? | Network policy and services | |
| Does the gateway reach upstreams over TLS? | Upstream URL | |
| Are different routes' upstreams in different trust domains? | Service namespaces | |
| Do the upstreams verify the identity signature? | The applications | |

Rules: upstreams must be reachable only from the gateway, because identity headers are trustworthy only
then. An upstream that skips signature verification trusts the headers on the network's word.

### 5. Metrics protection

| Question | Where | Answer |
| --- | --- | --- |
| Is `GATEWAY_METRICS_TOKEN` set? | Platform secret | |
| Who reads metrics, with which token? | Scraper configuration | |
| Is the metrics endpoint reachable from outside the cluster? | Service and network policy | |

Rule: see [Metrics](#metrics). Labels carry routes, methods, statuses and a closed set of reasons only.

### 6. Secrets

| Secret | In the secret store | Same on every replica | Rotated |
| --- | --- | --- | --- |
| `GATEWAY_SESSION_SECRET` | | | |
| `GATEWAY_IDENTITY_SIGNING_KEY` | | | |
| `GATEWAY_OIDC_CLIENT_SECRET` | | | |
| `GATEWAY_ACCESS_TOKEN` | | | |
| Shared-state password | | | |
| `GATEWAY_METRICS_TOKEN` | | | |

Rules: see [Secrets](#secrets).

### 7. Limits and budgets

| Question | Where | Answer |
| --- | --- | --- |
| What is the request body limit, and does the ingress agree? | Route `maxBodyBytes`, `GATEWAY_MAX_BODY_BYTES`, ingress | |
| Which phase has which budget? | `timeouts` of routes and defaults | |
| Are route budgets longer than the ingress timeouts? | Ingress | |
| Which rate limits are on? | `GATEWAY_RATE_LIMIT_MAX`, `_GLOBAL_MAX`, `_PRINCIPAL_MAX`, `_TOTAL_MAX` | |
| Is the deployment-wide budget on? | `GATEWAY_RATE_LIMIT_TOTAL_MAX` | |
| How many concurrent requests may a replica handle? | `GATEWAY_MAX_CONCURRENT_REQUESTS` and pod memory | |
| How many WebSockets may a replica hold? | `GATEWAY_WS_MAX_CONNECTIONS` and pod memory | |
| How often are open WebSockets revalidated? | `GATEWAY_WS_REVALIDATE_INTERVAL_MS` | |

Rules:

- The ingress must not buffer bodies or use a write timeout shorter than an event stream.
- Production needs at least one rate limit. Only the deployment scope bounds a flood spread over many
  addresses.
- The exchange cap bounds clients that open a request and never send its body.

### 8. Capacity

| Question | Where | Answer |
| --- | --- | --- |
| What is a replica's measured capacity? | [Capacity](capacity.md) | |
| How many replicas run? | Autoscaling | |
| What is the shared state's capacity? | The state server | |
| How much memory does a replica use under the deployment's load? | Pod limit | |

Rule: [Capacity](capacity.md) measures the gateway alone. A deployment is also bounded by its ingress and
upstreams; measure it there.

### 9. Operations

| Question | Where | Answer |
| --- | --- | --- |
| Which probe is liveness and which is readiness? | Deployment | |
| Is the pod grace period longer than the drain deadline? | Deployment | |
| Who is paged when readiness fails? | Alerts | |
| How is a broken configuration file rolled back? | Configuration in version control | |
| How are sessions invalidated? | [Recovery](recovery.md#revoking-sessions) | |
| What is the revocation latency? | `GATEWAY_ACCESS_CACHE_TTL_MS` and `GATEWAY_WS_REVALIDATE_INTERVAL_MS` | |

Rule: revocation latency is the decision-cache TTL plus the WebSocket revalidation interval. Turn those
knobs when revocation must be immediate.

## Project checks

| Check | Command | In CI |
| --- | --- | --- |
| Types | `bun run typecheck` | yes |
| Lint | `bun run lint` | yes |
| Format | `bun run format:check` | yes |
| Import boundaries | `bun test test/architecture` | yes |
| Unit and contract tests | `bun test src test/contract` | yes |
| Parser property tests | `bun test test/fuzz` | yes |
| Network tests | `bun test test/network` | yes |
| Shared state against real Redis | `bun test test/integration` | yes |
| Shared state against real Postgres | `bun test test/integration` | yes |
| Browser | `bun test test/browser` | yes |
| Interop with a real provider | `bun test test/interop` | yes |
| Soak | `bun test test/load` | yes |
| Load | `bun run load` | yes |
| Backend comparison | `bun run benchmark` | no |
| Image | `docker build` and the smoke tests | yes |

Last full run: **793 passed, 0 failed** across 79 files on Bun 1.4.3, including real Redis 7.0.15
(`GATEWAY_TEST_REDIS_URL=redis://127.0.0.1:6399/0`), real Postgres 18.6
(`GATEWAY_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/gateway`), 3 Chromium tests and 2 soak tests.
Only the four real-provider interop tests were skipped; CI runs them against its own dex. Coverage of `src/`
is **93.8 %** lines and **93.0 %** functions (mean over `src/` files); the whole tree, tests included, is
**91.7 %** lines and **91.8 %** functions.

Without a Redis server, the 38 shared-state tests are skipped and the rest pass. Without a named Postgres
server, the Postgres shared-state tests run against Postgres's in-process engine.

## Release workflow

CI (`.github/workflows/ci.yml`) runs seven jobs:

| Job | Proves |
| --- | --- |
| `check` | Types, lint, format, import boundaries, unit and contract tests, network tests and the soak. |
| `redis` | Shared state against real Redis 7. |
| `postgres` | Shared state against real Postgres 18, and the schema migration. |
| `interop` | Provider discovery and a real sign-in against dex. |
| `load` | Capacity: 20 000 requests at 100 in flight, and 500 WebSockets. |
| `browser` | Cookies and origins in real Chromium. |
| `image` | The image builds and starts with a deployment configuration; refuses to start without a session secret, access service, identity provider or rate limit; and contains no fixtures. |

The release workflow (`.github/workflows/release.yml`) publishes a tag's two artifacts, the **image** and
the **binaries**. It refuses a tag that does not match the package version, and computes version, tag and
revision once for both.

The image job builds the tag's image, starts it with a deployment configuration and exports it as a run
artifact. The image carries version and revision labels and only the gateway's dependencies. It is built
twice: once into the local store so deployment checks can run it, and once for the registry. Only the
second build adds attestations (provenance and SBOM), because the local docker exporter cannot carry an
attestation manifest list.

The binaries job compiles seven targets, and the release job attaches them to the tag's release:

| Platform | Target |
| --- | --- |
| Linux x64 (glibc) | `bun-linux-x64` |
| Linux x64 (musl, Alpine) | `bun-linux-x64-musl` |
| Linux arm64 | `bun-linux-arm64` |
| macOS x64 | `bun-darwin-x64` |
| macOS arm64 | `bun-darwin-arm64` |
| Windows x64 | `bun-windows-x64` |
| Windows arm64 | `bun-windows-arm64` |

Binaries embed the runtime, so nothing else needs installing. The workflow checks each binary's format,
starts the runner's binary and waits for its health probe before publishing, and publishes checksums
alongside. A `linux-x64` binary needs glibc and `linux-x64-musl` needs musl; use the latter on Alpine.

```bash
gateway-1.0.0-linux-x64-musl   # Linux, Alpine
gateway-1.0.0-linux-x64        # Linux, glibc
gateway-1.0.0-darwin-arm64     # macOS
gateway-1.0.0-windows-x64.exe  # Windows
```

## Release tags

The version lives in the package and the files that name it; the **tag** turns a commit into a release.
`.github/workflows/release-tag.yml` creates it:

| When | Result |
| --- | --- |
| CI on a `main` push succeeded | Compares the package version with the latest tag. If the package version is greater, it is tagged and the release starts. |
| Version equals the latest tag | Nothing: that release is already published. |
| Version is older than the latest tag | The version was rolled back; nothing is tagged. |

- The tag goes on the commit CI proved and is never moved: a published release is never republished under
  another name.
- The workflow waits for CI, so no release comes from a commit that failed tests.
- The release is **dispatched**, not triggered: GitHub does not start workflows for a tag pushed with the
  repository token, so the release workflow is dispatched on that tag and runs in its context. A tag
  pushed by hand still starts it directly.

Run the same decision locally:

```bash
bun run release:tag             # dry run
bun run release:tag -- --tag    # create the tag
```

The script refuses to tag a commit whose files disagree on the version, because the manifests would
deploy something other than what was released.

## Deployment gaps

The [spec](spec.md) contract is complete. These are outside the gateway's scope; the deployment closes them:

| Gap | Closed by |
| --- | --- |
| Client TLS | An ingress in front of the gateway. |
| Upstream is static per route | A router in front of the pods, when the workspace picks the pod. |
| Revocation waits for the cache TTL | `GATEWAY_ACCESS_CACHE_TTL_MS`, and `accessCacheTtlMs` on routes that need immediate revocation. |
| Latency of an uncached decision | A fast control plane; the cache absorbs the rest. |
| One hostname per product surface | Subdomains, or one host with distinct path prefixes. |
| WebSocket upstream over TLS | Not possible: the runtime's WebSocket client cannot speak TLS, so WebSocket upstreams use plain http ([Runtime](runtime.md)). |

## Not yet proven

The contract is complete; the evidence below is thin. Know where the ground is soft.

| Area | Status |
| --- | --- |
| Project history | The repository is young: the design is a few days' work and has never carried production traffic. Every [Capacity](capacity.md) number comes from one machine with the upstream in the same process. |
| Shared access-service calls | In-flight calls are shared **per replica**: a burst across N replicas asks the service N times. The shared decision cache bounds the burst by its lifetime; a single call would need a lock in the shared state. |
| Access-service breaker | State is **per process**, like the upstream breaker. A replica that saw no failures keeps calling the service and learns from its own failures. |
| Upstream breaker | Per process for the same reason: a replica that saw no failure sends requests to a down upstream and pays the route's budget. |
| Capacity behind an ingress | No ingress in the build environment. The relevant settings are under [Ingress](#ingress). |
| Capacity with remote shared state | Measured with servers on the same machine; over a network, every round trip pays network latency. |
| Interop with other providers | Contract tests use the project's provider and interop tests use dex. Other shapes (a differently named claim, an id token without a nonce) are untested. |
