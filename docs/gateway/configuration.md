# Configuration

Every `GATEWAY_*` environment variable the gateway and its control plane read, with defaults and production requirements, and the files they read. It is for operators; the rules the gateway applies to its environment are in [spec §4](spec.md#4-environment).

"Production" means `NODE_ENV=production`. Durations are in milliseconds unless the name says otherwise; for
limits, `0` disables the limit. [.env.example](../../packages/gateway/.env.example) holds the same list as a
starting file. A value that cannot be parsed stops the gateway at startup.

## Files

| File | Read by | Set with | Format |
| --- | --- | --- | --- |
| Route table | gateway | `GATEWAY_CONFIG` (default `./config/routes.json`), when `GATEWAY_CONFIG_SOURCE=file`, and as the fallback of an empty store | JSON, [spec §3](spec.md#3-configuration-file). Watched; a reload is atomic ([spec §12.3](spec.md#123-reload-and-readiness)). |
| Control-plane token map | `gateway-control` | `GATEWAY_CONTROL_TOKENS_FILE` | JSON `{token: {operator, scope}}` ([spec §12.7](spec.md#127-control-plane)). |
| `.env` | your process manager | — | Copy of [.env.example](../../packages/gateway/.env.example), adjusted. Keep credentials out of it: they belong in the platform's secret store. |
| `deploy/redis/gateway.acl` | the Redis server, not the gateway | the server's `aclfile` | One ACL rule per line ([Operations: roles](operations.md#roles)). |

### Route-level overrides

These route-table keys override an environment default for one route
([spec §3.1](spec.md#31-fields)):

| Key | Default | Overrides | Use it to |
| --- | --- | --- | --- |
| `maxBodyBytes` | `defaults.maxBodyBytes` | `GATEWAY_MAX_BODY_BYTES` | Raise or lower the body limit of one route. |
| `crossSite` | `navigation` | `GATEWAY_CSRF_STRICT` | Set `strict` when the upstream changes state on a `GET`. |
| `forwardAuthorization` | `false` | — | Set `true` when the upstream needs the caller's token. |
| `accessCacheTtlMs` | environment | `GATEWAY_ACCESS_CACHE_TTL_MS` | Set `0` for immediate revocation. |
| `accessStaleGraceMs` | environment | `GATEWAY_ACCESS_STALE_GRACE_MS` | Serve the last allow decision during an Access outage. |
| `replayMaxBytes` | environment | `GATEWAY_REPLAY_MAX_BYTES` | Cap bodies resent to the next upstream. |
| `timeouts.upstreamAttemptMs` | environment | `GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS` | Budget one attempt across several upstreams; `0` disables it. |

## Required in production

The gateway refuses to start in production without these; the error names the missing variable. Why each
one is required: [spec §4.3](spec.md#43-production-requirements).

| Variable | Escape hatch |
| --- | --- |
| `GATEWAY_SESSION_SECRET` | — |
| `GATEWAY_IDENTITY_SIGNING_KEY` (or `GATEWAY_IDENTITY_SIGNING_KEY_BASE64`) | — |
| `GATEWAY_OIDC_ISSUER`, `GATEWAY_OIDC_CLIENT_ID`, `GATEWAY_OIDC_REDIRECT_URI` | — |
| `GATEWAY_OIDC_CLIENT_SECRET` | `GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT=true` |
| `GATEWAY_ACCESS_URL` | — |
| `GATEWAY_ACCESS_TOKEN` | `GATEWAY_ACCESS_ALLOW_ANONYMOUS=true` |
| One of `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_GLOBAL_MAX`, `GATEWAY_RATE_LIMIT_PRINCIPAL_MAX`, `GATEWAY_RATE_LIMIT_TOTAL_MAX` above `0` | `GATEWAY_ALLOW_NO_RATE_LIMITS=true` |
| `GATEWAY_SESSION_URL` and `GATEWAY_SHARED_STATE_URL` naming a Redis or Postgres server | `GATEWAY_ALLOW_MEMORY_STATE=true` |

`gateway-control` always requires `GATEWAY_CONTROL_STATE_URL`.

## Credentials

In production the gateway refuses to start when a credential is short, is one repeated character, or is a
value the repository publishes ([spec §4.3](spec.md#43-production-requirements)). The rule covers
`GATEWAY_SESSION_SECRET`, `GATEWAY_ACCESS_TOKEN`, `GATEWAY_OIDC_CLIENT_SECRET` and `GATEWAY_METRICS_TOKEN`.

| Variable | Rule in production |
| --- | --- |
| `GATEWAY_SESSION_SECRET` | At least 32 bytes, counted as decoded (64 hexadecimal characters, 44 base64 characters). |
| `GATEWAY_ACCESS_TOKEN` | At least 32 bytes, counted as decoded. |
| `GATEWAY_OIDC_CLIENT_SECRET` | At least 32 bytes, counted as decoded. |
| `GATEWAY_METRICS_TOKEN` | At least 32 bytes, counted as decoded. |

The values of `.env.min`, of the examples and of the fixtures are published: the gateway refuses them, and
so does the control plane with the token of the map of the example.

## Listener and route table

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_HOST` | `0.0.0.0` | Listen address. |
| `GATEWAY_PORT` | `8080` | Listen port. |
| `GATEWAY_CONFIG` | `./config/routes.json` | Route table file. |
| `GATEWAY_CONFIG_SOURCE` | `file` | `file`: watch `GATEWAY_CONFIG`. `store`: read revisions the control plane writes to the shared state ([spec §3.4](spec.md#34-route-table-source)). |
| `GATEWAY_EXTERNAL_PROTO` | `http` | Protocol clients use to reach the gateway (`http` or `https`). |

## Identity provider

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_OIDC_ISSUER` | — | Provider issuer URL. Required in production. |
| `GATEWAY_OIDC_CLIENT_ID` | `gateway` | Client ID. Required in production. |
| `GATEWAY_OIDC_CLIENT_SECRET` | — | Client secret. Required in production unless public client. |
| `GATEWAY_OIDC_REDIRECT_URI` | — | Callback URL, for example `http://localhost:8080/auth/callback`; the URL the gateway is reached under. Required in production. |
| `GATEWAY_OIDC_SCOPES` | `openid,profile,email,groups` | Requested scopes, comma-separated. |
| `GATEWAY_OIDC_ROLES_CLAIM` | `roles` | Claim that carries roles. |
| `GATEWAY_OIDC_AUDIENCE` | the client ID | Audience a bearer token must carry. |
| `GATEWAY_OIDC_REQUIRED_TOKEN_CLAIMS` | — | Comma-separated claims a bearer token must carry, for a provider with a token-type claim (for example `scp`). |
| `GATEWAY_OIDC_REJECT_NONCE_TOKEN` | `true` | Refuse a bearer token that carries a nonce (an ID token). Turn off only for a provider whose access tokens carry one. |
| `GATEWAY_OIDC_MAX_TOKEN_AGE_MS` | `86400000` | Longest bearer-token lifetime (issue to expiry). `0` turns the bound off; an expiry is required either way ([spec §5.4](spec.md#54-bearer-tokens)). |
| `GATEWAY_OIDC_ALLOW_INSECURE` | `true` outside production | Accept a provider not served over https. |
| `GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT` | `false` | Accept a provider client without a secret. |

## Access

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_ACCESS_URL` | — | Base URL, for example `http://access.internal:8090`. Required in production. |
| `GATEWAY_ACCESS_TOKEN` | — | Token the gateway authenticates with. Required in production unless anonymous. |
| `GATEWAY_ACCESS_ALLOW_ANONYMOUS` | `false` | Access authenticates the gateway by other means. |
| `GATEWAY_ACCESS_TIMEOUT_MS` | `3000` | Wait for a decision. Minimum `1`. |
| `GATEWAY_ACCESS_CACHE_TTL_MS` | `5000` | Decision cache lifetime, which is the revocation latency. Routes override it with `accessCacheTtlMs`. |
| `GATEWAY_ACCESS_STALE_GRACE_MS` | `0` | Serve the last allow decision this long into an outage ([spec §6.2](spec.md#62-outage-grace)). Routes override it with `accessStaleGraceMs`. Max `3600000`. |
| `GATEWAY_ACCESS_BREAKER_FAILURES` | `5` | Consecutive failures before Access is no longer called. `0` disables the breaker ([spec §6.4](spec.md#64-access-breaker)). |
| `GATEWAY_ACCESS_BREAKER_COOLDOWN_MS` | `5000` | How long the open breaker skips Access. Max `3600000`. |

## Sessions and identity signing

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_SESSION_URL` | `memory://local` | Session store. The scheme picks the backend: `memory://`, `redis://`, `rediss://`, `postgres://`, `postgresql://` ([URL forms](#shared-state)). |
| `GATEWAY_SESSION_KEY_PREFIX` | `gateway` | Prefix of every key, so environments can share a server. |
| `GATEWAY_SESSION_SECRET` | — | Signs the login state cookie. Same value on every replica. Required in production; unset, each process generates its own. |
| `GATEWAY_IDENTITY_SIGNING_KEY` | — | PEM P-256 private key that signs request identities. Same key on every replica. Required in production; without it, a non-production process signs with a key it generates, which no upstream can verify. `bun run identity:key` generates a pair. |
| `GATEWAY_IDENTITY_SIGNING_KEY_BASE64` | — | The same key in base64, for secret stores that hand out base64. |
| `GATEWAY_SESSION_TTL_MS` | `28800000` | Idle lifetime. Minimum `1000`. |
| `GATEWAY_SESSION_MAX_AGE_MS` | `86400000` | Maximum age from creation. `0` means none. |
| `GATEWAY_SESSION_TOUCH_INTERVAL_MS` | `60000` | A session is rewritten at most once per interval. |
| `GATEWAY_SESSION_MAX_SESSIONS` | `5000` | Capacity of the in-process store. |
| `GATEWAY_SESSION_TLS_CA`, `GATEWAY_SESSION_TLS_CA_BASE64` | — | CA of a private session-store endpoint (PEM or base64). |

## Shared state

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_SHARED_STATE_URL` | the session URL, when that names a shared server | Server for rate-limit windows and cached decisions. Required in production. |
| `GATEWAY_SHARED_STATE_KEY_PREFIX` | `gateway` | Key prefix. |
| `GATEWAY_SHARED_STATE_TLS_CA`, `GATEWAY_SHARED_STATE_TLS_CA_BASE64` | — | CA of a private endpoint. |
| `GATEWAY_REDIS_SENTINEL_MASTER` | — | Master name the sentinels agree on, when the URL hosts are Redis sentinels. Leave it unset when not behind Sentinel. |
| `GATEWAY_ALLOW_MEMORY_STATE` | `false` | Allow in-process state in production, for a single node that accepts losing sessions with the process. |

The URL selects the server type of `GATEWAY_SESSION_URL` and `GATEWAY_SHARED_STATE_URL`;
`GATEWAY_CONTROL_STATE_URL` names one of the same servers:

| URL | Server |
| --- | --- |
| `memory://local` | In-process store, for a single node only. |
| `redis://host:6379/0` | Redis server. |
| `rediss://host:6379/0` | Redis server with transport encryption. |
| `redis://host-a:6379,host-b:6379/0` | Redis cluster; the hosts are its masters. |
| `redis://host-a:26379,host-b:26379/0` with `GATEWAY_REDIS_SENTINEL_MASTER` | Redis Sentinel; master and replicas are discovered from the sentinels. |
| `postgres://user:password@host:5432/gateway` | Postgres server. |
| `postgresql://user:password@host:5432/gateway` | Same Postgres server. |

Postgres only (no effect on Redis):

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_POSTGRES_POOL_MAX` | `10` | Connections per replica (1–1000). |
| `GATEWAY_POSTGRES_CONNECTION_TIMEOUT_MS` | `5000` | Wait for a pool connection. Minimum `100`. |
| `GATEWAY_POSTGRES_STATEMENT_TIMEOUT_MS` | `5000` | Longest statement. Minimum `100`. |
| `GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT` | `off` | `on` makes the server wait for the disk ([spec §12.5](spec.md#125-shared-state)). |
| `GATEWAY_POSTGRES_AUTO_MIGRATE` | `true` outside production | Build the schema on connect. Set `false` when you run `bun run postgres:migrate` yourself. |

## Upstream TLS

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_UPSTREAM_TLS_CA`, `GATEWAY_UPSTREAM_TLS_CA_BASE64` | — | CA that signs upstream certificates. |
| `GATEWAY_UPSTREAM_TLS_CERT`, `GATEWAY_UPSTREAM_TLS_CERT_BASE64` | — | Client certificate presented to upstreams that ask. |
| `GATEWAY_UPSTREAM_TLS_KEY`, `GATEWAY_UPSTREAM_TLS_KEY_BASE64` | — | Its private key. Setting the certificate without the key, or the reverse, stops startup. |

WebSocket upstreams always use plain http ([spec §11.1.2](spec.md#1112-upstream-tls)).

## Browser and network

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_COOKIE_SECURE` | `true` in production | `Secure` attribute on cookies. |
| `GATEWAY_ALLOWED_ORIGINS` | — | Origins allowed besides the gateway's own, comma-separated. |
| `GATEWAY_CSRF_STRICT` | `false` | Also refuse cross-site navigations. Routes opt in with `crossSite: "strict"` ([spec §8](spec.md#8-cross-site-requests)). |
| `GATEWAY_TRUSTED_PROXIES` | — | CIDR ranges whose forwarding headers are trusted, comma-separated. When set, replaces the file's `trustedProxies`. A range of a production deployment covers at most sixteen addresses ([spec §7.3](spec.md#73-forwarding-headers-and-client-address)). |
| `GATEWAY_TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxies in front (1–16) ([spec §7.3](spec.md#73-forwarding-headers-and-client-address)). |

> [!NOTE]
> The cross site guard reads `Sec-Fetch-Site` and `Origin`. A request that carries **neither** header is allowed, whatever its method: a client that is not a browser never sends them. Every browser of the last years sends `Origin` on a state changing request and `Sec-Fetch-Site` on every request, and a page of another site cannot drop them. A deployment that wants the guard to refuse the case as well turns `GATEWAY_CSRF_STRICT` on.

> [!IMPORTANT]
> The trust of a range is the trust of every workload of that range: a peer that is inside it chooses the host of the request, the address of the caller and the protocol of the request, and with them the route that handles the request, the budget of the caller and the comparison of the origin. Name the addresses of the proxies of the deployment and nothing else. A production gateway refuses to start with a range that covers more than sixteen addresses, and it publishes the ranges it trusts in `gateway_trusted_proxies` and in the log of the active configuration.

## Limits

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_WINDOW_MS` | `0`, `60000` | One caller on one route. |
| `GATEWAY_RATE_LIMIT_GLOBAL_MAX`, `GATEWAY_RATE_LIMIT_GLOBAL_WINDOW_MS` | `0`, `60000` | One caller across all routes. |
| `GATEWAY_RATE_LIMIT_PRINCIPAL_MAX`, `GATEWAY_RATE_LIMIT_PRINCIPAL_WINDOW_MS` | `0`, `60000` | One authenticated subject on one route. |
| `GATEWAY_RATE_LIMIT_TOTAL_MAX`, `GATEWAY_RATE_LIMIT_TOTAL_WINDOW_MS` | `0`, `1000` | The whole deployment; the only scope that bounds a flood from many addresses. |
| `GATEWAY_LOGIN_RATE_LIMIT_MAX`, `GATEWAY_LOGIN_RATE_LIMIT_WINDOW_MS` | `30`, `60000` | Login attempts per caller. |
| `GATEWAY_RATE_LIMIT_FALLBACK` | `local` | While the shared state is unreachable: `local` counts per process, `open` allows all, `closed` refuses all ([spec §9](spec.md#9-limits)). |
| `GATEWAY_ALLOW_NO_RATE_LIMITS` | `false` | Allow production with every rate limit off. |
| `GATEWAY_MAX_BODY_BYTES` | `10485760` | Default request body limit. |
| `GATEWAY_MAX_CONCURRENT_REQUESTS` | `1000` | Concurrent upstream exchanges. |
| `GATEWAY_MAX_PENDING_REQUESTS` | `1000` | Requests inside the gateway, including those waiting on Access. Overflow gets `503 gateway_overloaded` ([spec §2.4](spec.md#24-admission)). |
| `GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS` | `2000` | Budget of one attempt when a route has several upstreams; resendable requests only. `0` disables it. Routes override it with `timeouts.upstreamAttemptMs`. |
| `GATEWAY_REPLAY_MAX_BYTES` | `65536` | Largest body held in memory so it can be resent to the next upstream. `0` streams every body. Routes override it with `replayMaxBytes`. |
| `GATEWAY_UPSTREAM_BREAKER_FAILURES` | `3` | Consecutive failures before an upstream moves to the end of the list ([spec §11.4](spec.md#114-multiple-upstreams)). `0` disables the breaker. |
| `GATEWAY_UPSTREAM_BREAKER_COOLDOWN_MS` | `30000` | How long it stays there. |

Rate-limit windows have a minimum of `1000` ms, except `GATEWAY_RATE_LIMIT_TOTAL_WINDOW_MS` (minimum `100`).

## WebSockets

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_WS_MAX_CONNECTIONS` | `1000` | Open connections per replica. |
| `GATEWAY_WS_MAX_PAYLOAD_BYTES` | `16777216` | Largest message. |
| `GATEWAY_WS_MAX_BUFFERED_BYTES` | `262144` | Outbound buffer, in bytes. |
| `GATEWAY_WS_MAX_BUFFERED_MESSAGES` | `100` | Outbound buffer, in messages. |
| `GATEWAY_WS_BACKPRESSURE_LIMIT_BYTES` | `1048576` | Backlog at which a client that does not read is closed. |
| `GATEWAY_WS_PING_INTERVAL_MS` | `30000` | Keepalive ping interval. |
| `GATEWAY_WS_PONG_TIMEOUT_MS` | `90000` | Wait for a pong. |
| `GATEWAY_WS_IDLE_TIMEOUT_SECONDS` | `120` | Idle connection lifetime, in seconds. |
| `GATEWAY_WS_HANDSHAKE_TIMEOUT_MS` | `10000` | Budget of the upstream handshake. Minimum `100`. |
| `GATEWAY_WS_REVALIDATE_INTERVAL_MS` | `60000` | Revalidation interval; `0` disables it. |

Revalidation closes a connection whose session expired, access was revoked or route changed, with code
`1008` ([spec §10](spec.md#10-websockets)).

## Operations

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_METRICS_TOKEN` | — | Bearer token for `/metrics`. Unset, the endpoint answers `404`. |
| `GATEWAY_SHUTDOWN_TIMEOUT_MS` | `15000` | Drain deadline on `SIGTERM` and `SIGINT`. |
| `GATEWAY_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |

## Control plane

Read by `gateway-control` only ([spec §12.7](spec.md#127-control-plane)).

| Variable | Default | Effect |
| --- | --- | --- |
| `GATEWAY_CONTROL_HOST` | `127.0.0.1` | Listen address. |
| `GATEWAY_CONTROL_PORT` | `9090` | Listen port. |
| `GATEWAY_CONTROL_TOKENS_FILE` | — | File holding the token map `{token: {operator, scope}}`. Scopes: `read`, `operate`, `config`. Tokens are at least 16 characters. |
| `GATEWAY_CONTROL_TOKENS` | — | The map inline. Prefer the file: the map is a secret. |
| `GATEWAY_CONTROL_STATE_URL` | — (required) | Shared state, with the control plane's credentials. |
| `GATEWAY_CONTROL_STATE_TLS_CA`, `GATEWAY_CONTROL_STATE_TLS_CA_BASE64` | — | CA of a private endpoint. |
| `GATEWAY_CONTROL_KEY_PREFIX` | `gateway` | Must match the gateway's `GATEWAY_SESSION_KEY_PREFIX`. |
| `GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX` | `gateway` | Must match the gateway's `GATEWAY_SHARED_STATE_KEY_PREFIX`. |
| `GATEWAY_PROTECTED_ROUTES` | — | Route IDs a table write may not remove or change, comma-separated. |

The control plane also reads `GATEWAY_MAX_BODY_BYTES`, `GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS`,
`GATEWAY_REPLAY_MAX_BYTES`, `GATEWAY_ACCESS_STALE_GRACE_MS` and `GATEWAY_TRUSTED_PROXIES`, with the same
defaults: it compiles the tables it validates with them. Give it the gateway's values.

## Test suite

Read by tests, not the gateway: `GATEWAY_TEST_REDIS_URL`, `GATEWAY_TEST_POSTGRES_URL`, the
`GATEWAY_TEST_DEX_*` variables of the interop tests, and the `GATEWAY_TEST_ACCESS_*` variables of the Access
conformance suite (see [Operations](operations.md#access)).
