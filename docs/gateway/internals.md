# Internals

For gateway maintainers: code layout and import rules, capacity measurements, the runtime capabilities the
gateway relies on, and how it is verified. Behaviour is normative in [spec.md](spec.md); ownership rules are in
[spec §14](spec.md#14-code-organization).

## Code layout

The gateway is a modular monolith: one deployable, split into domains with explicit boundaries.

| Path | Owns |
| --- | --- |
| `src/main.ts` | Process entry point; starts the runtime. |
| `src/app/` | Hono application: thin handlers, middleware, pipeline order, mapping failures to answers. |
| `src/domains/<domain>/` | A domain's policy, use cases, ports and unit tests. |
| `src/domains/<domain>/adapters/` | Port implementations; only the composition root uses them. |
| `src/platform/bun/` | Listener, peer address, outbound HTTP, socket primitives. |
| `src/platform/redis/`, `src/platform/postgres/` | Shared-state clients: construction, pool, TLS, schema, disposal. |
| `src/runtime/` | Environment, composition root, file watcher, signals, drain, running-policy log. |
| `src/observability/` | Logging and metrics; imports nothing else. |
| `services/` | Access reference implementation, which deployments may run. |
| `services/fixtures/` | Deterministic provider, Access and upstream stand-ins; refuse to run in production; not in the image. |
| `scripts/` | `cli/` (identity key, migrations, session revocation), `dev/` (runner, test Redis and Postgres), `gates/` (architecture, version, environment), `ops/` (load, benchmark), `support/`. |
| `test/` | Checks other than domain unit tests; helpers in `test/support/`. |

### Domains

| Domain | May use |
| --- | --- |
| `routing`, `authentication`, `rate-limiting` | — |
| `configuration` | `routing`, `authentication` |
| `workspace-access` | `authentication`, `routing` |
| `forwarding` | `authentication` |
| `proxying`, `websockets` | `forwarding` |
| `control` | `configuration`, `authentication`, `workspace-access` |

### Import rules

`scripts/gates/architecture.ts` enforces these in the test suite and CI:

1. Import a domain only through its `index.ts`.
2. Use only the dependencies the domain matrix allows.
3. A domain's core (outside `adapters/`) imports no framework, Bun API, application, platform, runtime or
   adapter; dependencies arrive through ports.
4. A domain's `index.ts` exports no adapter.
5. The application uses domain entry points and observation interfaces, never an adapter.
6. The platform implements ports, makes no policy decision, and imports neither application nor runtime.
7. The observation layer imports nothing from the project.
8. The runtime is the composition root and may assemble everything.
9. No catch-all directories (`utils`, `services`, `repositories`, `common`, …) and no import cycles, type-only
   imports included.
10. Only the application uses Hono; only the platform uses runtime APIs.

`scripts/gates/environment.ts` checks that `.env.example` and [Configuration](configuration.md) match the
variables declared in `src/runtime/env/`, the only place variable names live.

`bun run dead` runs `knip --use-tsconfig-files` and fails on any unused file, export, type or dependency. A
domain's `index.ts` is not an entry point, so an export no consumer imports is reported, as is an export
used only inside its own module. Workers started with `Bun.spawn` and the `bun --watch` runner are declared
as entries in the `knip` section of `package.json`.

The gateway adds one rule to the [platform working rules](../platform/internals.md#working-rules): a request
is an exchange, not a chain of middlewares.

### Lifetimes

| Lifetime | Owner |
| --- | --- |
| Process | `src/runtime/composition.ts` (construction), `src/runtime/lifecycle.ts` (disposal) |
| Configuration generation | Configuration domain: immutable snapshot, published atomically |
| Request | Application: captures one generation |
| HTTP exchange | Proxying domain, with the Bun transport |
| WebSocket pair | WebSockets domain, with the Bun socket primitives |

One owner finalizes each exchange or connection exactly once ([spec §14.4](spec.md#144-resource-ownership)).

### Request flow

```
Bun.serve (platform/bun/listener.ts)
  └─ app.fetch (app/app.ts)
       └─ middleware: request id, cookies
            ├─ gateway endpoints (app/endpoints.ts)
            └─ dispatcher (app/dispatcher.ts)
                 ├─ routing: matchRoute
                 ├─ rate-limiting: the four scopes
                 ├─ authentication: selectCredential, authenticate
                 ├─ forwarding: checkCrossSite, buildUpstreamHeaders
                 ├─ workspace-access: decide
                 ├─ proxying: execute  →  platform/bun/http-transport.ts
                 └─ websockets: handle   →  platform/bun/upstream-websocket.ts
```

The dispatcher is the only place domains are combined; each decides only for itself.

## Source map

Each rule lives in one domain, with its tests beside it.

| Path | Owns |
| --- | --- |
| `app/app.ts` | Hono app, request-id middleware, gateway endpoints. |
| `app/dispatcher.ts` | Pipeline order ([spec §2.3](spec.md#23-dispatcher)). |
| `app/admission.ts` | Bound on requests inside the gateway. |
| `app/limits.ts` | The three §9 budgets, counted together in one shared-state round trip. |
| `app/endpoints.ts` | `/healthz`, `/readyz`, `/metrics`, `/auth/login`, `/auth/callback`, `/auth/logout`. |
| `app/revalidation.ts` | Rechecking route, session and access on an open WebSocket. |
| `app/dependencies.ts`, `state.ts`, `errors.ts`, `cookies.ts` | Application interfaces, per-request state, refusal body, cookie reading. |
| `routing/schema.ts`, `match.ts` | Route shape; compilation, precedence, matching, ambiguity. |
| `configuration/schema.ts` | File schema, strict validation, defaults. |
| `configuration/store.ts` | Generations: snapshot, atomic publication, last good state, reload status. |
| `configuration/describe.ts`, `compile.ts`, `routes.ts` | Running-policy description; compiling and diffing tables; effective routes. |
| `configuration/revisions.ts`, `adapters/` | Revision shape and store contract; Redis and Postgres route tables (a revision and its trail entry in one script or transaction). |
| `authentication/policy.ts`, `principal.ts` | Modes; credential selection (invalid is rejected, never replaced). |
| `authentication/oidc.ts`, `login-state.ts` | Relying party (discovery, PKCE, exchange, bearer validation); signed login state. |
| `authentication/session.ts`, `cookies.ts`, `service.ts` | Session rules; cookie names; authenticate, login, logout. |
| `authentication/adapters/` | Memory, Redis (one script) and Postgres (one function) session stores. |
| `workspace-access/client.ts` | Access client: request, cache, fail closed. |
| `workspace-access/breaker.ts`, `decision.ts`, `workspace.ts` | Service health; decision shape and metric reason; workspace ID validation. |
| `workspace-access/adapters/` | Memory, Redis and Postgres decision caches. |
| `forwarding/network.ts`, `context.ts` | CIDR and trusted proxies; peer, client address, protocol and effective host. |
| `forwarding/origins.ts`, `headers.ts`, `cookies.ts` | Cross-site policy; header policy both ways; cookie parsing and rendering. |
| `forwarding/identity.ts`, `trace.ts`, `target.ts` | Identity signature; trace context; upstream URL and `Location` rewrite. |
| `rate-limiting/policy.ts`, `window.ts`, `limiter.ts`, `fallback.ts` | Scopes and keys; sliding window; bounded in-memory limiter; outage fallback. |
| `rate-limiting/adapters/` | Redis and Postgres limiters (one script or function; fail open). |
| `proxying/transport.ts`, `exchange.ts`, `breaker.ts` | Transport ports; exchange state machine; passive upstream breaker. |
| `websockets/` | Ports, upgrade context, connection slots (`reservation.ts`), relay (`bridge.ts`), handshake order (`service.ts`). |
| `control/policy.ts`, `service.ts`, `adapters/` | Token scopes and protected routes; write rules and trail; failed-authentication counters. |
| `platform/bun/` | `listener.ts`, `http-transport.ts` (no redirects, buffering or decompression), `access-transport.ts`, `client-upgrade.ts`, `upstream-websocket.ts`, `runtime.ts` (reads the runtime version). |
| `platform/redis/`, `platform/postgres/` | `client.ts` (server shapes, pool, TLS, background connection), `commands.ts`, `postgres/schema.ts`. |
| `runtime/env/` | `settings.ts`, `schema.ts` (variable names), `read.ts`; the only reader of `process.env`. |
| `runtime/` | `shared-state.ts` (backend by URL scheme), `composition.ts`, `lifecycle.ts`, `policy-log.ts`, `version.ts`. |
| `observability/` | `logging.ts` (credential redaction), `metrics.ts` (bounded labels). |

`services/access-service.ts` answers the [spec §6.1](spec.md#61-access-protocol) protocol from a policy
file. It is not a fixture; `test/support/access-conformance.ts` runs against it, so protocol and reference
cannot drift.

| Change | Lands in |
| --- | --- |
| Authentication mode | `authentication/policy.ts`, then `principal.ts` |
| Identity header | `forwarding/identity.ts`, then `headers.ts` |
| Limit scope | `rate-limiting/policy.ts`, then `app/dispatcher.ts` |
| Metric | `observability/metrics.ts` |
| Environment variable | `runtime/env/schema.ts`, `.env.example`, [Configuration](configuration.md) |
| Exchange phase | `proxying/exchange.ts`, [spec §11.2](spec.md#112-phases-and-budgets) |
| Route-table field | `configuration/schema.ts`, and `routing/schema.ts` if it affects matching |

### Shared-state layout

Postgres objects, in the `gateway` schema:

| Object | Holds |
| --- | --- |
| `gateway.sessions` | Sessions: `jsonb` record, expiry and subject columns. |
| `gateway.access_decisions` | Cached decisions. |
| `gateway.rate_limit_buckets` | Limiter buckets. |
| `gateway.session_touch(...)` | Read a session and refresh its expiry in one transaction (Redis: `TOUCH_SCRIPT`). |
| `gateway.rate_limit_check(...)` | Count a request in one transaction (Redis: `WINDOW_SCRIPT`). |
| `gateway.config_revisions`, `gateway.config_active`, `gateway.audit` | Route table, active pointer, write trail. |

The Redis ACL in `deploy/redis/gateway.acl` gives `gateway` read/write on session, limit and decision keys,
write-only on its heartbeat (`%W~gateway:cfg:hb:*`), and read-only on `gateway:cfg:active`,
`gateway:cfg:rev:*` and `gateway:cfg:revs`. Revisions are hashes and history a list, and `gateway` can
neither write a hash nor push to a list. `gateway-control` may read and write `~gateway:*`.

## Verification

| Kind | Command | Proves |
| --- | --- | --- |
| Unit and contract | `bun test src test/contract` | Domain policy; the pipeline over a socket with real fixtures. |
| Network | `bun test test/network` | The [runtime capabilities](#runtime) proxying needs. |
| Integration | `bun test test/integration` | Shared state on real Redis and Postgres, the shared backend contract, several replicas. |
| Browser | `bun test test/browser` | Cookies and origins in Chromium. |
| Interop | `bun test test/interop` | Discovery and sign-in against dex. |
| Fuzz | `bun test test/fuzz` | Parser properties. |
| Soak | `bun test test/load` | Resources settle after traffic. |
| Architecture | `bun test test/architecture` | Import boundaries, environment docs, tool coverage. |
| Load | `bun run load` | [Capacity](#capacity). |
| Backend comparison | `bun run benchmark` | Not in CI. |
| Types, lint, format, dead code | `bun run typecheck`, `lint`, `format:check`, `dead` | — |

CI (`.github/workflows/ci.yml`) also builds the image, checks it starts with a deployment configuration,
refuses to start without a session secret, Access, identity provider or rate limit, and contains no
fixtures.

Last full run: **793 passed, 0 failed** across 79 files on Bun 1.4.3, with real Redis 7.0.15
(`GATEWAY_TEST_REDIS_URL=redis://127.0.0.1:6399/0`), real Postgres 18.6
(`GATEWAY_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/gateway`), 3 Chromium tests and 2 soak tests.
Only the four real-provider interop tests were skipped (CI runs them against dex). Coverage of `src/`:
**93.8 %** lines, **93.0 %** functions (mean over files); whole tree: **91.7 %** lines, **91.8 %** functions.
Without Redis, its 38 tests are skipped; without a named Postgres server, Postgres tests use the in-process
engine.

## Capacity

Measured with `scripts/ops/load.ts`, which also reports resident memory (size pods with it) and can target a
running gateway:

```bash
bun run load -- --requests 20000 --concurrency 100
bun run load -- --websockets 1000
bun run load -- --url http://localhost:8080 --host api.example.com
```

| Target | Value |
| --- | --- |
| Route requests | 1000 req/s per replica, p99 below 100 ms |
| Rate limits | Deployment-wide, not per replica (shared state) |
| WebSockets | 1000 open per replica, 500 opened/s |
| Memory | Below 512 MiB per replica with 1000 WebSockets (pod limit 1 GiB) |
| Errors | Below 0.1 % of requests |
| Drain | Connections close within `GATEWAY_SHUTDOWN_TIMEOUT_MS` |

Reference machine: AMD Ryzen 7 5800X (8 cores, 16 threads), 31 GiB, Linux 7.2, Bun 1.4.3. Gateway and
upstream in one process, plain http over loopback, idle machine. Numbers are a lower bound on cost: no
ingress, TLS or network.

| Run | Result |
| --- | --- |
| 3000 requests, 50 in flight | 7541 req/s, p50 6.4 ms, p90 7.7 ms, p99 8.8 ms, 0 errors |
| 20000 requests, 100 in flight | 7683 req/s, p50 13.5 ms, p90 16.7 ms, p99 19.3 ms, max 21.6 ms, 0 errors; 150 MiB peak |
| 500 WebSockets | 415 connections/s, handshake p99 193 ms, 0 errors |
| Idle | 71 MiB resident |
| 1000 open WebSockets | **110 MiB**; 642 connections/s, handshake p99 540 ms, 0 errors |

- About 7600 req/s; latency grows with requests in flight because the runtime queue is the bottleneck.
- A WebSocket handshake costs about 2 ms; 1000 connections cost about 40 MiB.
- On the same machine under other load: about **4400 req/s** (p50 23 ms) at 100 in flight. Measure on your
  own machines.
- Soak (`bun test test/load`, 5 rounds of 50 requests, a WebSocket and a reload): settled in 1.1 s, heap
  growth below 64 MiB. It is a release gate: memory, descriptors, connections and timers must settle.

### Shared-state backends

`scripts/ops/benchmark.ts` runs each scenario against both backends:

```bash
bun run benchmark -- --redis redis://127.0.0.1:6399/0 --postgres postgres://127.0.0.1:5432/gateway
```

Scenarios: `no-state` (baseline), `limits` (three limiter checks), `session` (plus the session read), `full`
(plus the cached decision). Last run: 20 000 requests at 50 in flight, two rounds, all servers on the
reference machine over loopback; an earlier run differed by a few percent.

| Scenario | Backend | req/s | p50 | p99 |
| --- | --- | --- | --- | --- |
| `no-state` | in process | 7244 | 6.9 ms | 11.7 ms |
| `limits` | in process | 6834 | 7.2 ms | 11.7 ms |
| `limits` | Redis | 5884 | 8.4 ms | 12.9 ms |
| `limits` | Postgres | 3811 | 13.0 ms | 18.4 ms |
| `session` | in process | 6226 | 7.8 ms | 13.5 ms |
| `session` | Redis | 4144 | 11.7 ms | 26.4 ms |
| `session` | Postgres | 2747 | 18.0 ms | 25.3 ms |
| `full` | in process | 5610 | 8.4 ms | 14.2 ms |
| `full` | Redis | 3680 | 13.4 ms | 20.1 ms |
| `full` | Postgres | 2414 | 20.6 ms | 27.9 ms |

- Redis costs about a tenth of baseline on `limits` and a third on `full`; Postgres about half, with twice
  Redis's p50. The gap grows with round trips.
- Not the disk: with synchronous commit off, a limiter transaction takes about 0.2 ms instead of 1.8 ms. With
  it on, Postgres `limits` drops to about 420 req/s (p50 120 ms), because the deployment scope serializes
  every request.
- Forty pool connections measured slower than ten (about 3 600 vs 4 100 req/s on `limits`): serialization,
  not pool size, is the bottleneck.
- Not measured: an ingress, TLS (the ingress's cost), state on another host, managed servers, several
  replicas (counters are proved exact; capacity is the sum of replicas).

## Runtime

The gateway is written against Bun directly, so each boundary behind spec §4, §10 and §11 is proved by a
`test/network/` test against a real socket. Before reading its environment, `src/runtime/version.ts` stops
the gateway on a runtime older than **Bun 1.4.3** ([decision 36](decisions.md)); `src/runtime/version.test.ts`
tests it.

| Capability | Proof | Behaviour |
| --- | --- | --- |
| Streaming upload | `test/network/transport.test.ts`: upstream polls chunks while the client produces | Bytes reach the upstream during the upload. |
| End of upload | Same test, `/upload` | End of the request stream is the reported event; peer acceptance is not claimed. |
| Response phases | Raw server sends the head, then the body a second later | Transport resolves on final headers (1 ms); first body byte at 1002 ms, so `responseMs` and `firstByteMs` are separate. |
| Interim response | `103 Early Hints`, then final | Only the final response is reported and forwarded. |
| Protocol switch | `101` on plain HTTP | Refused: transport fails, the exchange answers `502`. |
| Early response | `/early` answers without reading the body | The answer arrives mid-upload; the body producer is cancelled. |
| Caller cancellation | Exchange signal aborted | Upstream request cancelled, transport rejects. |
| Redirect | `302` | Not followed. |
| Compressed response | `content-encoding: gzip` | Bun decompresses by default, so the transport sets `decompress: false`; bytes pass unchanged. |
| Upstream WebSocket refusal | `403` instead of a handshake | Reported with status, headers and body, not as a network failure. |
| Upstream subprotocol | First offered is selected | Reported and mirrored to the caller. |
| WebSocket over TLS | Bun's client against Bun and OpenSSL TLS servers | Fails with no cause, so the gateway refuses with reason `tls`. **WebSocket upstreams use plain http.** |
| Caller upgrade | Raw client reads the `101` | Carries gateway headers (request ID, refreshed cookie). |
| Upstream TLS | `test/network/tls.test.ts`, client certificate requested | Gateway presents its certificate and verifies the upstream's against the deployment CA; a rejected certificate gives `502`. |

| Version | Result |
| --- | --- |
| **1.4.3** | Every boundary observable. The release version. |
| 1.2.23 | Early response arrives but the body producer is not cancelled; the `ws` client's `unexpected-response` event is missing, so upstream refusals are invisible; the caller upgrade with gateway headers is refused. |
| 1.2.0 | Early response never arrives: the exchange waits for the upload to end. |

## Release

The release process is platform-wide: see [platform release](../platform/internals.md#release). Gateway
binaries embed the runtime and are built for seven targets: `bun-linux-x64` (glibc), `bun-linux-x64-musl`
(Alpine), `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`, `bun-windows-arm64`.
Archives are named like `gateway-1.0.0-linux-x64-musl`. The image is built twice, once into the local store
for deployment checks and once for the registry; only the second carries provenance and SBOM attestations,
because the local docker exporter cannot carry an attestation manifest list.

## Known gaps

Outside the gateway's scope, closed by the deployment:

| Gap | Closed by |
| --- | --- |
| Client TLS | The ingress. |
| Upstream fixed per route | A router in front of pods, when the workspace picks the pod. |
| Revocation waits for the cache TTL | `GATEWAY_ACCESS_CACHE_TTL_MS`, or `accessCacheTtlMs: 0` per route. |
| Uncached decision latency | A fast Access; the cache absorbs the rest. |
| One hostname per product surface | Subdomains, or one host with distinct path prefixes. |
| WebSocket upstream over TLS | Not possible on this runtime ([above](#runtime)). |

Thin evidence:

| Area | Status |
| --- | --- |
| History | Young project, a few days' design, never in production; every capacity number is from one machine. |
| In-flight access calls | Shared per replica: a burst across N replicas asks N times, bounded by the cache lifetime. |
| Access and upstream breakers | Per process: a replica that saw no failure keeps calling and pays the budget. |
| Behind an ingress, remote shared state | Not measured. |
| Other providers | Tested with the project's provider and dex only; other claim names or id tokens without a nonce are untested. |
