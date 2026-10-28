# The operations of the gateway

How to deploy, configure, run and review the gateway. The behavior it
implements is in [spec.md](spec.md). When the deployment is not
behaving, the recovery is in [recovery.md](recovery.md).

```
                 ┌──────────────┐
                 │   ingress    │  TLS, the limits of the connections
                 └──────┬───────┘
                        │ http, the headers of the proxy
                 ┌──────▼───────┐
                 │   gateway    │  × N replicas, the same image
                 └──────┬───────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   the upstreams   the identity      the access
   (the apps)      provider          service
                    (the workspaces)
                        │
                        ▼
                    ┌─────────┐
                    │  redis  │  the sessions, the limits, the decisions
                    └─────────┘
```

The gateway is stateless: everything that has to survive a restart lives in
the shared state. A replica can be replaced at any moment.

## The settings of a deployment

The full list of the variables of the gateway, with the default of every
value and the reason of each, is in
[.env.example](../../packages/gateway/.env.example). That file is the
canonical one: the check of the environment reads it and the source of the
gateway, and it fails the build when the two disagree.

The variables a **production** deployment has to set are the ones the
gateway refuses to start without. They are `GATEWAY_SESSION_SECRET`,
`GATEWAY_IDENTITY_SIGNING_KEY`, `GATEWAY_OIDC_ISSUER`,
`GATEWAY_OIDC_CLIENT_ID`, `GATEWAY_OIDC_REDIRECT_URI`,
`GATEWAY_OIDC_CLIENT_SECRET`, `GATEWAY_ACCESS_URL` and
`GATEWAY_ACCESS_TOKEN`, plus one rate limit of
`GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_GLOBAL_MAX`,
`GATEWAY_RATE_LIMIT_PRINCIPAL_MAX` or `GATEWAY_RATE_LIMIT_TOTAL_MAX`, and
a `GATEWAY_SESSION_URL` and `GATEWAY_SHARED_STATE_URL` that name a server
whose state is shared. The reason of each is in [spec.md](spec.md) §4, and
the message the gateway throws names the one that is missing.

The control plane is a separate process and it has its own variables:
`GATEWAY_CONTROL_HOST`, `GATEWAY_CONTROL_PORT`, `GATEWAY_CONTROL_TOKENS`
or `GATEWAY_CONTROL_TOKENS_FILE`, `GATEWAY_CONTROL_STATE_URL`,
`GATEWAY_CONTROL_KEY_PREFIX`, `GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX`
and `GATEWAY_PROTECTED_ROUTES`. They are in [spec.md](spec.md) §12.7, and
the control plane accepts no request without a token, so it refuses to
start without one.

The rest of the variables are tuning: they have a default, and the default
is the one the measurements of [capacity.md](capacity.md) were made with.

## The control plane

The control plane is the administrative surface of a deployment. It is a
**separate process** (`gateway-control`, the same image as the gateway),
it listens on its own socket and it acts on the shared state directly. The
rule is in [spec.md](spec.md) §12.7.

```
                    ┌───────────────────┐
   the operator ───▶│  gateway-control  │  the internal network only
                    └─────────┬─────────┘
                              │ the shared state, with the credentials
                              │ of the control plane
                    ┌─────────▼─────────┐
                    │      redis        │  the sessions, the decisions,
                    │   (or postgres)   │  the revisions of the route table
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │     gateway       │  × N replicas, read only
                    └───────────────────┘
```

The deployment of the control plane needs three things:

1. **A socket that the callers cannot reach.** The listener binds the
   loopback address by default (`GATEWAY_CONTROL_HOST`). The service is
   internal: it is reached over the network of the deployment, and never
   through the ingress.
2. **A map of tokens.** `GATEWAY_CONTROL_TOKENS_FILE` points at a file
   that holds a JSON map of `{token: {operator, scope}}`. The scopes are
   `read` (the endpoints that read), `operate` (`read` and the purges of
   the sessions and of the decisions) and `config` (`read` and the writes
   of the route table). A token is at least 16 characters long. A map that
   cannot be read stops the process: a control plane that starts with a map
   it does not understand is a control plane that nobody controls. The map
   is a **secret**: it is in the secret store of the platform, and it is
   never the secret of something else. A token that is the password of the
   shared state stops the process as well: a credential that is used twice
   is used twice.
3. **Its own credentials on the shared state.** The control plane writes
   the route table, the history of the table and the trail of the writes;
   the gateway reads them and writes nothing in them.

### The roles of the shared state

The boundary of the control plane is the credential of the shared state and
not the token of the caller. The rule is in [spec.md](spec.md) §12.7.

**Postgres.** The migration script creates the two roles and grants them:

```sh
bun run postgres:migrate -- --roles postgres://admin:<password>@host:5432/gateway
```

| The role | What it may do |
| --- | --- |
| `gateway_app` | It reads the route table (`gateway.config_revisions`, `gateway.config_active`) and it writes nothing in it. It still writes the sessions, the limits, the cached decisions and the heartbeats. |
| `control_app` | It writes the route table, the history and the trail (`gateway.audit`), and it may revoke the sessions and purge the cached decisions. |

The gateway runs with `gateway_app` and the control plane runs with
`control_app`. The passwords of the two roles are set by the
deployment (`POSTGRES_GATEWAY_PASSWORD` and `POSTGRES_CONTROL_PASSWORD` of
the migration script, or an `ALTER ROLE` of the deployment).

**Redis.** The same split is made with the ACL users of the server. The
users are declared in the configuration of the server (`aclfile`); the
project ships them in
[`deploy/redis/gateway.acl`](../../deploy/redis/gateway.acl):

```
user gateway on ~gateway:s:* ~gateway:u:* ~gateway:rl:* ~gateway:global:rl:* ~gateway:principal:rl:* ~gateway:total:rl:* ~gateway:login:rl:* ~gateway:dec:* %W~gateway:cfg:hb:* %R~gateway:cfg:active %R~gateway:cfg:rev:* %R~gateway:cfg:revs -@all +@read +set +del +sadd +srem +pexpire +incr +hincrby +hdel +eval +ping
user gateway-control on ~gateway:* -@all +@read +@write +eval +ping
```

The rules are applied in the order they are written: everything is refused
first, and the commands of each user are granted afterwards.

Three rules of the format of the file are worth naming, because a file
that breaks them does not do what it says. The format itself is in
[spec.md](spec.md) §12.8:

- The file holds **one rule per line** and nothing else. The server reads
  it as a list of rules: a line that is not a rule — a comment, for
  example — stops the server from starting.
- The command that writes a **password** is `>`, and the command that
  reads a **key pattern** is `~`. A rule that writes `>~gateway:s:*` does
  not write a key pattern at all: it publishes a password that is the
  pattern itself, and the user it defines may not touch a single key.
- The patterns of the keys are `~` (read and write), `%W~` (write only)
  and `%R~` (read only). The route table is read only for the gateway, and
  the heartbeat of a replica is the only key it writes there.

The **passwords are not in the file**. The deployment writes them after
the server started, and it writes them again at every start:

```sh
redis-cli ACL SETUSER gateway resetpass >"$REDIS_GATEWAY_PASSWORD"
redis-cli ACL SETUSER gateway-control resetpass >"$REDIS_CONTROL_PASSWORD"
```

`resetpass` removes the passwords the user had, so the secret of the
deployment is the only one that authenticates. The server is **not** saved
with `ACL SAVE`: the file of the deployment holds no secret, and the
secrets live in the secret store.

The user of the gateway may **read** the route table (`gateway:cfg:active`,
`gateway:cfg:rev:*`, `gateway:cfg:revs`) and it writes the sessions, the
limits and the heartbeats. It does not hold the commands that write the
route table: the revisions and the pointer are hashes and the history is a
list, and the user of the gateway may neither write a hash nor push a
value. The user of the control plane writes everything.

The keys of the trail of the writes (`<prefix>:audit`) belong to the
control plane: the gateway never writes it.

### The route table in the shared state

With `GATEWAY_CONFIG_SOURCE=store` the route table is not a file any more:
it is a list of **immutable revisions** in the shared state, and a pointer
names the revision that is active. Every replica watches the pointer and
converges on the same table.

- An **empty** store falls back to the file of `GATEWAY_CONFIG`: the
  deployment starts with it.
- An **unreachable** store keeps the last valid table. The failure is
  reported in `config.lastError` of `/readyz` and in
  `gateway_config_reloads_total{result="failed"}`.
- Every replica writes a **heartbeat** with a time to live, so
  `GET /v1/replicas` shows the replicas that are really there.

A write of the table is a compare and swap: the caller sends the revision
it replaces in the `If-Match` header, and the pointer moves only when it
still names that revision.

## The shape of the shared state

The url of the shared state names the shape of the server **and its
backend**: the scheme picks the one of the two. The shapes are in
[spec.md](spec.md) §4. A cluster holds one database, so the path of the
url is dropped in that shape. The certificate of the server is verified with
the authority of the deployment (`GATEWAY_SESSION_TLS_CA` and
`GATEWAY_SHARED_STATE_TLS_CA`).

### The Postgres server

The Postgres backend holds three tables and two functions in the schema
`gateway`:

| The object | What it holds |
| --- | --- |
| `gateway.sessions` | The sessions of the callers. The record is a `jsonb`, the expiry is a column. |
| `gateway.access_decisions` | The cached decisions of the access service. |
| `gateway.rate_limit_buckets` | The buckets of the windows of the limiters. |
| `gateway.session_touch(...)` | Reads a session and refreshes its expiry. One transaction, the equivalent of the `TOUCH_SCRIPT` of Redis. |
| `gateway.rate_limit_check(...)` | Counts a request in the window of a caller. One transaction, the equivalent of the `WINDOW_SCRIPT` of Redis. |

The schema is built by the gateway when `GATEWAY_POSTGRES_AUTO_MIGRATE=true`,
which is the default outside a production deployment. The statements are
idempotent and an advisory lock makes one replica build the schema while
the others wait for it.

A production deployment that applies its own migrations says no and runs
the script instead:

```bash
bun run postgres:migrate -- postgres://user:<password>@host:5432/gateway
```

**The connections are a pool** (`GATEWAY_POSTGRES_POOL_MAX`, ten per
replica by default). A Postgres server has a low limit of connections, so
a deployment with many replicas needs a pooler in front of it. The limit of
the server is the number of the replicas times the size of the pool.

**The server does not wait for the disk** (`GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT=off`,
the default): a counter that is lost when the server crashes costs a
caller a few requests of its budget. The rule is in [spec.md](spec.md)
§12.5.

**The rows that are over are removed by a sweep.** The expiry of a row is
a column and not the disappearance of a key, so the adapters remove the
rows that are over, and the server never serves a row that is over,
whatever the sweep did.

### The comparison of the two backends

The two backends are interchangeable and the gateway measures them side by
side:

```bash
bun run benchmark -- --redis redis://127.0.0.1:6379/0 \
                     --postgres postgres://127.0.0.1:5432/gateway
```

The script runs the same traffic against the same gateway with the two
backends and prints the table of the comparison. The measurements of the
last run are in [capacity.md](capacity.md), and the choice of a deployment
is in [spec.md](spec.md) §12.6.

## The policies of the routes

Several policies are properties of a route rather than of the deployment.
They are in the route table, and they replace the value of the defaults.

| Key | Default | What it decides |
| --- | --- | --- |
| `crossSite` | `navigation` | `strict` refuses the navigations from another site on that route. Use it for a route whose upstream changes the state of something on a `GET`. |
| `forwardAuthorization` | `true` | `false` does not forward the `Authorization` header of the caller to that upstream. The identity of the caller still reaches it, in the headers of the gateway and in the signature. |
| `accessCacheTtlMs` | the value of the environment | The lifetime of the cached decisions of the access service on that route. `0` asks the service for every request, so a revocation on that route is immediate. |
| `replayMaxBytes` | the value of the environment | The size of a body that may be sent again to a second upstream. A body that fits is held in memory, so that the request may be sent to the next upstream when the first one fails. |
| `timeouts.upstreamAttemptMs` | the value of the environment | The budget of one attempt to an upstream, when the route names several. `0` disables it. |

```jsonc
{
  "id": "workspace-api",
  "match": { "host": "api.example.com", "path": "/ws/{workspaceId}/" },
  "upstream": "http://upstream-b:3000",
  "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } },
  // The upstream of this route changes the state of something on a `GET`:
  // it may only be reached from the site itself.
  "crossSite": "strict",
  // The upstream does not need the token of the caller.
  "forwardAuthorization": false
}
```

## The access service of the deployment

The access service is a dependency of the deployment and not a part of
the gateway. The gateway asks it and fails closed: without a decision,
the request is refused.

The address of the service is a **service address**:
`GATEWAY_ACCESS_URL` names the service that answers the protocol, and
`GATEWAY_OIDC_ISSUER` names the issuer of the tokens. The repository of
the platform holds the source code of the services, not their endpoints,
so a deployment never puts the url of a repository in the environment.
The upstream of a route — the data service behind the gateway — is named
the same way, in the `upstream` of the route of the route table.

The protocol of the service is published in
[spec.md](spec.md) §6.1, and a deployment that writes its own service runs
the conformance suite against it:

```bash
GATEWAY_TEST_ACCESS_URL=https://access.example.com \
GATEWAY_TEST_ACCESS_TOKEN=… \
GATEWAY_TEST_ACCESS_ALLOWED_SUBJECT=alice@example.com \
GATEWAY_TEST_ACCESS_ALLOWED_WORKSPACE=11111111-1111-4111-8111-111111111111 \
bun test test/integration/access-conformance.test.ts
```

A deployment that has no service of its own may run the **reference
implementation** that ships with the project:
`services/access-service.ts` applies a policy file and answers the protocol.

```bash
ACCESS_POLICY_FILE=/etc/platform/access-policy.json \
ACCESS_SERVICE_TOKEN=… \
bun run services/access-service.ts
```

The image of the reference implementation is built with the stage
`access-service` of the `Dockerfile`. It is **not** part of the image of the
gateway: the two are different programs and they are deployed apart.

The policy file:

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

A subject that the file does not know is denied. The service applies the
file, and it says no when the file says nothing.

The `routes` of a subject are the routes it may use when the request
names **no workspace**: a route of the gateway that asks the access
service about itself (`accessCheck`) sends a request without a workspace,
and the service decides on the routes of the subject.

**The grace of an outage.** A route may ask the access service for a
decision and go on with the last decision the service took while the
service is down:

```jsonc
{
  "id": "workspace-api",
  "accessStaleGraceMs": 30000
}
```

The grace is `0` by default: an unreachable service is an outage, and the
gateway answers `503 access_unavailable` to it, which is the answer that
tells the operator that the service is down. A grace keeps the traffic of
the route flowing, and it makes the revocations late by that much: the
decisions that were served this way are counted in
`gateway_access_stale_total{route}` and their age is measured in
`gateway_access_stale_age_seconds{route}`.

## The secrets

| Secret | Where it comes from | What it protects | How it is rotated |
| --- | --- | --- | --- |
| `GATEWAY_SESSION_SECRET` | The secret store | The state of the login | The logins in flight fail and the callers sign in again. |
| `GATEWAY_IDENTITY_SIGNING_KEY` | The secret store | The signature of the identity that the upstreams verify | The upstreams are given the new **public key** at the same time. The signatures of the old key are refused in the meantime. |
| `GATEWAY_OIDC_CLIENT_SECRET` | The secret store | The exchange of the code | The provider accepts two secrets during the rotation of the client; the deployment changes the value afterwards. |
| `GATEWAY_ACCESS_TOKEN` | The secret store | The calls to the access service | The service accepts two tokens during the rotation. |
| The password of Redis | The secret store | The sessions and the limits | The deployment changes the password of the client and of the server in the same window. |
| `GATEWAY_METRICS_TOKEN` | The secret store | The metrics | The scraper and the deployment change it together. |
| The public key of the identity signature | `bun run identity:key --public` | The verification of the signature of the identity by the upstreams | The upstreams are given the public key, never the private one. |

The rules:

- a secret is never written in the image, in the configuration file or in
  the repository;
- the upstreams verify the signature of the identity with the **public key**
  and never with the private one, so an upstream that verifies an identity
  cannot mint one;
- the secret of the sessions is the same on every replica: a replica with
  another secret cannot read the session of a caller and cannot verify the
  state of a login.

## The ingress

The gateway does not terminate TLS and it does not rewrite the path of a
request. The ingress is in front of it and it has to preserve the streaming
of the bodies and the WebSockets.

| Setting | Value | Why |
| --- | --- | --- |
| The timeouts of the ingress | At least `GATEWAY_SHUTDOWN_TIMEOUT_MS` for the read, and **no** write timeout. | A stream of events lasts longer than any write timeout. |
| The buffering of the request | off | The body is streamed to the upstream; a buffered body breaks the budgets and the limits of the body. |
| The buffering of the answer | off | The same, for the answers. |
| `proxy_http_version` | `1.1` | The WebSockets need it. |
| `proxy_set_header Upgrade` / `Connection` | on | The WebSockets need it. |
| The limits of the body | The limit of the route (`maxBodyBytes`), or the biggest one. | The gateway refuses the bodies that are over the limit with `413`; the ingress may refuse them earlier, with its own answer. |
| The timeouts of the idle connections | At least `GATEWAY_WS_IDLE_TIMEOUT_SECONDS`. | The WebSockets of the editors are idle most of the time. |
| The number of connections | At least the number of the WebSockets of the deployment. | The ingress is the limit of the connections. |
| The health check | `GET /healthz` | It is always available. |
| The readiness check | `GET /readyz` | It answers `503` when the gateway cannot serve the traffic. |

### The headers of the proxy

The gateway tells the ingress the real address of the caller in
`x-forwarded-for`, `x-forwarded-proto` and `x-forwarded-host`. The ingress
has to set them, and the ranges of the ingress have to be in
`GATEWAY_TRUSTED_PROXIES` (or in the `trustedProxies` of the configuration
file): the headers of a client that is not a trusted proxy are ignored.

The ranges name the **proxies** of the deployment, and they should be as
narrow as the deployment allows: a range that covers the addresses of the
callers trusts every one of them to write the headers of the chain.

The number of the proxies is `GATEWAY_TRUSTED_PROXY_HOPS` (one by
default). Every proxy appends the address it observed to the chain of
`x-forwarded-for`, so the chain holds one entry per proxy, and the gateway
reads the chain from the right: the address of the caller is the entry
that is that many positions from the right. A deployment with two proxies
in front of the gateway — an ingress and a load balancer, for instance —
sets it to `2`.

The variable is what makes the address of the caller **unforgeable**: the
entries a client wrote are on the left of the ones the proxies wrote, and
they are dropped. A client that sends its own `x-forwarded-for` chooses
nothing, and the key of the rate limiter is the one of the caller.

**The host needs attention.** The effective host decides the route that
handles the request, the origin the browser is compared with, and the value
the signature of the identity covers. An ingress that rewrites the `Host`
header to its own name must report the public host in `x-forwarded-host`,
or the requests do not match a route.

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

The path of a request is forwarded unchanged, unless the route declares a
`rewrite`. The ingress must not rewrite it and must not add a prefix: the
upstream application is mounted under the path of its route, and the
signature of the identity covers the path the upstream receives.

A route that declares a `rewrite` writes the path its upstream receives —
`/{rest}` removes the prefix of the route — and the ingress still must not
rewrite the path: the rewrite of the route is applied to the path the
caller sent.

## The metrics

`GET /metrics` answers the Prometheus text exposition format. The endpoint
is `404` when `GATEWAY_METRICS_TOKEN` is not set and `401` when the bearer
token does not match.

The list of the metrics, with their labels and what each one counts, is in
[spec.md](spec.md) §12.1. What follows is what an operator does with
them:

| Metric | What an operator does with it |
| --- | --- |
| `gateway_requests_total` | The traffic of the routes. |
| `gateway_request_errors_total` | An error of the gateway or of the upstream. |
| `gateway_auth_failures_total` | A policy of the platform, not an error of the gateway. |
| `gateway_access_unavailable_total` | The access service is restored. The gateway fails closed, so the callers are refused meanwhile. |
| `gateway_access_stale_total` | The access service is restored. The revocations of the callers are late by the grace of the route. |
| `gateway_cross_site_refusals_total` | An attack or a broken client. |
| `gateway_websocket_connections_total` | The capacity. |
| `gateway_websocket_refusals_total` | The capacity, the origins. |
| `gateway_request_duration_seconds` | The budgets of the routes. |
| `gateway_upstream_duration_seconds` | An upstream that is slow. |
| `gateway_upstream_failures_total` | An upstream that is down. |
| `gateway_upstreams_skipped_total` | The breaker of the upstreams is working. |
| `gateway_active_requests` | The drain. |
| `gateway_config_reloads_total` | A broken file on disk. |
| `gateway_rate_limited_total` | A flood. |
| `gateway_rate_limit_fallback_total` | The limits of the deployment are not the limits that are running: the budget of a caller is spent per replica, not per deployment. |
| `gateway_shared_state_errors_total` | The degradation of the deployment. |

The labels are bounded, and a workspace, a subject, an url or a request id
are never a label: the metrics of a busy gateway do not grow the memory of
the process. The labels themselves are in [spec.md](spec.md) §12.1.

The scraper of the deployment sends the token as a bearer token:

```yaml
scrape_configs:
  - job_name: gateway
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <the token of the secret store>
```

## The logs

The logs are JSON, one object per line. What they carry, what they redact
and the policy the gateway writes when it starts are in [spec.md](spec.md)
§12.2. What an operator reads them for:

- the identifier of the request, which is also the header `x-request-id`
  of the answer: a caller that sends a valid identifier can follow its
  request in the logs;
- the line of a proxied request, which carries the route, the method, the
  path, the status, the duration, the bytes and the outcome (`complete` or
  `aborted`);
- the **caller** and the **workspace**: the gateway decides who reaches
  what, so a log that cannot name the caller cannot answer "who used this
  workspace". The lines of the refusals carry them as well, so a denial
  says who was denied.

## The review of a deployment

This checklist is ticked once per deployment. Every item names the place
where the setting lives, so a reviewer can check it without reading the
code. The rules at the end of each section are the ones the gateway
enforces; the questions are the ones a reviewer has to answer.

### 1. The authentication of the routes

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| Which routes accept a session cookie, which accept a bearer token and which accept both? | `auth.mode` of the route table | |
| Which routes need a workspace and which placeholder carries it? | `auth.workspace` of the route table | |
| Does any route accept no credential at all (`mode: none`)? | `auth.mode` of the route table | |
| Is the upstream of a route with `mode: none` the one that authenticates the caller? | the route table and the application behind it | |

**The rule**: a route with `mode: none` hands the `Authorization` header of
the caller to its upstream unchanged. The upstream of such a route is the
one that authenticates the caller.

### 2. The hosts that are accepted

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| Which hosts does the gateway answer for? | `match.host` of the route table | |
| Is there a route that matches every host (`*`)? What does it serve? | the route table | |
| Do the hosts of the routes match the hosts the callers use? | the route table and the ingress | |
| Does the ingress preserve the `Host` header, or does it report the public host in `x-forwarded-host`? | the ingress | |

**The rules**:

- The effective host decides the route, the origin the browser is compared
  with, and the value the signature of the identity covers. An ingress that
  rewrites the `Host` header without reporting the public host breaks all
  three.
- The paths of the gateway itself (`/healthz`, `/readyz`, `/metrics`,
  `/auth/login`, `/auth/callback`, `/auth/logout`) are reserved whatever
  the configuration says, and a route that claims one of them is refused
  when the configuration is loaded.

### 3. The trusted proxies

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| Which ranges may send the forwarding headers? | `trustedProxies` of the file and `GATEWAY_TRUSTED_PROXIES` | |
| How many proxies are in front of the gateway? | `GATEWAY_TRUSTED_PROXY_HOPS` | |
| Is the ingress the only one that talks to the gateway? | the network policy | |
| Is the client address of a caller the one the rate limiter counts? | `x-forwarded-for` and the trusted proxies | |

**The rule**: the forwarding headers of a request that does not come from a
trusted proxy are ignored, and the address of the peer is the address of the
caller. A range that is too wide lets a caller that reaches the gateway
from it write the whole chain of the request.

### 4. The access to the upstreams

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| Which upstream is behind which route? | the route table | |
| Are the upstreams reachable from the internet? | the network policy and the services | |
| Does the gateway reach the upstreams over TLS? | the url of the upstream | |
| Are the upstreams of the different routes in different trust domains? | the namespace of the services | |
| Do the upstreams verify the signature of the identity? | the application behind them | |

**The rules**:

- The upstreams are only reachable from the gateway. The identity headers of
  the gateway are only trustworthy when the upstream cannot be reached from
  anywhere else.
- An upstream that does not verify the signature trusts the headers of the
  gateway on the word of the network.

### 5. The protection of the metrics

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| Is `GATEWAY_METRICS_TOKEN` set? | the secret of the platform | |
| Who reads the metrics and with which token? | the configuration of the scraper | |
| Is the metrics endpoint reachable from outside the cluster? | the service and the network policy | |

**The rule**: without a token the endpoint answers `404`; with a wrong token
it answers `401`. The metrics carry the routes, the methods, the statuses
and a closed set of reasons: never a workspace, a subject, an url or a
request id.

### 6. The secrets

| Secret | In the secret store | The same on every replica | Rotated |
| --- | --- | --- | --- |
| `GATEWAY_SESSION_SECRET` | | | |
| `GATEWAY_IDENTITY_SIGNING_KEY` | | | |
| `GATEWAY_OIDC_CLIENT_SECRET` | | | |
| `GATEWAY_ACCESS_TOKEN` | | | |
| The password of the shared state | | | |
| `GATEWAY_METRICS_TOKEN` | | | |

**The rules**:

- the secret of the sessions is the same on every replica: a replica with
  another secret cannot read the session of a caller and cannot verify the
  state of a login;
- the upstreams verify the signature of the identity with the **public
  key** of the deployment, never with the private one and never with the
  secret of the sessions;
- a secret is never in the image, in the configuration file or in the
  repository.

### 7. The limits and the budgets

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| What is the limit of the body of a request, and does the ingress agree with it? | `maxBodyBytes` of the routes, `GATEWAY_MAX_BODY_BYTES` and the ingress | |
| Which phase has which budget? | `timeouts` of the routes and of the defaults | |
| Are the budgets of the routes longer than the timeouts of the ingress? | the ingress | |
| Which rate limits are enabled? | `GATEWAY_RATE_LIMIT_MAX`, `_GLOBAL_MAX`, `_PRINCIPAL_MAX`, `_TOTAL_MAX` | |
| Is the budget of the deployment enabled? | `GATEWAY_RATE_LIMIT_TOTAL_MAX` | |
| How many requests may a replica handle at the same time? | `GATEWAY_MAX_CONCURRENT_REQUESTS` and the memory of the pod | |
| How many WebSockets may a replica hold? | `GATEWAY_WS_MAX_CONNECTIONS` and the memory of the pod | |
| How often is an open WebSocket revalidated? | `GATEWAY_WS_REVALIDATE_INTERVAL_MS` | |

**The rules**:

- The ingress must not buffer the bodies and must not have a write timeout
  that is shorter than a stream of events.
- A production deployment has to set at least one rate limit. The scope of
  the deployment is the only one that bounds a flood that spreads over many
  addresses.
- The cap of the exchanges is the bound of the clients that open a request
  and never send its body.

### 8. The capacity

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| What is the measured capacity of a replica? | [capacity.md](capacity.md) | |
| How many replicas does the deployment have? | the autoscaling | |
| What is the capacity of the shared state? | the server of the state | |
| What is the memory of a replica under the load of the deployment? | the limit of the pod | |

**The rule**: the numbers of the capacity document are the ones of the
gateway alone. The capacity of a deployment is bounded by its ingress and by
its upstreams, and it has to be measured there.

### 9. The operations

| Question | Where | The answer of the deployment |
| --- | --- | --- |
| Which probe is the liveness and which one is the readiness? | the deployment | |
| Is the grace period of the pod longer than the deadline of the drain? | the deployment | |
| Who is paged when the readiness fails? | the alerts | |
| How is a broken configuration file rolled back? | the configuration in the version control | |
| How are the sessions invalidated? | [operations.md](operations.md) | |
| What is the latency of a revocation? | `GATEWAY_ACCESS_CACHE_TTL_MS` and `GATEWAY_WS_REVALIDATE_INTERVAL_MS` | |

**The rule**: the latency of a revocation is the TTL of the cache of the
decisions plus the interval of the revalidation of the WebSockets. They are
the knobs an operator turns when a revocation has to be immediate.

## The checks of the project

| Check | Command | In the CI |
| --- | --- | --- |
| Types | `bun run typecheck` | yes |
| Lint | `bun run lint` | yes |
| Format | `bun run format:check` | yes |
| Import boundaries | `bun test test/architecture` | yes |
| Unit and contract tests | `bun test src test/contract` | yes |
| The property tests of the parsers | `bun test test/fuzz` | yes |
| Network tests | `bun test test/network` | yes |
| The shared state against a real Redis | `bun test test/integration` | yes |
| The shared state against a real Postgres | `bun test test/integration` | yes |
| The browser | `bun test test/browser` | yes |
| The interoperability with a real provider | `bun test test/interop` | yes |
| The soak | `bun test test/load` | yes |
| The load | `bun run load` | yes |
| The comparison of the backends | `bun run benchmark` | no |
| The image | `docker build` and the smoke tests | yes |

The last full run of the suite: **793 tests passed, 0 failed** over 79 files
with Bun 1.4.3, including the tests against a real Redis 7.0.15
(`GATEWAY_TEST_REDIS_URL=redis://127.0.0.1:6399/0`) and against a real
Postgres 18.6 (`GATEWAY_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/gateway`),
the 3 tests in Chromium and the 2 soak tests. The four tests of the
interoperability with a real provider are the ones that are skipped: they
need a provider, and the CI workflow runs them against a dex of its own.
The coverage of the source (`src/`) is **93.8 %** of the lines and
**93.0 %** of the functions (the mean of the files of `src/`); the
coverage of the whole tree, the tests included, is **91.7 %** of the lines
and **91.8 %** of the functions.

Without a Redis server and without a Postgres server, the 38 tests of the
shared state are skipped and the rest pass. The tests of the shared state
of a Postgres server run without a server when none is named: they run
against the in-process engine of Postgres itself.

## The workflow of the release

The CI workflow (`.github/workflows/ci.yml`) runs seven jobs:

| Job | What it proves |
| --- | --- |
| `check` | The types, the lint, the format, the import boundaries, the unit and contract tests, the network tests and the soak. |
| `redis` | The shared state against a real Redis 7. |
| `postgres` | The shared state against a real Postgres 18, and the migration of the schema. |
| `interop` | The flow against a real identity provider (dex): the discovery of the provider, and a caller that signs in against it. |
| `load` | The capacity: 20 000 requests at 100 in flight, and 500 WebSockets. |
| `browser` | The cookies and the origins in a real Chromium. |
| `image` | The image builds, starts with the configuration of a deployment, refuses to start without a session secret, without an access service, without an identity provider and without a rate limit, and does not contain the fixtures. |

The release workflow (`.github/workflows/release.yml`) publishes the two
artifacts of a tag: the **image** and the **binaries**. It refuses a tag
that does not name the version of the package, and it computes the
version, the tag and the revision of the release once, for both of them.

The job of the image builds the image of the tag, starts it with the
configuration of a deployment and exports it as an artifact of the run.
The image carries the version and the revision as labels, and holds the
dependencies of the gateway alone.

The image is built twice: once for the local store, so that the checks of
the deployment can run it, and once for the registry. The attestations —
the provenance and the bill of materials — are added by the second build:
the docker exporter of a local build cannot carry the manifest list of an
attestation.

The job of the binaries compiles the gateway for the seven platforms of
the release, and the job of the release publishes them on the release of
the tag:

| Platform | The target of the compilation |
| --- | --- |
| Linux x64 (glibc) | `bun-linux-x64` |
| Linux x64 (musl, Alpine) | `bun-linux-x64-musl` |
| Linux arm64 | `bun-linux-arm64` |
| macOS x64 | `bun-darwin-x64` |
| macOS arm64 | `bun-darwin-arm64` |
| Windows x64 | `bun-windows-x64` |
| Windows arm64 | `bun-windows-arm64` |

The binaries carry the runtime of the release inside them: nothing else has
to be installed. The workflow checks that every binary is of the format of
its platform, and it starts the binary of the runner and waits for its
health probe before it publishes anything. The checksums of the binaries
are published with them.

The libc of a binary is the one of its platform: a binary of `linux-x64`
needs glibc and a binary of `linux-x64-musl` needs musl, so a deployment on
Alpine takes the second one.

## The tag of a release

The version of a release lives in the package and in the files that name
it, and the **tag** is what turns a commit into a release. The workflow of
the tag (`.github/workflows/release-tag.yml`) creates it:

| When | What it does |
| --- | --- |
| The CI of a push on `main` succeeded | It compares the version of the package with the version of the latest tag. The version that is greater is tagged, and the release of the tag starts. |
| The version is the version of the latest tag | There is nothing to do: the release of that version is already published. |
| The version is older than the latest tag | The version was rolled back, and nothing is tagged. |

The tag is created on the commit that the CI proved, and it is never
moved: a tag that exists is a release that was published, and a release
that was published is not republished under another name.

The workflow waits for the CI: a tag publishes a release, and a release of
a commit that did not pass the tests is a release that has to be
withdrawn.

The release is **dispatched** and not triggered. A tag that is pushed with
the token of the repository does not start a workflow by itself — GitHub
holds the events of the token back — so the workflow of the release is
dispatched on the tag it publishes, and it runs in the context of that
tag. A tag that is pushed by hand starts it by itself, as it always did.

The decision is a script, and it runs on a machine as well:

```bash
bun run release:tag             # what it would do
bun run release:tag -- --tag   # it does it
```

The script refuses to tag a commit whose files do not agree on the
version: a release whose manifests name another version deploys
something else than the one that was released.

## The gaps of the deployment

Nothing is missing from the contract of [spec.md](spec.md). The following
are outside the scope of the gateway and are the responsibility of the
deployment:

| Gap | Where it is closed |
| --- | --- |
| The TLS of the clients | An ingress in front of the gateway. |
| The upstream is static per route | A router in front of the pods, when the workspace decides the pod. |
| The revocation of an access takes the TTL of the cache | The TTL is the knob: `GATEWAY_ACCESS_CACHE_TTL_MS`, and `accessCacheTtlMs` on the route that has to be revoked at once. |
| The latency of a decision that is not cached | The control plane has to be fast. The cache absorbs the rest. |
| One hostname per product surface | Subdomains, or one host with distinct path prefixes. |
| The upstream of a websocket over TLS | The websocket client of the runtime cannot speak TLS: the upstream of a websocket is served over plain http. The measurements are in [runtime.md](runtime.md). |

## What is not proven yet

The contract of [spec.md](spec.md) is complete. The following is **not**:
these are the places where the design is settled and the evidence is thin.
They are written down because an operator has to know where the ground is
soft, and because a limit nobody knows about is a limit nobody relies on.

| What | Where it stands |
| --- | --- |
| The history of the project | The repository is young: the design is the work of a few days and it has never carried the traffic of a deployment. Every number of [capacity.md](capacity.md) was measured on one machine with the upstream in the same process. |
| The calls of the access service that are shared | The calls that are in flight are shared **per replica**: a burst that arrives on N replicas asks the service N times, and not once. The cache of the decisions is shared, so the burst is bounded by the lifetime of the cache, and a deployment that needs one call needs a lock in the shared state. |
| The breaker of the access service | The state is **per process**, like the breaker of the upstreams. A replica that did not see the failures calls the service while the others do not, and it learns from its own failures in the same way. |
| The breaker of the upstreams | The state is per process for the same reason: a replica that did not see the failure sends its next requests to the upstream that is down, and it pays the budget of the route. |
| The capacity behind an ingress | There is no ingress in the build environment. The settings that matter are in [the ingress](#the-ingress). |
| The capacity with the shared state on another host | The measurements of [capacity.md](capacity.md) were made with the servers on the same machine: a deployment that reaches them over the network pays the latency of the network on every round trip. |
| The interoperability with a real provider | The contract tests run against the provider of the project and the interop tests run against dex. A provider with another shape — a claim of another name, an id token that carries no nonce — has not been tried. |
