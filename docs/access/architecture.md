# Architecture

How the access service's code is organised and which boundaries the build enforces. Behavior is in [spec.md](spec.md); the wire format is in [api.md](api.md).

## Shape

The service is a **modular monolith**: one process, one image, one database, four independent domains. Boundaries between the parts are **checked by the build**, and a violation fails CI.

```
   the browser ─┐
                ├─►  src/app/       the HTTP surface: thin handlers, one pipeline
   the gateway ─┘        │
                         ▼
              src/domains/     the rules, and only the rules
       identity │ authorization │ administration │ provider
                         ▲
                         │  the ports of the domains
              src/platform/     PostgreSQL, Redis, the Bun listener, the HTTP client
                         ▲
                         │
              src/runtime/       the composition root: the environment, the wiring
```

Arrows show dependency direction: the runtime knows everything, domains know only their own rules, and the application reaches domains through their public entry points.

## Layers

| Layer | Owns | Never |
| --- | --- | --- |
| `src/domains/` | One domain's policy: provider token validation, the decision rule, admin body validation, token claims. | Touches the network, database, framework or environment. |
| `src/app/` | Pipeline order, mapping domain failures to protocol responses, response headers. | Holds a rule. |
| `src/platform/` | Adapters: repository SQL, store driver, listener, provider client. | Decides anything. |
| `src/observability/` | Logs, metrics, constant-time secret comparison. | Depends on anything else. |
| `src/runtime/` | Reading the environment, composition, lifecycle and drain. | — |

## Build-checked boundaries

`scripts/gates/architecture.ts`, run by CI and by `test/architecture/`, walks the source tree and fails on a forbidden import:

1. A domain is imported only through its public entry point (`index.ts`).
2. The four domains are independent of each other.
3. Core domain code imports no framework (Hono), Bun API, adapter, application, platform or runtime.
4. The application reaches domains through their entry points and observation interfaces, never a concrete adapter.
5. The platform implements domain ports, makes no policy decisions, and knows neither the application nor the runtime.
6. The observation layer is independent of everything else.
7. The runtime is the composition root and may assemble everything.
8. No catch-all directories and no import cycles.
9. The application framework belongs to the application; the runtime's API belongs to the runtime platform.
10. Only the runtime reads the environment: a domain reading `process.env` has a setting nobody can validate.

`test/architecture/no-scaffolding.test.ts` asserts the code contains **no SAML, console, SCIM or directory sync**: a half-built feature in a service carrying customers is a liability (§14).

`knip` finds dead code. The compiler flags unused variables but not symbols nobody imports; knip reads the source, tests and scripts and names unreachable files and unused exports. `bun run dead` is the gate; `bun run dead --fix` removes the unused exports. Entry points are in `knip.json` (tests and operator scripts); the service entry point is a knip default. Any file none of them reaches is dead.

## Layout

| Path | Owns |
| --- | --- |
| `src/main.ts` | Process entry point. |
| `src/runtime/env.ts` | Environment schema, defaults, whole-environment validation, refusal to start in production without required secrets. The only reader of `process.env`. |
| `src/runtime/composition.ts` | Composition root: adapters, repositories, application wiring. |
| `src/runtime/lifecycle.ts` | Listener, drain, drain deadline. |
| `src/app/app.ts` | Request pipeline: request id, probes, routes, unknown-path refusal, unexpected-error handler. |
| `src/app/{login,oauth,provider}.ts` | Login, token endpoint, discovery, JWKS. |
| `src/app/decision-contract.ts` | The gateway's decision contract. |
| `src/app/access-context-contract.ts` | The access context contract: discovery and a principal's context. |
| `src/app/administration/` | The twelve endpoints, one file per resource (tenants, principals, groups, grants, audit), with shared parts in `support.ts`. |
| `src/app/{errors,pages,metrics,endpoints,state}.ts` | Refusal responses, login pages, metrics, probes, request state. |
| `src/domains/identity/` | Provider token validation, tenant resolution, login state, principal mapping, provider client. |
| `src/domains/authorization/` | The decision rule and reasons. |
| `src/domains/administration/` | The twelve endpoints as a service, one file per resource (tenants, principals, groups, grants, audit), with body validation, the limiter and authentication. Storage ports are in `ports/`, also one file per resource. |
| `src/domains/provider/` | Keys, tokens, discovery, authorization code, exchange. |
| `src/platform/postgres/` | Pool, migrations, repositories for the eight tables, statement tracing, tenant scope, audit table. |
| `src/platform/redis/` | Authorization code store. |
| `src/platform/bun/` | Listener, platform request and response, address guard. |
| `src/observability/` | Logs and redaction, metrics, secret comparison. |
| `scripts/` | Operator tools by kind: `cli/` (smoke test, secret rotation, decision plan), `compat/` (shadow comparison, compatibility runner), `gates/` (architecture checker, release version checker), `ops/` (load), `support/` (shared modules). |

## Flows

### Login

```
gateway ──► GET /oauth/authorize
               │  resolve the tenant (§5.2 of the spec)
               │  create the state cookie (encrypted, single use, 10 min)
               ▼
            302 to the provider of the tenant
               │
               ▼
provider ──► GET /oauth/tenant/callback?code=…&state=…
               │  read the cookie, check the state, delete the cookie
               │  exchange the code at the provider (PKCE S256)
               │  validate the id token (issuer, audience, nonce, algorithm, signature, clock)
               │  map (tenant, sub) → the principal row (§6.2)
               │  issue the authorization code of the gateway (60 s, single use, in Redis)
               ▼
            302 to the gateway
               │
gateway ──► POST /oauth/token
               │  authenticate the client (client_secret_basic)
               │  exchange the code for the id token and the access token
               ▼
            200 {"access_token": …, "id_token": …}
```

### Decision

```
gateway ──► POST /v1/decisions  {subject, workspaceId, routeId, roles}
               │  authenticate (bearer token of the deployment, or the credentials of a tenant)
               │  one statement over users, tenants, grants, permissions, groups
               │  a timeout of ACCESS_DECISION_TIMEOUT_MS
               ▼
            200 {"allow": true|false, "reason": "…"}
```

The decision query is one statement in `src/platform/postgres/decision-facts.ts` that returns the rule's **facts**; `src/domains/authorization/decision.ts` turns them into the answer and reason. Storage never decides, and the domain never sees SQL.

File names say which part of a concept a file holds: the application file is the HTTP **contract**, the domain file is the **rule**, and the platform file is the **facts** the rule reads. A concept spanning all three layers, like the decision or the access context, has three names: `src/app/decision-contract.ts`, `src/domains/authorization/decision.ts`, `src/platform/postgres/decision-facts.ts`.

## Data model

Eight tables, fully described in §3. Architecturally relevant points:

- **Keys carry the tenant.** Every domain table has `tenant_id`, and foreign keys are composite (`(id, tenant_id)`), so a grant can never name another tenant's principal. The schema enforces this, not the application.
- **Isolation has a database backstop.** All eight tables use PostgreSQL row level security; a statement's scope is the `access.tenant_id` setting, local to the transaction (§3.10).
- **Grants are the policy.** No policy language: a permission, a workspace, a route, an expiry.
- **Protocol state is not in the database.** Login state is in the browser cookie; the authorization code is in the store for sixty seconds.
- **The audit is not part of the domain model.** `admin_audit` records what changed and who changed it, and holds no tenant, principal or grant. Like the migrations table, it is infrastructure.

## Tests

| Kind | Where | Proves |
| --- | --- | --- |
| Unit | `src/domains/*/*.test.ts` | One domain's policy, without network or database. |
| Contract | `test/contract/` | Endpoints over a socket with fixtures: login, decision, administration, audit, secret rotation. |
| Integration | `test/integration/` | Decisions against real PostgreSQL, isolation, migrations, statement deadline, the decision rule against randomly built policies. |
| Compatibility | `test/compatibility/` | **The platform gateway, unchanged, against the access service.** |
| Architecture | `test/architecture/` | Import boundaries and absence of deferred features. |
| Tooling | `test/tooling/` | The compatibility runner: reference, sources, refusals. |

The compatibility suite starts the platform gateway (`packages/gateway/` at the repository's revision) with the access service replacing its two fixtures. `scripts/compat/compatibility.ts` (`bun run test:compat`) prepares the reference: it checks that the workspace's tracked files match the revision and passes its path in `ACCESS_GATEWAY_PATH`. Afterwards the runner asserts the reference tree is untouched: **the build fails if anyone modifies the gateway to make a test pass.**

The runner is a repository script outside the application: `src/` does not import it, and no service dependency comes from the reference. `bun run test` needs neither the reference nor a sibling directory.

## Working rules

Rules shared by all three workspaces are in [platform architecture](../platform/architecture.md). The access service adds:

1. **Never modify the gateway**, whether for a feature, a bug or a test.
2. **The schema reserves nothing for the future.** No always-`null` column, empty table or unread flag.
3. **Failure is denial**, everywhere: database or store down, slow provider, missing secret. The service never guesses toward allowing.
4. **Record every decision with evidence**: a measurement, a test or a provider document, never intuition.
