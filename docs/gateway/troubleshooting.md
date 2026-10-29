# Troubleshooting

Symptom-first diagnosis for the gateway: for each status, error code or behavior you see, the likely cause, what to check and how to fix it, with a link to the rule in the spec. It is for operators and developers; planned work such as deployment and rotation is in [Operations](operations.md).

The statuses the gateway generates itself, with their `error` codes and sections, are tabled in
[spec §2.5](spec.md#25-response-codes). A body without the `{"error", "message"}` shape came from the
upstream, not from the gateway.

## Start here

1. Take the `x-request-id` of the failing response and search the logs for it. Request and refusal lines
   carry the route, the caller's subject and the workspace, and the trace ID next to the request ID.
2. Read the `/readyz` body: it reports whether a configuration is loaded, the last reload error
   (`config.lastError`) and the session store.
3. Read the running-policy lines the gateway logs for each configuration generation: they show what every
   route accepts, checks and forwards, and the permissive-setting warnings.
4. Look at the metric that counts the symptom; the table below names it.

| Symptom | Metric |
| --- | --- |
| Rejected callers | `gateway_auth_failures_total{reason}` |
| Access outages | `gateway_access_unavailable_total`, `gateway_access_stale_total` |
| Cross-site refusals | `gateway_cross_site_refusals_total` |
| Rate-limit refusals | `gateway_rate_limited_total`, `gateway_rate_limit_fallback_total` |
| Upstream failures | `gateway_upstream_failures_total`, `gateway_upstreams_skipped_total`, `gateway_request_errors_total` |
| Shared-state trouble | `gateway_shared_state_errors_total` |
| Broken route table | `gateway_config_reloads_total{result="failed"}` |
| WebSocket refusals | `gateway_websocket_refusals_total{reason}` |

## Startup and readiness

### The gateway refuses to start

- **Cause.** A production variable is missing, a value does not parse, the runtime is older than Bun 1.4.3,
  or an upstream client certificate is set without its key (or the reverse).
- **Check.** The error message names the variable or the runtime version it found.
- **Fix.** Set the variable the error names, or its escape hatch
  ([required in production](configuration.md#required-in-production)); run Bun 1.4.3 or later.
- **Rule.** [spec §4](spec.md#4-environment).

### The control plane refuses to start

- **Cause.** `GATEWAY_CONTROL_STATE_URL` is unset, the token map cannot be read, a token is shorter than 16
  characters, or a token equals another secret such as the shared-state password.
- **Check.** The startup error, and the JSON of the file named by `GATEWAY_CONTROL_TOKENS_FILE`.
- **Fix.** Give every operator a distinct token of 16 characters or more, with one scope.
- **Rule.** [spec §12.7](spec.md#127-control-plane).

### `/readyz` answers `503`

- **Cause.** No route table has ever loaded, the session store is unreachable (`sessionStore: unavailable`),
  or the process is shutting down (body `draining`).
- **Check.** The `/readyz` body. A set `config.lastError` alone does not make a replica unready.
- **Fix.** Fix the first route table, restore the shared state, or wait for the drain to finish.
- **Rule.** [spec §12.3](spec.md#123-reload-and-readiness), [§12.4](spec.md#124-shutdown),
  [§12.5](spec.md#125-shared-state).

### Every request gets `503 not_ready`

- **Cause.** The replica started without a valid route table and none has loaded since.
- **Check.** `config.lastError` in `/readyz`; with `GATEWAY_CONFIG_SOURCE=store`, whether the store is empty
  and the `GATEWAY_CONFIG` fallback file is valid.
- **Fix.** Correct the file or write a valid revision through the control plane.
- **Rule.** [spec §2.3](spec.md#23-dispatcher), [§3.4](spec.md#34-route-table-source).

### A route-table change has no effect

- **Cause.** The new table was refused as a whole: an unknown key, two ambiguous routes, a route claiming a
  reserved path, `accessCheck` with mode `none`, or a rewrite naming a placeholder the path lacks.
- **Check.** `config.lastError` in `/readyz` and `gateway_config_reloads_total{result="failed"}`; in store
  mode, `GET /v1/replicas` shows the revision each replica serves.
- **Fix.** Validate the table with `POST /v1/config/validate` before writing it, then correct it. The last
  valid table keeps serving meanwhile, and a fixed file loads within a second.
- **Rule.** [spec §3.1](spec.md#31-fields), [§3.2](spec.md#32-ambiguous-tables-are-rejected),
  [§12.3](spec.md#123-reload-and-readiness).

## Routing

### `404 no_route` on every request

- **Cause.** The host the gateway sees is not the public host. Usually the ingress rewrites `Host` and does not
  send `x-forwarded-host`, or it sends it but its address is not in the trusted ranges, so the header is
  ignored.
- **Check.** The running-policy lines list each route's host; compare them with the host the ingress
  forwards. Check `GATEWAY_TRUSTED_PROXIES` (it replaces the file's `trustedProxies`).
- **Fix.** Have the ingress send `x-forwarded-host`, trust its range, or match the host the ingress sends.
- **Rule.** [spec §7.3](spec.md#73-forwarding-headers-and-client-address).

### `404 no_route` on some requests

- **Cause.** No route matches the host, path and method. A route that lists `match.methods` does not handle
  the others, and `*.example.com` does not match `example.com` itself.
- **Check.** The request's method and path against the route table, and which route wins by precedence.
- **Fix.** Add the method, add a fallback route without methods for the same host and path, or add the host.
- **Rule.** [spec §3.1](spec.md#31-fields), [§3.3](spec.md#33-route-precedence).

### The wrong route answers

- **Cause.** Precedence picks the most specific route: host first, then method, then literal prefix length,
  segment count and route ID.
- **Check.** Whether a host-specific route exists; a catch-all that names the method never wins over it.
- **Fix.** Make the intended route more specific than the one that answers.
- **Rule.** [spec §3.3](spec.md#33-route-precedence).

### `404 not_found` on a path that should be forwarded

- **Cause.** The path is a gateway endpoint (any method on it other than the endpoint's own) or is listed in
  `reservedPaths`; neither is ever forwarded. `GET /metrics` also answers `404` while `GATEWAY_METRICS_TOKEN`
  is unset.
- **Fix.** Serve the upstream under another path, or set the metrics token.
- **Rule.** [spec §2.2](spec.md#22-gateway-endpoints).

## Authentication

### `401 unauthorized`

- **Cause.** The route's mode found no valid credential. In `any` mode a bad bearer token is refused even when a
  valid session cookie was sent, and an `Authorization` header that is not a bearer token is refused.
- **Check.** For a bearer token: signature, issuer, audience (`GATEWAY_OIDC_AUDIENCE`, the client ID by
  default), an `exp` claim, an `iat` claim while `GATEWAY_OIDC_MAX_TOKEN_AGE_MS` is on, a lifetime within that
  bound, no `nonce` claim (an ID token), and the claims in `GATEWAY_OIDC_REQUIRED_TOKEN_CLAIMS`. For a session:
  idle lifetime and maximum age, and whether the session store answers.
- **Fix.** Send an access token, not an ID token; ask the provider for a shorter lifetime; sign in again.
- **Rule.** [spec §5.1](spec.md#51-modes), [§5.3](spec.md#53-sessions), [§5.4](spec.md#54-bearer-tokens).

### The browser loops back to the login page

- **Cause.** The session is created but not found on the next request. Common reasons: replicas keep sessions
  in memory, so another replica does not know the session; the cookie is `Secure` while the browser reaches
  the gateway over plain http; or the session reached its maximum age.
- **Check.** `GATEWAY_SESSION_URL` names a shared Redis or Postgres server on every replica;
  `GATEWAY_COOKIE_SECURE` and `GATEWAY_EXTERNAL_PROTO` match how browsers reach the gateway;
  `GATEWAY_SESSION_MAX_AGE_MS`.
- **Fix.** Share the session store, serve the gateway over https (or turn `GATEWAY_COOKIE_SECURE` off outside
  production), and keep `GATEWAY_SESSION_SECRET` identical on every replica.
- **Rule.** [spec §5.2](spec.md#52-browser-flow), [§5.3](spec.md#53-sessions), [§5.5](spec.md#55-cookies).

### The login callback answers `400 login_failed`

- **Cause.** The state cookie is missing or does not match (a second use of the callback, another replica with
  a different `GATEWAY_SESSION_SECRET`, a restart without a secret set), or the code exchange failed.
- **Check.** The log line of the failed login; whether `GATEWAY_OIDC_REDIRECT_URI` is the URL the gateway is
  reached under and is registered with the provider.
- **Fix.** Set the same session secret on every replica and correct the redirect URI, then start the login
  again from `/auth/login`.
- **Rule.** [spec §5.2](spec.md#52-browser-flow).

### Logins fail with `503`

- **Cause.** `/auth/login` answers `503 identity_provider_unavailable` when the provider cannot be reached; the
  callback answers `503 session_store_unavailable` when the session cannot be stored.
- **Fix.** Restore the provider or the shared state. Existing sessions keep working while only the provider
  is down.
- **Rule.** [spec §5.2](spec.md#52-browser-flow).

### `429` on `/auth/login`

- **Cause.** The login limiter allows `GATEWAY_LOGIN_RATE_LIMIT_MAX` attempts (30 by default) per caller
  address per `GATEWAY_LOGIN_RATE_LIMIT_WINDOW_MS`.
- **Check.** Whether every caller shares one address because the ingress is not trusted (see
  [one budget for everyone](#every-caller-shares-one-budget)).
- **Rule.** [spec §9](spec.md#9-limits).

## Cross-site guard

### Browser requests get `403 cross_site_request`

- **Cause.** The request carries the session cookie and its `Origin` or `Sec-Fetch-Site` is not allowed. When
  it happens on the gateway's own site, the gateway computes its own origin from the wrong host or protocol.
- **Check.** `gateway_cross_site_refusals_total{route}`; whether the ingress sends `x-forwarded-host` and
  `x-forwarded-proto` from a trusted range; `GATEWAY_EXTERNAL_PROTO`.
- **Fix.** Forward the public host and protocol, or add the calling site to `GATEWAY_ALLOWED_ORIGINS`, or fix
  the client.
- **Rule.** [spec §7.3](spec.md#73-forwarding-headers-and-client-address), [§8](spec.md#8-cross-site-requests).

### Deep links from other sites get `403`

- **Cause.** Cross-site navigations are refused by `GATEWAY_CSRF_STRICT=true` or by the route's
  `crossSite: "strict"`.
- **Fix.** Set `crossSite: "navigation"` on routes whose upstream does not change state on `GET`.
- **Rule.** [spec §8](spec.md#8-cross-site-requests).

### A WebSocket handshake gets `403 cross_site_request`

- **Cause.** The handshake carries the session cookie and names no origin, or a foreign one.
  `GATEWAY_CSRF_STRICT` does not change this.
- **Fix.** Open the socket from an allowed origin, or authenticate the client with a bearer token instead of
  the cookie.
- **Rule.** [spec §10](spec.md#10-websockets).

### Logout links from other sites do nothing

- **Cause.** `GET /auth/logout` from another site is refused with `403 cross_site_request`, so a foreign page
  cannot sign a user out.
- **Fix.** Link to logout from the gateway's own site.
- **Rule.** [spec §8](spec.md#8-cross-site-requests).

## Workspace access

### `403 workspace_forbidden`

- **Cause.** Access answered with an explicit denial. The gateway never sends Access's reason to the caller.
- **Check.** `gateway_auth_failures_total{reason}` (`missing_role` or `access_denied`), the gateway's refusal
  log line (subject and workspace), and Access's own log for the reason. If roles are missing, check the
  claim named by `GATEWAY_OIDC_ROLES_CLAIM`.
- **Fix.** Grant the caller the workspace or role in Access. A new grant can take up to the decision cache
  lifetime (`GATEWAY_ACCESS_CACHE_TTL_MS`, 5 s) to apply; `DELETE /v1/decisions` purges it at once.
- **Rule.** [spec §6](spec.md#6-workspace-access), [§6.5](spec.md#65-denial-reasons-in-metrics).

### `400 bad_request` on a workspace route

- **Cause.** The workspace placeholder is missing from the path, or is not a UUID while the route sets
  `requireUuid`.
- **Fix.** Call the route with a UUID in the placeholder, or drop `requireUuid`.
- **Rule.** [spec §2.3](spec.md#23-dispatcher).

### `503 access_unavailable`

- **Cause.** Access could not be asked, or its answer could not be read: a timeout (`GATEWAY_ACCESS_TIMEOUT_MS`,
  3 s), a connection failure, any status other than a decision (including `401` for a wrong token and `404`
  for a wrong path), a non-JSON body, or an `allow` that is not a boolean. While the breaker is open the
  answer comes at once, without calling Access.
- **Check.** `gateway_access_unavailable_total{route}`, `gateway_access_duration_seconds`, and
  `GATEWAY_ACCESS_URL` and `GATEWAY_ACCESS_TOKEN`. Routes that need no decision keep working.
- **Fix.** Restore Access. To keep traffic flowing through a short outage, give the route an
  `accessStaleGraceMs`; this delays revocation by as much.
- **Rule.** [spec §6](spec.md#6-workspace-access), [§6.1](spec.md#61-access-protocol),
  [§6.2](spec.md#62-outage-grace), [§6.4](spec.md#64-access-breaker).

### `gateway_access_stale_total` grows

- **Cause.** Access is unreachable and routes with an `accessStaleGraceMs` are serving the last allowing
  decision, so revocations on those routes are late.
- **Check.** `gateway_access_stale_age_seconds{route}` shows how old the served decisions are.
- **Fix.** Restore Access. Set `accessStaleGraceMs: 0` on routes where a late revocation is unacceptable.
- **Rule.** [spec §6.2](spec.md#62-outage-grace).

### A revoked caller keeps access

- **Cause.** Revocation waits for the cached decision to expire, plus the outage grace when Access is down. An
  open WebSocket is rechecked only at the revalidation interval, and a bearer token stays valid until it
  expires.
- **Check.** `GATEWAY_ACCESS_CACHE_TTL_MS` or the route's `accessCacheTtlMs`, `accessStaleGraceMs`,
  `GATEWAY_WS_REVALIDATE_INTERVAL_MS` and `GATEWAY_OIDC_MAX_TOKEN_AGE_MS`.
- **Fix.** Purge with `DELETE /v1/decisions`, revoke sessions with `DELETE /v1/sessions` or `bun run sessions`
  ([revoking sessions](operations.md#revoking-sessions)), and set `accessCacheTtlMs: 0` on sensitive routes.
- **Rule.** [spec §6](spec.md#6-workspace-access), [§6.2](spec.md#62-outage-grace),
  [§10](spec.md#10-websockets).

## Load and limits

### `503 gateway_overloaded`

- **Cause.** Admission is full (`GATEWAY_MAX_PENDING_REQUESTS`) or the exchange cap is full
  (`GATEWAY_MAX_CONCURRENT_REQUESTS`). A full admission is usually a slow dependency: requests wait on Access
  or the shared state and pile up.
- **Check.** `gateway_active_requests`; admission refusals are counted on route `unmatched` with status `503`,
  exchange-cap refusals on the matched route. Then check Access latency and `gateway_shared_state_errors_total`.
- **Fix.** Repair the slow dependency first. Raise the caps only when pod memory allows it
  ([capacity](internals.md#capacity)).
- **Rule.** [spec §2.4](spec.md#24-admission), [§11.2](spec.md#112-phases-and-budgets).

### `429 too_many_requests`

- **Cause.** A budget refused the request: deployment, caller across routes, caller on the route, or subject on
  the route. The response carries `retry-after`.
- **Check.** `gateway_rate_limited_total` and the configured limits.
- **Fix.** Raise the budget that refuses, or slow the client down until `retry-after` passes.
- **Rule.** [spec §9](spec.md#9-limits).

### Every caller shares one budget

- **Cause.** The ingress is not in the trusted ranges, so the gateway sees the ingress address as every
  caller's address. With too few `GATEWAY_TRUSTED_PROXY_HOPS`, it takes a proxy's entry instead.
- **Check.** `GATEWAY_TRUSTED_PROXIES` and `GATEWAY_TRUSTED_PROXY_HOPS` against the number of proxies in front
  (`2` for a load balancer plus an ingress).
- **Fix.** Trust exactly the proxy ranges and set the hop count to the number of proxies.
- **Rule.** [spec §7.3](spec.md#73-forwarding-headers-and-client-address).

### Limits look per replica

- **Cause.** The shared state is unreachable and `GATEWAY_RATE_LIMIT_FALLBACK=local` counts per process, or
  the deployment runs with in-process state. With `closed`, every request is refused instead.
- **Check.** `gateway_rate_limit_fallback_total{scope}` and `gateway_shared_state_errors_total`.
- **Fix.** Restore the shared state; name a shared server in `GATEWAY_SHARED_STATE_URL`.
- **Rule.** [spec §9](spec.md#9-limits), [§12.5](spec.md#125-shared-state).

### The shared state is down

- **Cause.** Redis or Postgres is unreachable. Callers that need a session are denied (`401` or `503`, and readiness
  answers `503`), decisions are asked again instead of read from the cache, and limits follow
  `GATEWAY_RATE_LIMIT_FALLBACK`.
- **Check.** `gateway_shared_state_errors_total`, the `/readyz` body, and the once-per-outage log line.
- **Fix.** Restore the server; the gateway reconnects in the background and logs the recovery.
- **Rule.** [spec §12.5](spec.md#125-shared-state).

### `413 payload_too_large`

- **Cause.** The body exceeds the route's limit (`maxBodyBytes`, then `defaults.maxBodyBytes`, then
  `GATEWAY_MAX_BODY_BYTES`, 10 MiB by default).
- **Fix.** Raise the route's limit, and keep the ingress body limit at least as large.
- **Rule.** [spec §11.2](spec.md#112-phases-and-budgets).

## Upstreams

### `502 bad_gateway`

- **Cause.** The upstream refused the connection or is unreachable, rejected the gateway's client certificate,
  failed the gateway's certificate check, closed after `103 Early Hints` without a final response, or answered
  `101` on the HTTP path. For a WebSocket route, the upstream refused the handshake or is a `wss` upstream
  (reason `tls`).
- **Check.** The log line of the request (it names the TLS reason), `gateway_upstream_failures_total` and
  `gateway_websocket_refusals_total{reason}`.
- **Fix.** Repair the upstream, or correct `GATEWAY_UPSTREAM_TLS_CA` and the client certificate. Serve
  WebSocket upstreams over plain `ws`, behind a `wss` proxy if needed. With several upstreams, resendable
  requests move on to the next one.
- **Rule.** [spec §11.1.2](spec.md#1112-upstream-tls), [§11.3](spec.md#113-failures-and-what-the-caller-sees),
  [§11.4](spec.md#114-multiple-upstreams).

### `504 gateway_timeout`

- **Cause.** The upstream did not send response headers within `responseMs` (5 s by default) after the upload
  ended. All attempts on a multi-upstream route share that budget.
- **Check.** `gateway_upstream_duration_seconds{route}`.
- **Fix.** Speed up the upstream or raise the route's `timeouts.responseMs`.
- **Rule.** [spec §11.2](spec.md#112-phases-and-budgets), [§11.3](spec.md#113-failures-and-what-the-caller-sees).

### Responses or event streams are cut off

- **Cause.** A failure after the response headers ends the body instead of producing an error: a `firstByteMs`
  timeout (30 s), a `bodyMs` idle gap (300 s), an upstream that answered before reading the whole upload, or an
  ingress timeout.
- **Check.** The request's log line records the outcome `aborted`; the ingress read timeout and buffering.
- **Fix.** Raise the route's `firstByteMs` or `bodyMs`, and configure the ingress as in
  [Operations: ingress](operations.md#ingress).
- **Rule.** [spec §11.2](spec.md#112-phases-and-budgets), [§11.3](spec.md#113-failures-and-what-the-caller-sees).

### `499` in the metrics

- **Cause.** The caller disconnected before response headers were sent; the gateway cancelled the upstream
  request. Nothing reaches the client.
- **Rule.** [spec §11.3](spec.md#113-failures-and-what-the-caller-sees).

### `500 internal_error`

- **Cause.** The caller's subject is empty, holds a control character or is longer than 512 characters, so it
  cannot be written to `x-gateway-user`. The gateway logs the route.
- **Fix.** Correct the subject at the identity provider; the gateway never rewrites it.
- **Rule.** [spec §7.1](spec.md#71-request-→-upstream).

### The upstream refuses the identity signature

- **Cause.** Replicas sign with different keys, a non-production replica signs with a per-process key because
  `GATEWAY_IDENTITY_SIGNING_KEY` is unset (it logs a warning), the upstream rebuilds the payload from other
  values (host, rewritten path, query, sorted roles), or it still verifies `v3` or `v4`.
- **Check.** `bun run identity:key --public` on each replica gives the same public key; the upstream's
  rejection reason from the reference verifier.
- **Fix.** Share one key, and follow [Upstream identity](upstream-identity.md) for the payload.
- **Rule.** [spec §7.4](spec.md#74-identity-signature).

## WebSockets

### Upgrades get `400 websocket_not_allowed`

- **Cause.** The route does not set `websocket: true`.
- **Rule.** [spec §10](spec.md#10-websockets).

### Upgrades get `503 too_many_connections`

- **Cause.** The replica holds `GATEWAY_WS_MAX_CONNECTIONS` open connections (1000 by default).
- **Fix.** Add replicas, or raise the limit within pod memory ([capacity](internals.md#capacity)).
- **Rule.** [spec §10](spec.md#10-websockets).

### Connections close unexpectedly

| Close | Cause |
| --- | --- |
| `1008` | Revalidation failed or could not run: the session expired, access was revoked, or the route changed or stopped accepting WebSockets. Expected; investigate only when it is not. |
| `1001` | The replica is draining (shutdown or rollout). |
| Other | The client did not read (`GATEWAY_WS_BACKPRESSURE_LIMIT_BYTES`), did not answer a ping (`GATEWAY_WS_PONG_TIMEOUT_MS`), was idle (`GATEWAY_WS_IDLE_TIMEOUT_SECONDS`), or sent a message over `GATEWAY_WS_MAX_PAYLOAD_BYTES`. |

Rules: [spec §10](spec.md#10-websockets), [§12.4](spec.md#124-shutdown).

## Control plane

| Status | Cause | Fix |
| --- | --- | --- |
| `401` | No token, or an unknown token. | Send a token from the map. |
| `403` | The token's scope does not cover the endpoint. | `operate` purges, `config` writes the table; neither does the other's job. |
| `409` | `If-Match` is stale, or the write changes a protected route. | Read the active revision again; leave `GATEWAY_PROTECTED_ROUTES` routes unchanged. |
| `422` | The table is invalid. | Fix the errors `POST /v1/config/validate` lists. |
| `429` | Five failed authentications in sixty seconds from this address. | Wait, and fix the client's token. |
| `503` | The shared state is unreachable. | Restore it; the control plane refuses every request meanwhile. |

Rules: [spec §12.7](spec.md#127-control-plane).

## Metrics endpoint

`GET /metrics` answers `404` while `GATEWAY_METRICS_TOKEN` is unset and `401` when the scraper's bearer token
does not match it. Rule: [spec §12.1](spec.md#121-health-readiness-and-metrics).
