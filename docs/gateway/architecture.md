# Architecture

How the gateway's code is laid out, which imports are allowed where, and which file owns each rule. The
gateway is a modular monolith: one deployable, split into domains with explicit boundaries. Behaviour and
ownership are normative in [spec §14](spec.md#14-code-organization).

Two gates enforce this page; both run in the test suite and in CI, so a violation fails the build:

- `scripts/gates/architecture.ts` checks the import rules below.
- `scripts/gates/environment.ts` checks that `.env.example` and [Operations](operations.md) match the
  variables declared in `src/runtime/env/`, the only place environment names live. An undocumented
  variable is one nobody sets; a documented variable that does not exist looks active but is not.

## Layers

| Path | Owns |
| --- | --- |
| `src/main.ts` | Process entry point. Starts the runtime and nothing else. |
| `src/app/` | The Hono application: thin handlers, middleware, pipeline order, and mapping failures to protocol answers. |
| `src/domains/<domain>/` | One domain's policy, use cases, ports and unit tests. |
| `src/domains/<domain>/adapters/` | Concrete port implementations. Only the composition root uses them. |
| `src/platform/bun/` | Listener, peer address, outbound HTTP transport and socket primitives. |
| `src/platform/redis/` | Construction, TLS settings and disposal of the shared Redis clients. |
| `src/platform/postgres/` | Construction, pool, TLS settings, schema and disposal of the shared Postgres clients. |
| `src/runtime/` | Environment, composition root, file watcher, signals, drain and the running-policy log. |
| `src/observability/` | Logging, metrics and observation handles. Knows nothing else. |
| `services/fixtures/` | Deterministic identity-provider, access-service and upstream fixtures. Not part of a deployment. |
| `services/` | The access service reference implementation, which a deployment may run. |
| `scripts/` | Workspace commands: `cli/` (identity key, migrations, session revocation), `dev/` (development runner, test Postgres and Redis), `gates/` (architecture, release version and environment checks), `ops/` (load, benchmark) and `support/` (shared modules). |
| `test/` | Checks other than a domain's unit tests. Shared helpers are in `test/support/`. |

## Domains

| Domain | May use |
| --- | --- |
| `routing` | — |
| `authentication` | — |
| `rate-limiting` | — |
| `configuration` | `routing`, `authentication` |
| `workspace-access` | `authentication`, `routing` |
| `forwarding` | `authentication` |
| `proxying` | `forwarding` |
| `websockets` | `forwarding` |
| `control` | `configuration`, `authentication`, `workspace-access` |

## Import rules

The architecture gate enforces:

1. Import a domain only through its public entry point (`index.ts`); its internals are private.
2. Use only the dependencies the domain matrix allows. A domain not listed in a row may not be used.
3. A domain's core (everything outside `adapters/`) imports no framework, Bun API, application, platform,
   runtime or concrete adapter. Dependencies arrive through injected ports.
4. A domain's entry point exports no adapter; the composition root assembles adapters.
5. The application uses domain entry points and observation interfaces, never a concrete adapter.
6. The platform implements domain ports, makes no policy decision, and imports neither the application nor
   the runtime.
7. The observation layer imports nothing from the project.
8. The runtime is the composition root and may assemble the application, domains, adapters, platform and
   observation layer.
9. No catch-all directories (`utils`, `services`, `repositories`, `common`, …) and no import cycles,
   type-only imports included.
10. Only the application uses the framework (Hono), and only the platform uses runtime APIs (listener,
    sockets, shared-state client).

## Dead code

The import rules say where code may live, not whether anything uses it. `bun run dead` runs `knip` and fails
the build when a file, export, type or dependency is unused.

- Configuration is the `knip` section of `package.json`. It declares the entry points (process, tests,
  scripts, fixtures, examples) and reports exports of non-entry files.
- `bun run dead` runs `knip --use-tsconfig-files`, so the project's directories are named once, in
  `tsconfig.json`.
- A domain's `index.ts` is **not** an entry point: an export no consumer imports is reported, since only
  consumers decide what a domain exposes. Keep each `index.ts` to what is actually used.
- An export used only inside its own module is reported too. The code is alive but the `export` is
  superfluous, and an entry point that offers more than its consumers need is a promise nobody asked for.
- Files that tools cannot see are declared as entries: workers that integration tests start with
  `Bun.spawn`, and the development runner that `package.json` starts with `bun --watch`.

## Lifetimes

| Lifetime | Owner |
| --- | --- |
| Process | `src/runtime/composition.ts` (construction) and `src/runtime/lifecycle.ts` (disposal) |
| Configuration generation | The configuration domain: an immutable snapshot, published atomically |
| Request | The application: captures one generation and hands it to the domains |
| HTTP exchange | The proxying domain, with the Bun transport |
| WebSocket pair | The WebSockets domain, with the Bun socket primitives |

One owner finalizes each exchange or connection exactly once. The middleware rule is in
[spec §14.4](spec.md#144-resource-ownership).

## Request flow

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

The dispatcher is the only place domains are combined. Each is called through its entry point and decides
only for itself.

## Source map

Every gateway rule lives in exactly one domain, with its tests beside it. Use this map to find where a
change lands.

### `src/app/`

The application is deliberately thin: pipeline order, mapping domain failures to protocol answers, and
writing response headers and cookies.

| File | Owns |
| --- | --- |
| `app.ts` | The Hono application, request-id middleware and the gateway endpoints. |
| `dispatcher.ts` | Pipeline order ([spec §2.3](spec.md#23-dispatcher)). The only place domains are combined. |
| `admission.ts` | The bound on requests inside the gateway, and refusing those that do not fit. |
| `limits.ts` | A request's budgets: the three independent §9 budgets are counted together, so the shared state is asked once, not three times. |
| `endpoints.ts` | Handlers for `/healthz`, `/readyz`, `/metrics`, `/auth/login`, `/auth/callback` and `/auth/logout`. |
| `revalidation.ts` | Revalidating an open WebSocket: route, session and access are checked again. |
| `dependencies.ts` | The interfaces the application is built from. Names domains, never adapters. |
| `state.ts` | Per-request state: request id, generation, forwarding context, route. |
| `errors.ts` | The body of a gateway refusal. |
| `cookies.ts` | Reading request cookies. |

### `src/domains/`

| Domain | File | Owns |
| --- | --- | --- |
| `routing` | `schema.ts` | Shape of the id, host pattern and path template; validating placeholders against the path. |
| | `match.ts` | Route compilation, precedence, matching, parameter decoding, ambiguity detection. |
| `configuration` | `schema.ts` | File schema, strict validation, effective defaults. |
| | `store.ts` | Configuration generations: immutable snapshot, atomic publication, last good state, reload status. |
| | `describe.ts` | Description of the running policy and its permissive settings. |
| | `compile.ts` | Compiling a table and diffing two tables. |
| | `routes.ts` | A table's effective routes and the deployment defaults. |
| | `revisions.ts` | Route-table revision shape and the shared-state store contract. |
| | `adapters/redis-route-table.ts` | Route table in Redis. Writing a revision and its trail entry is one script. |
| | `adapters/postgres-route-table.ts` | Route table in Postgres. Writing a revision and its trail entry is one transaction. |
| `authentication` | `policy.ts` | Schema of the modes and the workspace policy. |
| | `principal.ts` | Credential selection per mode; an invalid credential is rejected, never replaced. |
| | `oidc.ts` | The relying party: discovery, PKCE, code exchange, bearer-token validation. |
| | `login-state.ts` | Signed in-flight login state and redirect-target sanitization. |
| | `session.ts` | Session record, bounds and lifetime rules. |
| | `cookies.ts` | Names and attributes of the gateway cookies. |
| | `service.ts` | Use cases: authenticate, begin login, complete login, log out. |
| | `adapters/memory-sessions.ts` | In-process session store. |
| | `adapters/redis-sessions.ts` | Redis session store. Expiry refresh is one server script. |
| | `adapters/postgres-sessions.ts` | Postgres session store. Expiry refresh is one server function. |
| `workspace-access` | `workspace.ts` | Workspace identifier validation. |
| | `decision.ts` | Decision shape and mapping its reason to the metric. |
| | `breaker.ts` | Access-service health: the service is not called while failing. |
| | `client.ts` | Access-service client: request, answer, cache, fail-closed behaviour. |
| | `adapters/memory-cache.ts` | In-process decision cache. |
| | `adapters/redis-cache.ts` | Redis decision cache. |
| | `adapters/postgres-cache.ts` | Postgres decision cache. |
| `forwarding` | `network.ts` | CIDR parsing and trusted-proxy evaluation. |
| | `context.ts` | Peer address, client address, chain, protocol and **the effective host**. |
| | `origins.ts` | Cross-site policy: origin normalization, request and navigation guards, handshake origin. |
| | `headers.ts` | Header policy in both directions, and the gateway cookies. |
| | `cookies.ts` | Parsing `Cookie`, rendering `Set-Cookie`, cookie names. |
| | `identity.ts` | Identity sanitization, canonical payload, signature and verification. |
| | `trace.ts` | Request trace context: parsing the caller's `traceparent`, the gateway span and the header it writes. |
| | `target.ts` | Upstream URL and rewriting a response `Location`. |
| `rate-limiting` | `policy.ts` | Scopes and window keys. |
| | `window.ts` | Sliding window: bucket size, bucket index, window evaluation. |
| | `limiter.ts` | In-memory limiter: bounded table, shared overflow window. |
| | `fallback.ts` | Behaviour while the shared state is unreachable: count in process, allow, or refuse. |
| | `adapters/redis-limiter.ts` | Redis limiter: counter and expiry in one script. Fails open. |
| | `adapters/postgres-limiter.ts` | Postgres limiter: counter and expiry in one function. Fails open. |
| `proxying` | `transport.ts` | Transport ports: request and response. |
| | `exchange.ts` | Exchange state machine: phases, budgets, limits, cancellation, finalization. |
| `websockets` | `ports.ts` | Socket, handshake and revalidation ports. |
| | `context.ts` | Upgrade context, assembled by the application. |
| | `reservation.ts` | Connection slots, including in-flight handshakes. |
| | `bridge.ts` | Relay between the two legs: buffers, backpressure, keepalive, revalidation. |
| | `service.ts` | Handshake order: origin, slot, upstream, caller, bridge. |
| `control` | `policy.ts` | Token scopes, reading the token map, routes a write may not change. |
| | `service.ts` | Administrative write rules: compare-and-swap, validation, protected routes, write trail. |
| | `adapters/redis-failures.ts` | Failed-authentication counter in Redis. |
| | `adapters/postgres-failures.ts` | Failed-authentication counter in Postgres. |

### `src/platform/`

Implements domain ports; makes no policy decisions.

| File | Owns |
| --- | --- |
| `bun/listener.ts` | `Bun.serve`, a request's peer address, stopping the listener. |
| `bun/http-transport.ts` | Outbound HTTP: no redirects followed, no body buffered, no response decompression. |
| `bun/access-transport.ts` | Calls to the access service. |
| `bun/client-upgrade.ts` | Upgrading the caller, with the gateway headers. |
| `bun/upstream-websocket.ts` | The upstream handshake and socket. |
| `bun/runtime.ts` | The process's runtime version. Runtime APIs belong to the platform, so the version is read here; the policy that judges it lives in the runtime layer. |
| `redis/client.ts` | Client construction, server shapes (single server, cluster, sentinel), TLS, background connection, disposal. |
| `redis/commands.ts` | Shared-state commands. |
| `postgres/client.ts` | Client construction, connection pool, TLS, background connection, disposal. |
| `postgres/schema.ts` | Shared-state tables and functions, and schema bootstrap. |
| `postgres/commands.ts` | Shared-state commands. |

### `src/runtime/`

| File | Owns |
| --- | --- |
| `env/` | The process environment: `settings.ts` (settings shape), `schema.ts` (variable names and the gateway and control-plane schemas), `read.ts` (reading and validation). The only reader of `process.env`. |
| `shared-state.ts` | Available shared-state backends, chosen by URL scheme. |
| `composition.ts` | Constructs everything: clients, stores, domains, application, listener. |
| `lifecycle.ts` | Configuration watcher, signals, drain, deadline. |
| `policy-log.ts` | Log of the running policy: routes and permissive settings. |
| `version.ts` | Build version. |

### `src/observability/`

| File | Owns |
| --- | --- |
| `logging.ts` | Credential redaction before anything is written. |
| `metrics.ts` | Metrics and their bounded labels. |

### `services/`

`services/fixtures/oidc-provider.ts`, `services/fixtures/access-fixture.ts`, `services/fixtures/upstream.ts`
and `services/fixtures/raw-http.ts` are deterministic stand-ins for the identity provider, access service
and upstreams. They refuse to run in production and are not in the gateway image.

`services/access-service.ts` is the access service **reference implementation**: it applies a policy file
and answers the [spec §6.1](spec.md#61-access-service-protocol) protocol. It is not a fixture; it runs in production and a deployment
may use it. The conformance suite in `test/support/access-conformance.ts` runs against it, so protocol and
reference cannot drift apart.

## Where a change lands

| Change | File |
| --- | --- |
| New authentication mode | `authentication/policy.ts`, then `authentication/principal.ts` |
| New identity header | `forwarding/identity.ts`, then `forwarding/headers.ts` |
| New limit scope | `rate-limiting/policy.ts`, then `app/dispatcher.ts` |
| New metric | `observability/metrics.ts` |
| New environment variable | `runtime/env/schema.ts`, then `.env.example` |
| New exchange phase | `proxying/exchange.ts`, then [spec §11.2](spec.md#112-phases-and-budgets) |
| New route-table field | `configuration/schema.ts`, then `routing/schema.ts` if it affects matching |

## Working rules

Rules shared by all three workspaces are in the [platform architecture](../platform/architecture.md). The
gateway adds one: a request is an exchange, not a chain of middlewares.

## Verification

| Kind | Where | Proves |
| --- | --- | --- |
| Unit | `src/**/*.test.ts` | One domain's or runtime part's policy, without the network. |
| Contract | `test/contract/` | The gateway pipeline over a socket, with real fixtures around it. |
| Network | `test/network/` | The runtime capabilities proxying depends on. |
| Integration | `test/integration/` | Shared state against real Redis and Postgres, the contract both backends share, and a multi-replica deployment. |
| Browser | `test/browser/` | Cookies and origins in a real browser. |
| Load | `test/load/` | Soak, and resources settling after traffic. |
| Architecture | `test/architecture/` | Import boundaries, and tool coverage of the tree. |
| Dead code | `bun run dead` | Every file, export and dependency is used. |

Each domain owns the tests of its rules; the contract suite proves the domains are wired as the spec says.
The rule for a rule without a test is in the [platform architecture](../platform/architecture.md).
