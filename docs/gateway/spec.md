# Specification

The normative contract of the gateway's external behavior: the request pipeline, the route table, authentication, access decisions, headers, limits, proxying, operational interfaces and release compatibility. It is for implementers and reviewers; code that cites `§N` refers to this page, and this page wins any disagreement.

Status: 1.0.0. Runtime: Bun ≥ 1.4.3 ([decisions.md](decisions.md), decision 36);
the gateway **refuses to start** on an older runtime (§4.2). Listener: HTTP and
WebSocket on `GATEWAY_HOST:GATEWAY_PORT` (default `0.0.0.0:8080`).

The gateway authenticates a caller against an OpenID Connect provider, asks
Access whether the caller may use a workspace, and forwards the request to the
matched route's upstream. Code organization is not part of the contract: it is
in [internals.md](internals.md#code-layout). The reasons behind the contract
are in [decisions.md](decisions.md). A recommendation in an implementation
guide is not a requirement until it is recorded here.

---

## 1. Terms

| Term | Meaning |
| --- | --- |
| **caller** | The gateway's client: a browser or an API client. |
| **principal** | The authenticated caller: `subject`, optional `email`, `roles`, and the credential `source` (`session` or `jwt`). |
| **route** | A host and path match with one policy and either one upstream or an ordered list of upstreams tried one at a time. |
| **workspace** | The unit of access control, named by a path placeholder (`{workspaceId}`). |
| **upstream** | The application a request is forwarded to. |
| **Access** | The external service that decides whether a subject may use a workspace. |

Invariants (enforced in code, not configurable):

- The gateway never decides access on its own. It asks Access and
  fails closed.
- Only the gateway writes its identity headers. A copy sent by a client is
  always stripped.
- The gateway's cookies never reach an upstream.
- An invalid credential of the kind the route's mode selected is rejected. The
  gateway never falls back to another credential (§5.1).
- The cross-site guard is triggered by the **presence of the session cookie**,
  not by the credential that authenticated the request (§8).

---

## 2. Request pipeline

### 2.1 Request ID

A middleware wraps the gateway endpoints and the dispatcher, so every response
carries a request ID:

- the request's `x-request-id` is reused when it matches
  `^[A-Za-z0-9._-]{1,64}$`;
- otherwise a UUID is generated (the ID lands in logs and headers, so it may
  carry nothing else);
- the ID is written to the response's `x-request-id` header and to every log
  line of the request.

### 2.2 Gateway endpoints

These paths have their own handlers, matched before the route table. They are
never forwarded to an upstream, whatever the configuration says.

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok",…}`. Always available. |
| `GET /readyz` | `200` when a configuration is loaded and the session store answers, `503` otherwise (§12.3). |
| `GET /metrics` | Prometheus text. `404` when `GATEWAY_METRICS_TOKEN` is unset, `401` when the bearer token does not match. |
| `GET /auth/login` | Login limiter, then an OIDC redirect (§5.2). |
| `GET /auth/callback` | Completes the login (§5.2). |
| `GET /auth/logout` | Cross-site navigation guard, then destroys the session and answers `302 /`. |
| `GET /openapi.json` | The gateway's API description: the paths it serves itself and their response shapes. The API check compares it with the gateway's routes. |

`/auth/login` computes the forwarding context itself (§7.3), like the
dispatcher, because its limiter needs the caller's address.

Another method on one of these paths (for example `POST /healthz`) falls
through to the dispatcher and gets `404 not_found`: the path is reserved.

### 2.3 Dispatcher

Every other request runs these steps, in this order:

1. **Configuration.** No configuration ever loaded → `503 not_ready`.
2. **Reserved path.** A §2.2 endpoint or a configured `reservedPaths` entry →
   `404 not_found`.
3. **Forwarding context.** Compute the peer address, the trusted-proxy
   evaluation and the client address (§7.3).
4. **Route match.** Match host and path **before** the limiters, so a route's
   budget is keyed by the route that would handle the request.
5. **Admission.** `GATEWAY_MAX_PENDING_REQUESTS` bounds the requests inside the
   gateway at once (§2.4). No room → `503 gateway_overloaded`, immediately.
6. **Rate limits.** Deployment budget, then the caller's budget across all
   routes, then the caller's budget on this route (§9). Refusal → `429
   too_many_requests` with `retry-after`.
7. **No route.** No matching route → `404 no_route`. The limiters have already
   counted it in the `none:<ip>` bucket, so a flood of requests to nonexistent
   paths is limited like any other.
8. **Authentication.** Per the route's mode (§5). Failure → `401
   unauthorized`, or a `302` to `/auth/login?redirect=…` when the client
   accepts HTML and the mode is not `jwt`-only.
9. **Principal limit.** The authenticated caller's budget on this route (§9).
   Refusal → `429 too_many_requests`.
10. **Cross-site guard.** Applied when the request carries the session cookie
    (§8). Refusal → `403 cross_site_request`.
11. **Workspace check.** Read the placeholder, validate it as a UUID when
    `requireUuid` is set (a missing or invalid identifier → `400
    bad_request`), and ask Access (§6). Denial → `403 workspace_forbidden`;
    Access outage → `503 access_unavailable`.
12. **Dispatch.** WebSocket upgrade (§10) or HTTP proxying (§11).

Responses the gateway generates itself are JSON
`{"error": <code>, "message": <text>}`, except the documented redirects, the
client-disconnect outcome and the upgrade behavior. Upstream bodies are
forwarded unchanged.

### 2.4 Admission

`GATEWAY_MAX_PENDING_REQUESTS` (default 1 000; `0` disables) bounds the
requests **inside** the gateway at once. A request that does not fit gets `503
gateway_overloaded` immediately.

It is separate from the exchange cap (`GATEWAY_MAX_CONCURRENT_REQUESTS`,
§11.2), which counts only requests talking to an upstream. Admission also
covers requests **waiting** on a dependency, such as an access decision that
can hold process resources for the whole call budget (3 s by default).
Refusing fast keeps a slow dependency from snowballing into a deployment-wide
outage.

The slot is taken when the request enters the pipeline and released when the
response is handed to the runtime. In-flight requests are published as
`gateway_active_requests`. A refused request is counted before route matching,
on route `unmatched` with status `503`, which distinguishes it from a request
that matched no route.

### 2.5 Response codes

The statuses and `error` codes the gateway generates itself on the request
path, with the section that states each. Diagnosis by symptom:
[troubleshooting.md](troubleshooting.md).

| Status | `error` | When | Section |
| --- | --- | --- | --- |
| `302` | — | Login redirect for a browser without a valid session; end of login; logout. | §2.2, §2.3, §5.2 |
| `400` | `bad_request` | The workspace identifier is missing from the path, or is not a UUID while `requireUuid` is set. | §2.3 |
| `400` | `websocket_not_allowed` | Upgrade on a route without `websocket: true`. | §10 |
| `400` | `login_failed` | The login callback could not be completed. | §5.2 |
| `401` | `unauthorized` | No valid credential for the route's mode; `/metrics` with a wrong token. | §5, §12.1 |
| `403` | `cross_site_request` | Cross-site guard refusal, including WebSocket handshakes and `/auth/logout`. | §8, §10 |
| `403` | `workspace_forbidden` | Access answered `{"allow": false}`. | §6 |
| `404` | `not_found` | Reserved path, another method on a gateway endpoint, `/metrics` without a token configured. | §2.2 |
| `404` | `no_route` | No route matches host, path and method. | §2.3, §3.3 |
| `413` | `payload_too_large` | Request body over the route's limit. | §11.2 |
| `429` | `too_many_requests` | A rate limit or the login limiter refused; carries `retry-after`. | §9 |
| `499` | — (empty body) | The caller went away before response headers were sent. | §11.3 |
| `500` | `internal_error` | The caller's subject cannot be written to a header. | §7.1 |
| `502` | `bad_gateway` | Upstream unreachable, certificate rejected, closed without final headers, `101` on the HTTP path. | §11.1.2, §11.2, §11.3 |
| `503` | `not_ready` | No configuration has ever been loaded. | §2.3 |
| `503` | `gateway_overloaded` | Admission or the exchange cap is full. | §2.4, §11.2 |
| `503` | `access_unavailable` | Access could not be asked or its answer could not be read; carries `retry-after`. | §6 |
| `503` | `too_many_connections` | `GATEWAY_WS_MAX_CONNECTIONS` reached. | §10 |
| `503` | `identity_provider_unavailable` | `/auth/login` cannot reach the identity provider. | §5.2 |
| `503` | `session_store_unavailable` | The login callback cannot write the session. | §5.2 |
| `504` | `gateway_timeout` | The upstream did not answer within `responseMs`. | §11.3 |

---

## 3. Configuration file

The route table is a JSON file. It is validated as a whole and rejected as a
whole when invalid; it is never half-applied.

```jsonc
{
  "version": 1,
  "defaults": {
    "auth": { "mode": "none" },
    "timeouts": { "responseMs": 5000, "firstByteMs": 30000, "bodyMs": 300000 },
    "maxBodyBytes": 10485760
  },
  "trustedProxies": ["10.0.0.0/8"],
  "reservedPaths": [],
  "routes": [
    {
      "id": "workspace-api",
      "match": { "host": "api.example.com", "path": "/ws/{workspaceId}/" },
      "upstream": "http://upstream-b:3000",
      "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } },
      "websocket": true
    }
  ]
}
```

### 3.1 Fields

Top level (each `defaults.*` value applies to routes that declare none):

| Field | Rule |
| --- | --- |
| `version` | Exactly `1`. |
| `defaults.auth` | Authentication policy (§5). |
| `defaults.timeouts` | Phase budgets (§11.2). |
| `defaults.maxBodyBytes` | Body limit. |
| `defaults.crossSite` | Cross-site policy (§8). Default `navigation`. |
| `defaults.forwardAuthorization` | Whether the caller's `Authorization` header is forwarded upstream (§7.1). Default `false`: the credential of the caller stays in the trust domain of the gateway. |
| `defaults.accessCacheTtlMs` | Lifetime of a cached access decision (§6). Default: the environment's value. |
| `defaults.accessStaleGraceMs` | Access outage grace (§6.2). Default: the environment's value. |
| `defaults.replayMaxBytes` | Largest body that may be resent to a second upstream (§11.4). Default: the environment's value. |
| `trustedProxies` | Ranges whose forwarding headers are honored (§7.3). `GATEWAY_TRUSTED_PROXIES` replaces them when set. |
| `reservedPaths` | Paths the gateway keeps for itself, in addition to §2.2. |
| `routes` | At least one route. |

Route:

| Field | Rule |
| --- | --- |
| `id` | Lowercase kebab-case, at most 63 characters, unique. |
| `match.host` | `example.com`, `*.example.com` (subdomains only, not the domain itself), or `*` for any host. |
| `match.path` | A list of segments. A segment is a literal or a `{placeholder}`. |
| `match.methods` | Accepted methods, uppercase. No list means every method. A route that lists methods does not handle the others (§3.3). |
| `rewrite` | Path forwarded upstream, as a list of segments. Placeholders take the caller's values; `{rest}` is the path after the matched prefix. Without it, the request path is forwarded (§11.1). |
| `upstream` | An `http` or `https` URL, or a list of them. No query string or fragment. Tried in list order (§11.4). |
| `auth` | Route policy. Replaces `defaults.auth`; not merged with it. |
| `timeouts` | Route budgets. Merged field by field with `defaults.timeouts`. |
| `maxBodyBytes` | Body limit. Precedence: route, then `defaults.maxBodyBytes`, then `GATEWAY_MAX_BODY_BYTES`. |
| `replayMaxBytes` | Largest body that may be resent to a second upstream (§11.4). Precedence: route, then `defaults.replayMaxBytes`, then `GATEWAY_REPLAY_MAX_BYTES`. |
| `crossSite` | `navigation` (default) or `strict` (§8). Replaces `defaults.crossSite`. |
| `forwardAuthorization` | Whether the caller's `Authorization` header is forwarded (§7.1). Replaces `defaults.forwardAuthorization`. |
| `accessCacheTtlMs` | Lifetime of a cached access decision, in ms (§6). Replaces `defaults.accessCacheTtlMs`. `0` asks the service on every request. |
| `accessStaleGraceMs` | How long, in ms, a decision may be served after Access became unreachable (§6.2). Precedence: route, then `defaults.accessStaleGraceMs`, then `GATEWAY_ACCESS_STALE_GRACE_MS`. `0` disables the grace. |
| `accessCheck` | Ask Access about a route that names no workspace (§6.3). Default `false` (not checked). Requires an authentication mode other than `none`. |
| `websocket` | Accept WebSocket upgrades. Default `false`. |

An unknown key is a configuration error, never silently ignored.

### 3.2 Ambiguous tables are rejected

Loading refuses two routes that could match exactly the same request (same
host kind and value, same path skeleton); otherwise the response would depend
on file order. A route that claims a reserved path is refused for the same
reason.

### 3.3 Route precedence

The most specific matching route wins. Routes are compared by:

1. Host specificity: exact host, then wildcard (`*.example.com`), then
   catch-all (`*`).
2. Method: a route that names the request method beats one that names none.
3. Length of the path template's literal prefix.
4. Number of template segments.
5. Route ID, alphabetically.

**Host comes first.** A route for a more specific host is never shadowed by a
less specific one, even one that names the request method. A catch-all that
names `GET` does not answer `GET` for a host that has its own route; that
route's policy (authentication, limits, upstream) applies.

**Method decides among routes for the same host.** A route that lists methods
handles only those. A route that names the request method beats one that names
none, so a route without methods is the fallback for methods no other route
names. Two routes with the same methods, host and path are ambiguous and
refused (§3.2); with different methods they are two halves of one route.

### 3.4 Route table source

`GATEWAY_CONFIG_SOURCE` selects `file` (default) or `store`. In `store` mode
the route table lives in the shared state that already holds sessions (§12.5)
as a list of **revisions**:

| Field | Meaning |
| --- | --- |
| `revision` | Revision number. Grows with every write; never changes. |
| `table` | The route table, as in the §3 file. |
| `author` | Operator who wrote it. |
| `createdAt` | When it was written. |

Revisions are **immutable**. A separate **pointer** names the active revision,
and only the pointer moves. The revision list is the table's history.

The gateway reads the pointer and the revision it names, and **watches** the
pointer by polling it at least once a second. A new revision goes through the
**same path as the file**: the whole table is validated and checked for
ambiguity (§3.2) before it replaces the running one, so a broken table never
takes a running deployment out of rotation.

At startup:

- an **empty** store falls back to `GATEWAY_CONFIG`: the file is read and the
  deployment starts with it;
- an **unreachable** store keeps the last valid table and keeps serving it. The
  failure is reported like a failed file reload (§12.3): `config.lastError` in
  `/readyz` and `gateway_config_reloads_total{result="failed"}`.

Each replica writes a **heartbeat** to the shared state: replica ID, revision
served, last error, timestamp. Heartbeats have a **TTL**, so a replica that is
gone disappears on its own. The control plane's `/v1/replicas` shows them
(§12.7).

---

## 4. Environment

Every variable, its default and whether production requires it:
[configuration.md](configuration.md). This section states the rules the
gateway applies to its environment.

### 4.1 Validation at startup

The environment is read once at startup and validated as a whole. A value that
cannot be parsed stops the gateway: a setting that looks active but is not is a
security hole. Log level rules: [platform operations](../platform/operations.md).

The gateway reads `GATEWAY_CONFIG_SOURCE` to pick its route table source
(§3.4). The shared-state URL's scheme selects the server type: Redis (a single
server, a cluster when the URL names several hosts, or Sentinel when
`GATEWAY_REDIS_SENTINEL_MASTER` is set) or Postgres (`postgres://` or
`postgresql://`).

### 4.2 Runtime version

The **runtime** is validated first, before the environment. The gateway needs
Bun ≥ 1.4.3 (decision 36) and stops on an older version, where these behaviors
are not observable: an upstream's early response during an upload, cancelling
the body producer, refusing an upstream WebSocket handshake, and upgrading the
caller with gateway headers. Measurements:
[internals.md](internals.md#runtime).

### 4.3 Production requirements

In production (`NODE_ENV=production`) the gateway refuses to start unless each
row below holds. The error names the missing variable.

| Requirement | Why |
| --- | --- |
| `GATEWAY_SESSION_SECRET` is set | Signs the login state. Same value on every replica. |
| `GATEWAY_IDENTITY_SIGNING_KEY` is set | Private key that signs request identities. Same key on every replica; upstreams get the public key (§7.4). |
| `GATEWAY_OIDC_ISSUER` is set | Identity provider. |
| `GATEWAY_OIDC_CLIENT_ID` is set | The gateway's client ID. |
| `GATEWAY_OIDC_REDIRECT_URI` is set | URL the provider sends the browser back to. |
| `GATEWAY_OIDC_CLIENT_SECRET` is set | Client secret. `GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT=true` replaces it when the provider accepts a public client. |
| `GATEWAY_ACCESS_URL` is set | Access URL. |
| `GATEWAY_ACCESS_TOKEN` is set | Token the gateway authenticates to Access with. `GATEWAY_ACCESS_ALLOW_ANONYMOUS=true` replaces it when the service authenticates the gateway by other means. |
| One rate limit is on | At least one of `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_GLOBAL_MAX`, `GATEWAY_RATE_LIMIT_PRINCIPAL_MAX` and `GATEWAY_RATE_LIMIT_TOTAL_MAX` must be non-zero. `GATEWAY_ALLOW_NO_RATE_LIMITS=true` replaces them when another layer protects the deployment. |
| State is shared | `GATEWAY_SESSION_URL` and `GATEWAY_SHARED_STATE_URL` must name a Redis or Postgres server. A session in one replica's memory is unknown to the others, and a limit in one replica's memory limits only that replica. `GATEWAY_ALLOW_MEMORY_STATE=true` replaces them for a single-node deployment that accepts this. |

Startup also stops when an upstream client certificate is set without its key,
or the reverse (§11.1.2).

**A published value is not a secret.** In production the gateway refuses to
start when a credential is a value the repository publishes — the values of
`.env.min`, of the examples and of the fixtures — or one repeated character,
whatever its length is. The repository is public, and a deployment that keeps
one of its values holds a credential that everybody knows. The credentials the
rule covers are `GATEWAY_SESSION_SECRET`, `GATEWAY_ACCESS_TOKEN`,
`GATEWAY_OIDC_CLIENT_SECRET` and `GATEWAY_METRICS_TOKEN`.

**The strength of a secret.** A secret is at least 32 bytes, counted as it is
read: 64 hexadecimal characters, 44 base64 characters, or a passphrase of 32
characters. The rule is the rule of Access and of the console, and the three
services agree on what a strong secret is.

### 4.4 Control-plane environment

The control plane is a separate process with its own environment (§12.7):
`GATEWAY_CONTROL_HOST`, `GATEWAY_CONTROL_PORT`, `GATEWAY_CONTROL_TOKENS` or
`GATEWAY_CONTROL_TOKENS_FILE`, `GATEWAY_CONTROL_STATE_URL`,
`GATEWAY_CONTROL_KEY_PREFIX`, `GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX` and
`GATEWAY_PROTECTED_ROUTES`. It compiles the tables it validates with the same
deployment defaults as the gateway, so the table it accepts is the table the
gateway runs.

**A published token is not a token.** In production the control plane refuses
to start when the map of its tokens holds a token the repository publishes —
the map of the example, `deploy/config/control-tokens.example.json` — or a
token that carries the words `replace-this`. A deployment points
`GATEWAY_CONTROL_TOKENS_FILE` at its own map, and the map of the example is a
map of a development machine.

---

## 5. Authentication

### 5.1 Modes

A route's mode decides which credentials it accepts and the order they are
evaluated in. The order is fixed, so the request's shape never changes which
credential authenticates it.

| Mode | Credential |
| --- | --- |
| `none` | None. The request is forwarded unauthenticated. |
| `session` | The gateway's session cookie. The `Authorization` header is ignored. |
| `jwt` | The caller's bearer token. |
| `any` | Bearer token first, session cookie second. |

A credential that is present but invalid is **rejected**, not replaced by
another: a caller that sent a wrong token is not a session caller. In `any`
mode, an `Authorization` header that is not a bearer token is rejected.

### 5.2 Browser flow

1. `GET /auth/login?redirect=<path>`: the login limiter runs, then the gateway
   redirects to the provider with PKCE (`S256`), a `state` and a `nonce`. The
   redirect target is signed into the state cookie and is always a relative
   path, so a crafted parameter cannot make the login an open redirect.
2. The provider sends the browser back to `GET /auth/callback`.
3. The gateway verifies the state against the cookie, exchanges the code with
   the PKCE verifier, checks the nonce, and requires an ID token.
4. The session is created and the cookie is written.

Login state is single-use on four levels: the state cookie is deleted as soon
as the callback is processed; the callback's state must equal the cookie's;
the verifier and nonce bind the exchange to the login attempt; and the
provider accepts the authorization code only once.

When the provider cannot be reached, `/auth/login` answers `503
identity_provider_unavailable`. A callback that cannot be completed answers
`400 login_failed`, or `503 session_store_unavailable` when the session cannot
be stored. The state cookie is deleted whatever the outcome.

### 5.3 Sessions

A session is a server-side record. The browser holds an opaque ID of 32 random
bytes, so the gateway can revoke a session, expire it and re-read the caller's
roles.

| Bound | Default | Meaning |
| --- | --- | --- |
| Idle lifetime | `GATEWAY_SESSION_TTL_MS` (8 h) | How long an unused session survives. Refreshed on read, at most once per `GATEWAY_SESSION_TOUCH_INTERVAL_MS`. |
| Maximum age | `GATEWAY_SESSION_MAX_AGE_MS` (24 h) | How long a session may be used at all, from creation. `0` means no maximum. |

The maximum age is the real bound. The cookie's `Max-Age` is the smaller of the
remaining idle lifetime and the remaining maximum age, so the cookie never
outlives its session.

The store is in memory (`memory://local`) or on a Redis or Postgres server
shared by the replicas. A multi-replica deployment needs a shared server
(§4.3).

An unreachable store denies the caller. A store hiccup never lets anyone in.

**Revoking a subject's sessions.** All sessions of one subject can be revoked
at once without touching other callers. The gateway exposes no endpoint for
this (an administrative endpoint on the gateway is one an attacker can reach);
run the deployment script against the shared state instead:

```bash
bun run sessions -- --subject alice@example.test
```

The subject is the identity provider's `sub`. The script removes the sessions
and prints how many it removed. The control plane offers the same operation
(`DELETE /v1/sessions`, §12.7).

### 5.4 Bearer tokens

Bearer tokens are validated against the same provider: signature (via the
remote JWKS), issuer, audience and expiry. Accepted algorithms: `RS256`,
`ES256`, `RS384`, `RS512`, `ES384`, `PS256`. Clock tolerance: five seconds.

**Expiry is required.** The library checks expiry only when the token has
one, so a token without `exp` would pass signature, issuer and audience checks
and stay valid forever. Such a token cannot be revoked, so the gateway refuses
it.

**Lifetime is bounded** by `GATEWAY_OIDC_MAX_TOKEN_AGE_MS` (one day by default;
`0` turns the bound off). Lifetime is the time from issue to expiry; the bound
applies to the lifetime, not the remaining validity, so a long-lived token
does not become acceptable near its expiry. While the bound is on, a token
must carry its issue time (`iat`), since the lifetime cannot be computed
without it. Every provider publishes it; RFC 9068 makes it mandatory for access
tokens.

The bound turns removing a caller at the identity provider into a delay
**bounded by the deployment**: the removed caller's token works for at most
the bound, not for the lifetime the provider gave it. The browser flow is
bounded by the session's maximum age instead (§5.3).

**Access tokens only.** A bearer token must be an access token, not the
gateway's ID token. Many providers issue both for the same client and audience,
and an ID token travels through the browser (history, logs, referrers). Two
rules keep them apart:

- The gateway's browser flow always sends a nonce, so this client's ID token
  **always** has a `nonce` claim and an access token never does. A bearer token
  with a nonce is refused. On by default; set
  `GATEWAY_OIDC_REJECT_NONCE_TOKEN=false` for a provider whose access tokens
  carry a nonce anyway.
- If the provider publishes a token-type claim, name it in
  `GATEWAY_OIDC_REQUIRED_TOKEN_CLAIMS`; a bearer token without it is refused.

A token verified **against a nonce** is an ID token, not a bearer token, so the
nonce rule does not apply to it.

### 5.5 Cookies

| Cookie | Attributes |
| --- | --- |
| `gateway_session` | Session ID. `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`. |
| `gateway_oidc_state` | State of a login in flight. Same attributes. |

The names are not configurable. An upstream that could set the gateway's
cookie could fix a browser's session to an ID of its choice (§7.2).

---

## 6. Workspace access

For each request that needs a decision, the gateway calls Access
(protocol: §6.1):

```http
POST {GATEWAY_ACCESS_URL}/v1/decisions
Authorization: Bearer {GATEWAY_ACCESS_TOKEN}
Content-Type: application/json

{"subject":"user-1","workspaceId":"…","routeId":"workspace-api","roles":["dev"]}
```

The workspace is the platform's unit of access and what the service is asked
about. A route that names no workspace may still be checked; the service is
then asked about the route and the request carries no workspace (§6.3).

The answer is `{"allow": true}` or `{"allow": false, "reason": "…"}`. A
non-success status, a non-JSON body and a malformed decision all mean the
**service is unavailable**, not a denial: only an explicit `{"allow": false}`
denies a caller.

| Decision | Gateway response | Metric |
| --- | --- | --- |
| `{"allow": false}` | `403 workspace_forbidden` | `gateway_auth_failures_total{reason="access_denied"}` |
| Service could not be asked, or its answer could not be read | `503 access_unavailable` with `retry-after` | `gateway_access_unavailable_total` |

Both fail closed. They are kept distinct because a denial is platform policy,
the same for every caller, while an outage is an infrastructure failure the
caller may retry and the operator must be able to recognize. An outage that
answered `403` would look like policy; a policy that answered `503` would look
like an outage.

The service's `reason` is never sent to the caller.

**Cache.** Decisions are cached for `GATEWAY_ACCESS_CACHE_TTL_MS` (5 s). Only
**explicit** decisions are cached: caching a transport failure would keep
denying a caller the service would have allowed. The cache key is subject,
workspace, route and roles, so a decision for a caller with a role is never
served to a caller without it.

**In-flight calls are shared**: a burst of requests for the same decision asks
the service once. Without this, a burst arriving just as the short-lived cache
empties would ask the service once per request.

**Revocation latency equals the cache TTL**; lower it when revocations must
take effect faster. The outage grace (§6.2) is the other knob: how long the
last decision may be served while the service is down.

A route may set its own lifetime with `accessCacheTtlMs`, which replaces
`defaults.accessCacheTtlMs` and the environment value. `0` asks the service on
every request, making revocation on that route immediate. Routes usually share
one lifetime; a route serving a sensitive workspace may need its own.

### 6.1 Access protocol

Access is a deployment dependency, not part of the gateway; a
deployment may implement it in any language. The protocol is published so a
service can be written and checked against it.

Request (as shown in §6):

| Field | Required | Meaning |
| --- | --- | --- |
| `subject` | yes | Caller identifier. The service decides what it means. |
| `workspaceId` | no | Workspace the request is about. Absent when the route asks about itself and names no workspace (§6.3). |
| `routeId` | no | Route the request came in on. May be part of the service's policy. |
| `roles` | no | Caller's roles. Part of the cache key. |

Response: `200` with a boolean `allow`:

```json
{"allow": true}
{"allow": false, "reason": "the subject does not have the role of the workspace", "reasonCode": "missing_role"}
```

`reason` is free text and never reaches the caller. `reasonCode` is the
**machine-readable** denial reason, and it is what the gateway counts:

| Code | Meaning |
| --- | --- |
| `missing_role` | The caller lacks the role the policy requires. |
| `workspace_not_found` | The workspace does not exist. |
| `policy_denied` | The deployment's policy denies the caller. |
| `access_denied` | Not allowed, for a reason the service does not name. |

The code is **optional**. Without it, the denial is counted with the legacy
rule of §6.5 (the `1.0` behavior). With it, counting is exact, and rewording
`reason` does not change the gateway's metric.

| Status | Meaning |
| --- | --- |
| `200` | A decision. The body carries `allow`. |
| `400` | Malformed request: not JSON, or no subject. A service that requires a workspace refuses a request without one with this status. |
| `401` | Missing or wrong token. |
| `404` | Not the protocol's path. |
| anything else | Service unavailable: the gateway answers `503 access_unavailable`. |

A non-JSON body, or an `allow` that is not a boolean, also means unavailable.

**Conformance suite.** `test/support/access-conformance.ts` runs against any
implementation; a deployment that writes its own service runs it against that
service. It checks allow, deny, the denial reason, malformed requests, the
token, the path, and a request that names no workspace.

**Reference implementation.** `services/access-service.ts` implements the
protocol by applying a policy file, and a deployment may run it. It is not a
fixture: fixtures carry accounts with known passwords and refuse to run in
production, while this one carries the operator's policy. The test suite runs
the conformance suite against it, so the protocol and its reference do not
drift.

### 6.2 Outage grace

Access outage stops the deployment's traffic: every request on a
route that needs a decision gets `503 access_unavailable`.

A route may opt into a **grace**: `accessStaleGraceMs`
(`GATEWAY_ACCESS_STALE_GRACE_MS`, default `0`) is how long the service's last
decision may be served after it became unreachable.

| Service | Grace | Caller gets |
| --- | --- | --- |
| answers | any | The service's decision. |
| does not answer; last decision allows | above zero, decision within the grace | The last decision; the request proceeds. |
| does not answer; last decision denies | any | `503 access_unavailable`. |
| does not answer; no decision | any | `503 access_unavailable`. |
| does not answer; decision older than the grace | any | `503 access_unavailable`. |

Rules:

- The grace is **off by default**, so an outage stays visible.
- A stale decision is served only when it **allows**. Serving a stale denial
  would hide the outage from the operator, and the caller gets the same
  refusal from a gateway that fails closed anyway.
- The grace **delays revocation**: a revoked caller keeps access until the
  grace ends. Grace and cache lifetime together bound that delay.
- A decision requested **fresh** is never stale. Open-connection revalidation
  (§10) asks for a fresh decision, so a revoked connection is closed even when
  the service is down and the grace is large.

Stale decisions are counted in `gateway_access_stale_total{route}`; their age
is measured in `gateway_access_stale_age_seconds{route}`.

### 6.3 Routes without a workspace

A route that names a workspace is always checked. A route that names none is
not checked unless it sets `accessCheck`:

```jsonc
{
  "id": "admin-api",
  "match": { "host": "api.example.com", "path": "/admin" },
  "upstream": "http://admin:3000",
  "auth": { "mode": "session" },
  "accessCheck": true
}
```

The access request then carries subject, route and roles, and **no
workspace**; the service decides on those. This serves deployments without
workspaces.

- A check needs an authentication mode other than `none` (the service is asked
  about an authenticated caller). A route with `accessCheck` and mode `none`
  is refused at load time.
- Decisions for routes without a workspace have their own cache keys and are
  never served to a route that names one, or the reverse.
- The identity written upstream carries no workspace, and the identity
  signature is the request's (§7.4).

### 6.4 Access breaker

Access is on the path of every request to a route that names a
workspace. A down service makes requests **slow** as well as refused: each
waits out the call budget (`GATEWAY_ACCESS_TIMEOUT_MS`, 3 s by default), so
requests pile up and the outage amplifies itself.

The gateway therefore keeps a **breaker**. After
`GATEWAY_ACCESS_BREAKER_FAILURES` consecutive failures (default 5) the service
is not called for `GATEWAY_ACCESS_BREAKER_COOLDOWN_MS` (default 5 s). While
the breaker is open, requests get `503 access_unavailable` **immediately**: the
same answer as the outage, without the wait.

Why the breaker is safe on every request:

1. **It only refuses.** It never lets a caller in, so it cannot open a hole.
2. **The grace still applies.** A route with `accessStaleGraceMs` (§6.2) is
   served the last allowing decision while the breaker is open, which keeps
   traffic flowing during an outage.
3. **It is passive.** It learns from failures the gateway observes and never
   probes the service (a probe would need its own endpoint, timeout and
   interval). The cooldown is its only clock.

After the cooldown the breaker is **half-open**: one call is allowed and
decides whether the service is healthy. If it fails, the breaker reopens
immediately.

A denial is not a failure: the service answered. A `400` is not a failure
either: the service refused what the gateway sent, and a gateway bug must not
refuse every caller by opening the breaker.

Breaker state is **per process**, like the upstream breaker (§11.4): a failure
counter is not worth a round trip on every request. Each replica learns from
its own failures.

`GATEWAY_ACCESS_BREAKER_FAILURES=0` disables the breaker: the service is
called on every request, and each request waits the full call budget when the
service does not answer.

### 6.5 Denial reasons in metrics

Denials are counted in `gateway_auth_failures_total` with a bounded `reason`
label: `missing_role` when the caller lacks the role the policy requires,
`access_denied` for every other denial.

The service's `reason` is free text, which is not a machine-readable channel.
The gateway counts the `reasonCode` when the service sends one (§6.1) and never
parses the text.

A service that sends no code is counted with the **legacy rule** (the `1.0`
behavior): a reason that mentions a role counts as `missing_role`. The rule is
deprecated and kept so deployments written against `1.0` keep working
unchanged.

---

## 7. Header policy

### 7.1 Request → upstream

Removed in both directions, never configurable: `connection`, `keep-alive`,
`proxy-authenticate`, `proxy-authorization`, `te`, `trailer`,
`transfer-encoding`, `upgrade`, `host`, all `x-forwarded-*`, `x-real-ip`, the
standard `forwarded` header, and the identity headers `x-gateway-user`,
`x-gateway-user-id`, `x-gateway-email`, `x-gateway-roles`,
`x-gateway-workspace`, `x-gateway-workspace-id`, `x-gateway-internal`,
`x-gateway-authenticated`, `x-gateway-signature`, `x-forwarded-user`,
`x-forwarded-email`, `x-forwarded-groups`, `x-remote-user`, `x-remote-email`.
Every header named by `Connection` is removed as well.

**`Authorization`** is **not** forwarded by default. It is a credential of the
caller, and forwarding it puts the upstream in that credential's trust domain: a
compromised upstream would hold a credential it may replay. The default is
therefore `forwardAuthorization: false`, and a route whose upstream really needs
the credential asks for it by name (`forwardAuthorization: true`). Either way,
the caller's identity reaches the upstream in the headers below and the
signature.

**`Cookie`** is rewritten: the gateway's cookies (`gateway_session`,
`gateway_oidc_state`) are removed and application cookies are kept. Cookies are
parsed per RFC 6265 by a standard library: a pair without a name is dropped, a
cookie whose name contains a control character is dropped, and control
characters are removed from values. What the gateway reads is what it
forwards.

Written by the gateway:

| Header | Value |
| --- | --- |
| `traceparent` | Trace context (§7.5). |
| `x-forwarded-for` | The chain, client first, the gateway's peer last. |
| `x-forwarded-proto` | `http` or `https` (the effective protocol). |
| `x-forwarded-host` | The host the caller used. |
| `x-real-ip` | The caller's address. |
| `x-gateway-user` | The caller's subject. |
| `x-gateway-email` | The caller's email, when known. |
| `x-gateway-roles` | Roles, comma-separated, ambiguous roles dropped. |
| `x-gateway-workspace` | The workspace, when the route has one. |
| `x-gateway-signature` | Identity signature (§7.4). |

Email and workspace are stripped of control characters and truncated to 512
characters.

**The subject is never rewritten.** A subject that is empty, contains a
control character or is longer than 512 characters cannot be written to a
header, so the request fails with `500 internal_error` and the upstream never
receives an identity it cannot trust. Rewriting the subject could merge two
callers: Access would decide on one subject while the upstream
read another.

### 7.2 Upstream → client

Removed: hop-by-hop headers, the §7.1 identity headers, `x-forwarded-*`,
`x-real-ip`, and every `Set-Cookie` that sets a gateway cookie, so an upstream
cannot fix a browser's session to an ID of its choice.

A `Location` that names the upstream itself is made relative, so the internal
hostname never reaches the browser. A `Location` naming another host is left
alone.

### 7.3 Forwarding headers and client address

Forwarding headers are honored **only** when the immediate peer is in
`trustedProxies` (the configuration file, or `GATEWAY_TRUSTED_PROXIES` when
set; the environment replaces the file's ranges, it does not add to them).
Otherwise they are ignored and the peer address is the client address.

**`x-forwarded-for` is read from the right.** Each trusted proxy appends the
address it saw, so the chain ends with one entry per proxy, and anything a
client injected sits to the left of those. `GATEWAY_TRUSTED_PROXY_HOPS`
(default 1) is the number of proxies; the caller's address is the entry that
many positions from the right.

The caller's address is therefore **never an entry a client chose**. The
trusted ranges only decide whether the peer is a proxy, so even a caller whose
own address is inside a trusted range cannot pick the address the gateway
attributes to it, and with it the rate-limiter key. Reading the left-most
entry instead would let a client choose both.

A chain shorter than the number of proxies is not trusted: the peer address is
used. The chain forwarded upstream starts at the caller and ends at the
gateway's peer.

`x-forwarded-proto` is honored only from a trusted proxy and only when it is
`http` or `https`; otherwise the configured protocol is used.

`x-forwarded-host` is honored only from a trusted proxy and only when it is a
plausible host (no whitespace, control character or path). The **last** value
in the list is used, because an appending proxy writes its own value last. A
value that is not a host is ignored.

The effective host decides the route, the origin compared with the browser's,
and the value the signature covers. Behind an ingress that rewrites `Host`, the
ingress must report the public host in `x-forwarded-host`.

### 7.4 Identity signature

**Key.** Signatures use the deployment's private key,
`GATEWAY_IDENTITY_SIGNING_KEY`: an elliptic-curve key on P-256, signing with
`ES256`. Upstreams get the **public** key, so they can verify an identity but
cannot mint one; the trust boundary is the key, not the network.

The key belongs to the deployment and must be the same on every replica, or
upstreams refuse the other replicas' signatures. `bun run identity:key`
generates a pair; `bun run identity:key --public` prints the public key of the
key in the environment.

**Without a key.** A deployment that does not set it (a non-production one)
signs with a key **generated per process**. The signature format is the same,
but upstreams do not know the public key and cannot verify, and the key is
neither shared across replicas nor kept across restarts. The gateway logs a
warning when it signs this way.

Production **refuses to start** without `GATEWAY_IDENTITY_SIGNING_KEY`: a
deployment whose upstreams cannot verify identities only believes it is
protected.

If `GATEWAY_SESSION_SECRET` is unset, a random secret is generated **per
process**, so login state is not valid across replicas or restarts. Production
refuses to start without it. The secret is never sent upstream.

**Format.** A **JWS** (RFC 7515) with a detached payload. Protected header:

```json
{ "alg": "ES256", "typ": "gateway-identity" }
```

**Payload.** The payload is **detached** (not transmitted). The upstream
rebuilds it from the request and the identity headers, so a signature that
does not belong to the request fails verification itself rather than a
comparison that could be written wrong.

The payload is a canonical JSON **object**, so no value can move into or be
confused with another field:

```json
{"v":"v5","method":"GET","path":"/base/ws/123","query":"?x=1","host":"api.example.com","subject":"user-1","workspaceId":"…","email":"…","roles":["admin","dev"]}
```

| Field | Value |
| --- | --- |
| `v` | Format version: `v5`. |
| `method` | Method, uppercase. |
| `path` | Path **as the upstream received it**: the upstream base path followed by the request path (or the rewritten path, §11.1.1). |
| `query` | Query string as the upstream received it, with its leading `?`. Empty string when there is none. |
| `host` | Effective host (§7.3), lowercase. |
| `subject` | Subject, unchanged (§7.1). |
| `workspaceId` | Workspace, sanitized. Empty string when there is none. |
| `email` | Email, sanitized. Empty string when unknown. |
| `roles` | Roles, sorted ascending (order carries no meaning). |

Fields are written in this order and roles are sorted, so every replica and
upstream rebuilds the payload byte for byte.

The signature covers exactly the header values: the **unchanged** subject,
the **sanitized** email and workspace, and the **filtered** roles. A role
containing a comma or control character is dropped because it would make the
comma-separated `x-gateway-roles` ambiguous. Roles sent to Access
are not filtered. A subject that cannot be written to a header fails the
request with `500` (§7.1).

**Value.** `v5=<detached compact JWS>`. The version is part of the value so the
format can change without breaking verification; a signature of any other
version is refused as unknown.

**Upstream verification.** The upstream:

1. reads `x-gateway-signature` and its version prefix;
2. refuses an unknown version, and **binds** the version to an algorithm and
   key: `v5` is `ES256` with the deployment's public key. There is no other
   version and no algorithm fallback;
3. splits the value into protected header, **empty** payload and signature,
   refusing a value that is not a compact serialization or whose payload is
   not detached;
4. checks that the protected header names the version's algorithm and type
   `gateway-identity`;
5. rebuilds the payload from the request and identity headers;
6. rebuilds the compact serialization around its own payload:
   `<protected>.<base64url(payload)>.<signature>`;
7. verifies it with the deployment's public key.

The last step is one standard library call:
`jose.compactVerify(token, key, { algorithms: ['ES256'] })`. An upstream
verifies a JWS; it does not implement a gateway-specific signature. Reference
implementation:
[examples/upstream-identity/verify.ts](../../packages/gateway/examples/upstream-identity/verify.ts).
Guide: [upstream-identity.md](upstream-identity.md).

**Test vector** (pinned in `src/domains/forwarding/identity-signature.test.ts`):

```text
key     = the private key of the deployment, an EC key on the curve P-256
claims  = { subject: "user-1", email: "user@example.com",
            roles: ["admin","dev"],
            workspaceId: "11111111-1111-4111-8111-111111111111" }
request = { method: "GET", path: "/base/ws/123", query: "?x=1",
            host: "api.example.com" }
payload = {"v":"v5","method":"GET","path":"/base/ws/123","query":"?x=1",
           "host":"api.example.com","subject":"user-1",
           "workspaceId":"11111111-1111-4111-8111-111111111111",
           "email":"user@example.com","roles":["admin","dev"]}
header  = {"alg":"ES256","typ":"gateway-identity"}
value   = v5=eyJhbGciOiJFUzI1NiIsInR5cCI6ImdhdGV3YXktaWRlbnRpdHkifQ..<the signature>
```

The payload and protected header are pinned. The **signature is not**: `ES256`
signatures of the same request differ every time. The test proves that the
signature verifies with the deployment's public key and that another request's
payload does not.

**Earlier formats.**

| Version | Format | Status |
| --- | --- | --- |
| `v3` | Hex digest of a canonical JSON **array**. | Upstreams must be changed to rebuild the payload as an object and verify the JWS. |
| `v4` | Signed with a symmetric key every upstream held, so any upstream that could verify an identity could also mint one. It existed for the development stack and unmigrated deployments. | **Removed** in `1.0`. An upstream refuses a `v4` signature like any unknown version. |

The gateway writes `v5` only; it is the only format a deployment implements.
An upstream that verified `v3` or `v4` must be changed before the gateway signs
`v5`: it reads the value's version and verifies with the deployment's public
key. Changing the format changes the contract with the upstreams.

### 7.5 Trace context

The gateway sends a W3C `traceparent` header upstream, tying the caller's
request to the upstream's response.

| Caller sent | Upstream receives |
| --- | --- |
| `00-<trace>-<span>-01` | `00-<trace>-<gateway span>-01`: the caller's trace ID with the gateway's span. |
| A malformed header | `00-<new trace>-<gateway span>-01`. |
| Nothing | `00-<new trace>-<gateway span>-01`. |

- The caller's header is **never forwarded unchanged**: the gateway writes its
  own context, so the upstream always gets a well-formed one and a client's
  broken header cannot confuse the upstream's collector.
- The gateway's span is new; the upstream's span is its child, and the
  caller's trace continues.
- The caller's flags are kept.
- The trace ID is logged next to the request ID, so both halves of a request
  are found with one search.

The gateway does not export spans; it writes the context and logs the trace
ID. A deployment that collects upstream traces sees the gateway as the parent
of the upstream span.

---

## 8. Cross-site requests

A caller that authenticates with a session cookie is a browser, and another
site can make a browser send requests to the gateway.

- `Sec-Fetch-Site` says where the request comes from. A cross-site request
  that changes upstream state is refused.
- `Origin` names the requesting origin. For state-changing methods, an origin
  that is not allowed is refused.

State-changing methods: `POST`, `PUT`, `PATCH`, `DELETE`.

A request with neither header comes from a non-browser client and is allowed;
a server-to-server call is not a cross-site request.

A cross-site **navigation** (a link in an email, a search result) is allowed by
default, because refusing it breaks every deep link into an application.
`GATEWAY_CSRF_STRICT=true` refuses it too; use it when upstreams never change
state on `GET`.

Per route, `crossSite: "strict"` refuses cross-site navigations for a route
whose upstream changes state on `GET`, so it can be reached only from the site
itself. `crossSite: "navigation"` keeps navigations allowed on a route even in
a strict deployment. Routes without a setting follow the deployment policy.

Allowed origins: the gateway's own origin and those in
`GATEWAY_ALLOWED_ORIGINS`. The gateway's origin is computed from the
**effective host** (§7.3) and the effective protocol.

The guard applies to every request that carries the gateway's session cookie,
whatever credential authenticated it.

`GET /auth/logout` is refused from another site, whatever the method.

---

## 9. Limits

Sliding-window counters:

| Scope | Key | Setting |
| --- | --- | --- |
| Deployment | `deployment:total` | `GATEWAY_RATE_LIMIT_TOTAL_MAX` |
| Caller across all routes | `caller:<ip>` | `GATEWAY_RATE_LIMIT_GLOBAL_MAX` |
| Caller on one route | `route:<id>:<ip>` | `GATEWAY_RATE_LIMIT_MAX` |
| Authenticated caller on one route | `principal:<id>:<subject>` | `GATEWAY_RATE_LIMIT_PRINCIPAL_MAX` |
| Requests that match no route | `none:<ip>` | `GATEWAY_RATE_LIMIT_MAX` |
| Login attempts | `<ip>` | `GATEWAY_LOGIN_RATE_LIMIT_MAX` |

A limit of `0` disables that limiter.

Why two of the scopes exist:

- Address-keyed scopes cannot bound a flood spread over many addresses.
  `deployment:total` has no address, so every request of the deployment counts
  in one window.
- Address-keyed scopes cannot tell apart tenants behind one address.
  `principal` is keyed by subject, so one tenant cannot spend another's budget.

**The three budgets of §2.3 step 6 are checked together.** They are
independent windows and none changes another's answer, but checking them
together asks the shared state **once** instead of three times. That round trip
is on every request; [internals.md](internals.md#shared-state-backends) attributes the shared state's
cost to the number of round trips.

The reported refusal is the first in table order: deployment, then caller
across routes, then caller on the route. **Every budget is still counted** when
one refuses, because the request was made.

**Window.** The window **slides**: a caller's count is its requests in the last
`windowMs` milliseconds, not since the last clock boundary. A fixed window
would let a caller spend its whole budget at the end of one window and again
at the start of the next, crossing at twice the limit.

The window is split into buckets of `bucketMs` milliseconds and its count is
the sum of the buckets inside it:

- a window holds at most 60 buckets, so a caller's state does not grow with
  its traffic;
- bucket boundaries are computable by every replica, so replicas count in the
  same buckets and the deployment's limit is the configured limit.

The count is exact to the bucket: a request stays counted until its bucket
leaves the window.

A request over the limit is **not counted**, so a client that keeps hammering
does not push its window further out. The refusal's `retry-after` is the time
until the oldest requests leave the window, i.e. when the count drops below
the limit again.

The refusal is `429 too_many_requests` with `retry-after`, counted in
`gateway_rate_limited_total`.

**Shared state unreachable.** While the shared-state server is down, its
windows cannot be read. `GATEWAY_RATE_LIMIT_FALLBACK` decides what happens:

| Mode | Behavior while the shared state is unreachable |
| --- | --- |
| `local` | The request is counted in a **per-process** window. A flood is bounded by the number of replicas instead of unbounded. |
| `open` | Every request is allowed (the behavior of releases before the fallback existed). |
| `closed` | Every request is refused, with `retry-after`. |

`local` is the default. The per-process window uses the configured window, so a
replica enforces the deployment budget for the callers it sees. Because it does
not see other replicas' counts, a caller's budget is spent slightly faster; the
error is on the safe side (the caller is refused a little early).

The degradation is **visible**: it is counted in
`gateway_rate_limit_fallback_total` and logged, so an operator sees that the
running limits are not the configured ones.

The in-process limiter holds at most 10 000 keys. A key leaves the table only
when its window ends, never to make room: evicting a live window would hand
that caller a fresh budget, letting a caller that sprays addresses reset its
own counter at will. When the table is full, requests that do not fit are
counted in one shared window, so the flood is bounded by the same limit.

---

## 10. WebSockets

A route must set `websocket: true`; otherwise an upgrade gets `400
websocket_not_allowed`.

The gateway performs its own handshake with the upstream (with the identity
headers and signature) **before** answering the client, so the client learns
the outcome and the subprotocol the upstream selected. The client's handshake
headers are not forwarded.

**The handshake follows the §7.1 header policy.** It is a request to the
upstream: gateway cookies never reach it, the gateway writes the caller's
identity, and the caller's `Authorization` header is forwarded only when the
route allows it (`forwardAuthorization`).

**Handshake origin.** A handshake is a `GET`, so the §8 guard lets it through.
But a WebSocket opens a long-lived bidirectional connection that another site's
page could use to talk to the gateway. Browsers always send the page origin in
a handshake, so **a handshake that carries the gateway's session cookie must
name an allowed origin**:

- foreign origin → `403 cross_site_request`;
- no origin → `403 cross_site_request`;
- a client that does not use the session cookie (an API client with a bearer
  token) is not a browser and is not asked for an origin.

The check runs before the upstream connection opens, and `GATEWAY_CSRF_STRICT`
does **not** relax it.

**Revalidating open connections.** A connection is authorized when opened, but
over hours its session may expire, its access may be revoked, or its route may
change. Every `GATEWAY_WS_REVALIDATE_INTERVAL_MS` (60 s) the gateway checks
the following and closes the connection with code `1008` (policy violation) if
any fails:

1. the **route** still exists and still accepts WebSockets;
2. the **session** still exists, if the connection was opened with one;
3. Access still allows the workspace, asked fresh rather than
   from the cache. A route without a workspace that asks Access
   about itself is asked again too, and the decision is never stale (§6.2).

A revalidation that cannot be performed closes the connection: the gateway
must not keep a connection it cannot vouch for. `0` disables revalidation.

**Jittered schedule.** Each connection's first check falls somewhere inside
the interval, and its period is drawn from a band of forty percent around the
interval. A fixed interval would make connections opened together revalidate
at the same instant, and because revalidation bypasses the cache (§6.2), the
burst would hit Access directly.

**Guards.**

| Setting | Effect |
| --- | --- |
| `GATEWAY_WS_MAX_CONNECTIONS` | Maximum open connections; beyond it `503 too_many_connections`. |
| `GATEWAY_WS_MAX_PAYLOAD_BYTES` | Larger messages are refused. |
| `GATEWAY_WS_MAX_BUFFERED_BYTES`, `GATEWAY_WS_MAX_BUFFERED_MESSAGES` | Bound the outbound buffer. |
| `GATEWAY_WS_BACKPRESSURE_LIMIT_BYTES` | A client that does not read is closed at this backlog. |
| `GATEWAY_WS_PING_INTERVAL_MS` | Keepalive ping interval. |
| `GATEWAY_WS_PONG_TIMEOUT_MS` | A connection that does not answer a ping within this is closed. |
| `GATEWAY_WS_IDLE_TIMEOUT_SECONDS` | An idle connection is closed after this. |
| `GATEWAY_WS_HANDSHAKE_TIMEOUT_MS` | Budget of the upstream handshake. |

---

## 11. Proxying

### 11.1 Upstream URL

The upstream URL is built from the route's base URL and the request:

1. Take the upstream's **base path**, trailing slashes removed.
2. Append the **request path** (it always starts with `/`).
3. Use the **request's query string**. The upstream URL's own query string is
   not used (§3.1).
4. Never forward the **fragment**.

```text
upstream http://app:3000        + /ws/123?x=1  →  http://app:3000/ws/123?x=1
upstream http://app:3000/base/  + /ws/123?x=1  →  http://app:3000/base/ws/123?x=1
upstream http://app:3000/base   + /ws/123      →  http://app:3000/base/ws/123
```

The path is forwarded unchanged (the matched prefix is not stripped) unless
the route declares a **rewrite**.

### 11.1.1 Path rewrite

A route may declare the path its upstream receives:

```jsonc
{
  "id": "workspace-api",
  "match": { "host": "api.example.com", "path": "/ws/{workspaceId}/" },
  "upstream": "http://upstream:3000",
  "rewrite": "/v1/workspaces/{workspaceId}/{rest}"
}
```

| Rewrite | Path the upstream receives |
| --- | --- |
| none | The request path: `/ws/123/assets`. |
| `/{rest}` | `/assets`: the route prefix is removed. |
| `/v1/workspaces/{workspaceId}/{rest}` | `/v1/workspaces/123/assets`. |
| `/v1/fixed` | `/v1/fixed`: the rest of the path is **not** forwarded. |

- A rewrite placeholder must be a placeholder of the **route path**; naming one
  the path lacks is a configuration error.
- `{rest}` is the path after the matched prefix, and may only be the last
  segment of the rewrite.
- A rewrite **without** `{rest}` drops the rest of the path.
- Values are the caller's, with the path encoding untouched: an encoded
  character reaches the upstream as sent.
- The query string is not part of the rewrite and is forwarded unchanged.
- The identity signature covers the path **as the upstream receives it**
  (§7.4), so a rewritten path is signed.

The WebSocket URL is built the same way, with `http` → `ws` and `https` →
`wss`. WebSocket upstreams must use plain HTTP: a `wss` upstream is refused
(§11.1.2).

### 11.1.2 Upstream TLS

An `https` upstream is reached over TLS. The gateway verifies the upstream
certificate against the deployment's CA (`GATEWAY_UPSTREAM_TLS_CA`) and
presents the deployment's client certificate (`GATEWAY_UPSTREAM_TLS_CERT` and
`GATEWAY_UPSTREAM_TLS_KEY`) when the upstream asks for one. Certificate and key
go together: setting one without the other is refused at startup.

An upstream that rejects the certificate refuses the connection; the gateway
answers `502 bad_gateway` and logs the reason.

**WebSocket upstreams use plain HTTP.** The runtime's WebSocket client cannot
speak TLS (measurements: [internals.md](internals.md#runtime)), so a handshake with a
`wss` upstream is refused with reason `tls` instead of failing with an error
that hides the cause. Workaround: a proxy in front of the upstream that speaks
`wss` and forwards `ws`.

### 11.2 Phases and budgets

Bodies are streamed in both directions, so server-sent events and large
uploads work. Each phase has its own budget, merged field by field from
`defaults.timeouts` and the route's `timeouts`:

| Phase | Budget | Default (ms) | Covers | Kind |
| --- | --- | --- | --- | --- |
| upload | `bodyMs` | 300 000 | Time between two request body chunks. | **idle** |
| response | `responseMs` | 5 000 | From the end of the upload to the response headers. | **total** |
| first byte | `firstByteMs` | 30 000 | From the response headers to the first body byte. | **total** |
| body | `bodyMs` | 300 000 | Time between two response body chunks. | **idle** |

An **idle** budget resets on every chunk, so a slow upload or an upstream
streaming server-sent events for hours is not cut off while it makes progress.

**The upload is not part of the response budget.** `responseMs` starts once the
request is fully sent, so a short response budget never defeats a slow upload.
Likewise `firstByteMs` starts when the response headers arrive.

**A response that cannot have a body has no first byte.** `firstByteMs` is not
armed for a `HEAD` response or for **final** responses without a body (`204`,
`205`, `304`). Two statuses are handled differently:

- **`103 Early Hints`** is interim. The gateway waits for the final response
  and forwards only that. If the upstream closes without final headers, the
  exchange fails with `502 bad_gateway`.
- **`101 Switching Protocols`** belongs to the WebSocket upgrade. The HTTP path
  refuses it (`502`).

Body limit: `route.maxBodyBytes` → `defaults.maxBodyBytes` →
`GATEWAY_MAX_BODY_BYTES`; `0` disables it. A body over the limit gets `413
payload_too_large`, whether `content-length` already exceeds it or it is
discovered while streaming.

**Concurrent exchanges** are bounded by `GATEWAY_MAX_CONCURRENT_REQUESTS`
(default 1 000; `0` disables). A client that opens a request and never sends
its body holds a connection until the upload idle budget expires; this cap
bounds that. An exchange that does not fit gets `503 gateway_overloaded`.

The cap covers only the **exchange**. Requests waiting on a dependency (such as
an access decision) never reach it; admission (§2.4) bounds those separately.

### 11.3 Failures and what the caller sees

**Before response headers are sent**, the gateway can still answer with its own
error:

| Failure | Status | Body |
| --- | --- | --- |
| Upstream did not answer in time (`responseMs`) | `504 gateway_timeout` | JSON |
| Request body over the limit before the upstream answered | `413 payload_too_large` | JSON |
| Caller went away | `499` | empty |
| Upstream unreachable | `502 bad_gateway` | JSON |
| Too many concurrent exchanges | `503 gateway_overloaded` | JSON |

**After response headers are sent**, the status line is fixed. A failure while
the body streams **ends the response body**: the client sees a truncated stream
and a closed connection. This includes `firstByteMs`: the headers were already
received, so a timeout before the first byte ends the stream rather than
producing a `504`.

**An upstream may answer before reading the whole request.** The gateway does
not assume an unfinished upload means nothing was sent:

- If the body limit is reached **before** the upstream's response arrives, the
  gateway aborts the exchange and answers `413`.
- If the upstream's response arrived **first**, the caller gets it. The rest of
  the upload is dropped and the response body may be truncated.

The recorded status is the upstream's, because that is what the client
received; the outcome is recorded separately as `aborted`. When the caller
disconnects, the upstream request is cancelled, so the upstream does not keep
working for a client that left.

### 11.4 Multiple upstreams

A route may name one upstream or several:

```jsonc
{
  "id": "workspace-api",
  "upstream": ["http://upstream-a:3000", "http://upstream-b:3000"]
}
```

Upstreams are tried in list order. The next one is tried when the
**connection** to the current one fails, and only if the request may be resent:

| Request | Retried on the next upstream |
| --- | --- |
| `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT` or `DELETE` without a body | Yes. |
| Any other method | No: it may change upstream state. The body is streamed and the request goes to one upstream. |
| Body too large to hold in memory | No: the bytes are already on their way to the first upstream. |
| Body that fits in `replayMaxBytes` | Yes: the body is held in memory and resent. |

The response budget covers the **whole** exchange: all attempts share it, so a
list of upstreams does not lengthen the route's timeout.

**Attempt budget.** An attempt with another upstream behind it is abandoned if
it does not answer within `upstreamAttemptMs`
(`GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS`, default 2 s), and the next upstream is
tried. Otherwise an upstream that accepts the connection but never answers
would consume the route's whole budget and the others would never be reached.
The attempt budget applies only to resendable requests; a state-changing
request is never sent to two upstreams. The last upstream has no successor,
so the response budget governs it.

**Replayable bodies.** A body is held in memory when its declared length fits
in `replayMaxBytes` (`GATEWAY_REPLAY_MAX_BYTES`, default 64 KiB), so it can be
sent to a second upstream. A larger body is streamed and the request is sent
once.

A body is held in memory only when the route names **several** upstreams **and**
the request may be resent. Otherwise holding it gains nothing and delays
reaching the upstream until the whole body arrives, losing the upstream's early
response (§11.2). So a `POST` to a multi-upstream route, and any request to a
single-upstream route, is streamed.

Worst-case memory: `GATEWAY_MAX_CONCURRENT_REQUESTS` ×
`GATEWAY_REPLAY_MAX_BYTES`.

**Upstream health.** Failover alone only helps resendable requests, so the
traffic that matters most (an API `POST`) would have none: if the first
upstream accepted the connection and never answered, the request would burn the
route's whole budget. The gateway therefore remembers upstreams that failed
recently and **moves them to the end of the list**, so the route's next request
goes to an upstream that answered recently:

- The breaker is **passive**: it learns from failures the gateway observes (a
  refused connection, an attempt that ran out of budget) and never probes an
  upstream, which would require the deployment to define "healthy".
- Upstreams not skipped come first, in list order, followed by skipped ones,
  also in list order. File order is upstream order.
- An upstream is skipped after `GATEWAY_UPSTREAM_BREAKER_FAILURES` consecutive
  failures (default 3) for `GATEWAY_UPSTREAM_BREAKER_COOLDOWN_MS` (default
  30 s). It is never removed, and is tried again when the cooldown ends, even
  if it failed in the meantime.
- `GATEWAY_UPSTREAM_BREAKER_FAILURES=0` disables the breaker; the order is
  always the file order.
- State is **per process**. Each replica learns from its own traffic; a replica
  that did not see the failure keeps sending to the down upstream and pays the
  route's budget, as before the breaker existed.
- A request still goes to **one** upstream: the breaker chooses which, and never
  sends a request twice.

Failures are published in `gateway_upstream_failures_total`; requests sent to
another upstream in `gateway_upstreams_skipped_total`.

A WebSocket handshake goes to the **first** upstream of the route: a handshake
is not sent twice.

---

## 12. Operations

### 12.1 Health, readiness and metrics

- `GET /healthz` → `200 {"status":"ok",…}`. Always available.
- `GET /readyz` → `200` when a configuration is loaded and the session store
  answers, `503` otherwise. The body reports both.
- `GET /metrics` → `200` with Prometheus text when the bearer token matches,
  `404` when `GATEWAY_METRICS_TOKEN` is unset, `401` when the token does not
  match.

| Metric | Labels | Meaning |
| --- | --- | --- |
| `gateway_requests_total` | `route`, `method`, `status` | Every request the gateway answered, refusals included. |
| `gateway_request_errors_total` | `route` | Responses with a 5xx status. |
| `gateway_auth_failures_total` | `route`, `reason` | Rejected callers. |
| `gateway_access_unavailable_total` | `route` | Requests refused because Access could not be reached. |
| `gateway_access_stale_total` | `route` | Decisions served while Access was unreachable (§6.2). |
| `gateway_access_stale_age_seconds` | `route` | Age of decisions served while Access was unreachable. |
| `gateway_cross_site_refusals_total` | `route` | Requests refused as cross-site. |
| `gateway_websocket_connections_total` | `route` | Accepted upgrades. |
| `gateway_websocket_refusals_total` | `reason` | Refused handshakes. |
| `gateway_request_duration_seconds` | `route` | Exchange latency. |
| `gateway_upstream_duration_seconds` | `route` | Upstream latency: from the request leaving the gateway to the final response headers. |
| `gateway_upstream_failures_total` | — | Upstream failures: a refused connection, an attempt that ran out of time. |
| `gateway_upstreams_skipped_total` | — | Times an upstream was moved to the end of the list after failing recently (§11.4). |
| `gateway_access_duration_seconds` | `route` | Latency of calls that reached Access (cache hits are not counted). |
| `gateway_bytes_in_total`, `gateway_bytes_out_total` | — | Bytes actually transferred. |
| `gateway_active_requests` | — | Requests in flight. |
| `gateway_config_reloads_total` | `result` | Configuration reloads. |
| `gateway_rate_limited_total` | — | Requests refused by the limiter. |
| `gateway_rate_limit_fallback_total` | `scope` | Requests counted in-process because the shared-state windows could not be read (§9). |
| `gateway_shared_state_errors_total` | — | Times the shared state was unreachable. |

**Labels are bounded**, so the number of series cannot grow without limit:

- `route`: the route ID, `unmatched` for requests that matched no route, or
  `overflow` beyond 500 routes.
- `method`: the uppercase method, or `other` if untracked. Tracked: `GET`,
  `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `TRACE`, `PROPFIND`,
  `PROPPATCH`, `MKCOL`, `COPY`, `MOVE`, `LOCK`, `UNLOCK`, `REPORT`, `SEARCH`.
  The client chooses the method, so it must not be able to create a series per
  method.
- `status`: the status, or `other` if untracked. Tracked: the statuses of the
  HTTP specification, the ones the gateway generates itself (`499`, `503`) and
  the two an operator looks for. The upstream chooses the status, so it must not
  be able to create a series per status.

### 12.2 Logs

JSON (pino). `Authorization`, `Cookie`, `Set-Cookie`, `x-api-key` and the query
parameters `access_token`, `code`, `code_verifier`, `id_token`,
`refresh_token` (and similar) are redacted before anything is written. Every
request or connection log line carries its request ID.

A request log carries the **caller** and the **workspace**: the gateway decides
who reaches what, so its logs must answer "who used this workspace". The
subject is the caller's identifier at the identity provider, not a credential,
and is not redacted.

Credentials in URLs are removed too: an upstream configured with a password in
its URL does not leak it to the log.

**Running policy.** Once per configuration generation, the gateway logs one
line for the configuration, one line per route (host, path, methods,
upstreams, accepted credential, workspace checked, cross-site policy, whether
the caller's credential reaches the upstream, budgets) and one **warning** per
permissive setting:

| Warning | Meaning |
| --- | --- |
| `unauthenticated_route` | The route forwards unauthenticated callers. |
| `no_workspace_check` | The route authenticates the caller but never asks Access. |
| `authorization_forwarded` | The caller's credential reaches the route's upstream. |
| `cross_site_allowed` | The route accepts cross-site navigations while accepting a session. |
| `unbounded_body` | The route accepts a body of any size. |
| `limited_failover` | The route names several upstreams, but failover is limited to requests that may be sent twice. |

Warnings are not errors, and a deployment may want these settings. They flag
settings nobody may have reviewed; an explicit warning beats a silent default.

### 12.3 Reload and readiness

The configuration file is watched. A reload is atomic: the new file is parsed,
validated and checked for ambiguity **before** it replaces the running one.

**A failed reload does not make the gateway unready.** The last valid
configuration stays active and keeps serving. The failure is reported in the
`/readyz` body (`config.lastError`), in the log and in
`gateway_config_reloads_total{result="failed"}`.

`/readyz` answers `503` only when no configuration has ever been loaded or the
session store is unreachable.

### 12.4 Shutdown

On `SIGTERM` or `SIGINT` the listener stops accepting, the readiness probe
answers `503` with body `draining`, open connections drain for
`GATEWAY_SHUTDOWN_TIMEOUT_MS` (15 s), and the process exits. At the deadline,
WebSocket connections are closed with code 1001 and running exchanges are
cancelled.

### 12.5 Shared state

Sessions, limits and cached decisions live on a Redis or Postgres server shared
by the replicas. The URL scheme selects the backend; both hold the same three
things.

**Postgres version is not checked.** The gateway is built, tested and released
against **PostgreSQL 18** (CI and the development script run it). Its SQL is
portable, so an older server keeps working; the gateway neither reads nor
refuses the server version.

**Clients.** Redis uses the `redis` package, so the shared state is not tied to
the gateway's runtime and one implementation covers every managed cache.
Postgres uses the `pg` package with a bounded connection pool.

**The command queue is disabled.** A command sent before the connection is
established fails immediately instead of waiting in a queue nobody drains: the
gateway denies callers while the store is down rather than piling up requests.
Commands that failed because the connection was not established are retried a
few times.

**The connection is established in the background.** A gateway started while
the shared state is down stays up: it answers `503` to readiness, denies
callers that need a session, and becomes ready when the server answers. The
failure is logged once per outage, and the recovery is logged too.

**The client is closed at the end of the drain**, with a bounded wait, so a
client still trying to reach a missing server does not hold up shutdown.

#### 12.5.1 Atomicity

Each shared-state operation must be **one** server operation, so two replicas
counting the same request at the same time do not count it twice:

| Operation | Redis | Postgres |
| --- | --- | --- |
| Read a session and refresh its expiry | `TOUCH_SCRIPT` | function `gateway.session_touch` |
| Count a request in a caller's window | `WINDOW_SCRIPT` | function `gateway.rate_limit_check` |
| Read or write a cached decision | one command | one command |

A Postgres function call is a server transaction, the equivalent of a Redis
script. Replica counters are exact: checks on one key are serialized with an
advisory lock, and the counting function refuses to count a request twice.

In Postgres, expiry is a column, not a disappearing key: expired rows are
removed by a sweep, and the server never serves them regardless of the sweep.

**The server does not wait for the disk**
(`GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT=off`, the default): the shared state is a
protection, not a ledger, and the guarantee matches Redis without its
append-only file.

### 12.6 Backend comparison

The two backends are interchangeable and measured side by side in
[internals.md](internals.md#shared-state-backends).

| | Redis | Postgres |
| --- | --- | --- |
| Shared-state cost | About a tenth of baseline throughput on the limiter path, about a third on the full request path | About half of baseline throughput on both paths, with a p50 about twice Redis's |
| Concurrency | The server serializes commands on a key | Transactions on a key are serialized by an advisory lock |
| Connections | One per replica | A bounded pool per replica (the server has a low limit) |
| Failure | Limiter fails open, sessions fail closed | Same |

Managed Redis means less latency and less to operate. A database you already
run means one more service to operate and one more connection pool to plan.

### 12.7 Control plane

The gateway exposes **no administrative endpoint** and accepts **no
administrative token** (decision 68): an administrative endpoint on the gateway
is one an attacker can reach, and that surface decides who reaches the
applications.

Administration is done by a **separate process**, `gateway-control`, which acts
on the shared state the gateway reads. It is never routed through the gateway:
it listens on its own socket on the deployment's internal network.

| Setting | Meaning |
| --- | --- |
| Listener | `GATEWAY_CONTROL_HOST` and `GATEWAY_CONTROL_PORT`. Binds loopback by default: the control plane is internal. |
| Credentials | `GATEWAY_CONTROL_TOKENS`, a JSON map `{token: {operator, scope}}`, or `GATEWAY_CONTROL_TOKENS_FILE` pointing at a file holding the same map. |
| State | `GATEWAY_CONTROL_STATE_URL`: the shared state to act on. The same state as the gateway's `GATEWAY_SESSION_URL`, reached with **different credentials** (§12.8). |

A token is at least 16 characters. A malformed map stops the process: a
control plane started with a map it does not understand is controlled by
nobody. A token that is also another secret stops the process too (for
example the shared-state password): a credential must not be reused.

**Scopes.** Each token carries exactly one scope:

| Scope | Allows |
| --- | --- |
| `read` | Endpoints that read. |
| `operate` | `read`, plus purging sessions and cached decisions. |
| `config` | `read`, plus writing the route table. |

Scopes are **not** a hierarchy: `operate` cannot write the route table and
`config` cannot purge a session.

**Authentication failures are counted per socket address**: five failures in
sixty seconds refuse the sixth. The counter lives in the shared state, so the
limit holds across control-plane replicas. If the shared state is unreachable,
the request is **refused**: a limit that cannot be counted is not a limit.

**Endpoints.** Every response is JSON and carries the request's `x-request-id`.

| Endpoint | Scope | What it does |
| --- | --- | --- |
| `GET /healthz` | — | Always `200`: the process answers. |
| `GET /readyz` | — | `200` when the shared state answers, `503` otherwise. |
| `GET /openapi.json` | — | The control plane's API description. The API check compares it with the control plane's routes. |
| `GET /v1/config` | `read` | Active revision, its table, the source, and configuration warnings (§12.2). |
| `POST /v1/config/validate` | `read` | Errors, conflicts, warnings and a **diff** against the active table. Writes nothing. |
| `PUT /v1/config` | `config` | Writes the whole table as a new revision. |
| `GET /v1/config/history` | `read` | Revisions, paginated. |
| `POST /v1/config/rollback` | `config` | Writes an older revision's table again, as a new revision. |
| `GET /v1/replicas` | `read` | Replica heartbeats (§3.4). |
| `DELETE /v1/sessions` | `operate` | Revokes a subject's sessions, like `bun run sessions`. |
| `DELETE /v1/decisions` | `operate` | Purges cached decisions for a subject and workspace. |
| `GET /v1/audit` | `read` | Audit trail, paginated. |

**`PUT /v1/config`** takes the whole table in the body and, in `If-Match`, the
revision the caller believes is active. The write is a **compare-and-swap**:
the pointer moves only if it still names that revision; otherwise `409`. A write
without `If-Match` is refused, since it could replace a revision nobody read.

**`POST /v1/config/rollback`** takes `{"revision": <number>}` and writes that
revision's table again as a **new** revision. Revisions are immutable;
rewriting an old one would erase the history in between.

**Protected routes.** `GATEWAY_PROTECTED_ROUTES` names routes that may not
change: a write that removes or changes one is refused with `409`, the same
refusal a stale `If-Match` gets.

**Audit trail.** Every write stores an entry: action, target, operator, scope,
caller address, request and timestamp. The store that performs the change
writes the entry **in the same transaction**, so neither can exist without the
other. A Postgres transaction and a Redis script are both server-side, so both
backends keep this promise. A Redis cluster that does not accept a script over
several keys falls back to the sequential path, with the audit entry written
after the change.

**Statuses.**

| Status | When |
| --- | --- |
| `401` | No token, or an unknown token. |
| `403` | The token's scope does not cover the endpoint. |
| `409` | `If-Match` does not name the active revision, or the write changes a protected route. |
| `422` | The table is invalid. |
| `429` | The address failed authentication too many times. |
| `503` | The shared state is unreachable (the failure counter lives there). |

### 12.8 Shared-state roles

The control plane's real boundary is **the shared-state credentials**, not the
caller's token. A stolen token grants only its scope; the gateway's credentials
grant nothing beyond what the gateway may do.

- The gateway runs with a role that may **read** the route-table tables and
  write nothing in them. It still writes sessions, limits, cached decisions and
  heartbeats, which are its own state.
- `gateway-control` runs with a role that may **write** the route table, the
  history and the audit trail, and read everything else it needs.

The roles and grants ship with the project; the deployment creates the two
users and grants them the roles. Redis gets the same split with ACL users: the
gateway's user may read the route-table keys, the control plane's user may
write them.

Both servers store the route table equivalently. In Redis the revisions and
pointer are **hashes** and the history is a **list**, and the gateway's user
has neither the hash-write command nor the list-push command, so reading and
writing the table are separated by credentials on both servers.

The Redis ACL file ships with the project (`deploy/redis/gateway.acl`). Two
format rules matter, because a file that breaks them does not do what it says:

- **One rule per line**, nothing else. The server reads the file as a list of
  rules, and any other line (a comment, for example) stops it from starting.
- `>` sets a **password**; `~` sets a **key pattern**. `>~gateway:s:*` does not
  set a key pattern: it sets a password equal to the pattern, and the user can
  touch no key at all.

Passwords are not in the file: the deployment sets them with `ACL SETUSER`
after the server starts and does not run `ACL SAVE`, so the file holds no
secret.

Least privilege is **tested**: a test proves that a gateway running with the
gateway role cannot write the route table.

---

## 13. What the gateway does not do

The gateway does not:

- terminate TLS (a proxy in front of it does);
- decide access on its own, or check roles;
- rewrite the request path except as in §11.1.1, or rewrite the body, query
  string or headers;
- buffer or cache responses;
- aggregate WebSockets;
- probe upstream health: upstreams are tried in list order, and the §11.4
  breaker learns only from failures the gateway observes;
- send a request to a second upstream when it may change the first one's state
  (§11.4).

---

## 14. Release compatibility

The gateway sits on the path of every request to the applications behind it,
and deployments write their own Access and upstreams against it. Those
contracts are **versioned promises**; this section says which promise holds
for which release. The decision log and the rules for a decision that changes
the contract are in [decisions.md](decisions.md) and
[platform decisions](../platform/decisions.md).

### 14.1 Contracts

| Contract | Defined in |
| --- | --- |
| Gateway behavior | This page. |
| Access protocol | §6.1, with its conformance suite. |
| Identity signature format | §7.4, with the [upstream-identity.md](upstream-identity.md) guide. |
| Route table format | §3. |
| Environment variable names | §4 and [configuration.md](configuration.md) (also [.env.example](../../packages/gateway/.env.example)). |
| Metric names | §12.1. |

Everything else is an implementation detail: code organization
([internals.md](internals.md#code-layout)), internal function names, libraries,
and the wording of logs and responses. Depending on them is not supported.

### 14.2 Release promise

The release version is `MAJOR.MINOR.PATCH` and is the platform's version: the
platform has one release line, and all three services ship with it.

- **PATCH**: a fix. Contract behavior does not change.
- **MINOR**: a feature. Contracts are **extended**, never changed: a route
  table field, an environment variable, a metric or a protocol status is added.
  A deployment written against the previous release keeps working unchanged.
- **MAJOR**: a change. Contracts may change; the release changelog lists each
  change with its migration. The `1.0` release fixes the contracts: after it, a
  `MINOR` release never changes one.

The §14.1 contracts are **frozen** in `1.0`: they were reviewed one by one, the
needed changes were made, and the result is what a `1.0` deployment is written
against. The next `MAJOR` release is the next one that may change them.

Rules that hold in every release, including after `1.0`:

1. **The route table is extended, never changed.** An added field has a
   default. Removing a field or changing its meaning is a `MAJOR` change. An
   unknown field is and stays a configuration error (§3.1).
2. **Access protocol is extended, never changed.** Request fields
   are added, and service answers keep their meaning. Removing a field is a
   `MAJOR` change, and the changelog says how a service migrates.
3. **The identity signature format is versioned.** The version is in the value
   (`v5=…`) and in the payload, so an upstream refuses another version's
   signature instead of misreading it. A new format gets a new version; the
   previous one keeps working until the changelog says otherwise and is removed
   in a `MAJOR` release (§7.4).
4. **Environment variable names keep their meaning.** A renamed variable keeps
   its old name until the changelog says it is gone, and the old name logs a
   warning for one release before it disappears.
5. **Metrics are added, never renamed.** A removed metric keeps its name for a
   release that announces its replacement, and the replacement has the same
   labels.
6. **Gateway responses keep their status and shape.** A new status may be
   added; clients that check the statuses they know keep working. A response
   body keeps the field that carries the error.

### 14.3 Deprecations

A deprecation is announced in the changelog, warned about in the gateway log,
and removed in a release named in the announcement. This release's table:

| What | Deprecated in | Removed in | Migration |
| --- | --- | --- | --- |
| — | — | — | Empty: the symmetric identity signature format (`v4`) was removed in `1.0`. Set `GATEWAY_IDENTITY_SIGNING_KEY` and give the public key to the upstreams (§7.4). |

A deprecation announced in a release is removed in a `MAJOR` release at the
earliest.
