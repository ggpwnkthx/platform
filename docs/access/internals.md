# Internals

How the Access code is organised, how it is tested, how the compatibility suite works, what was measured, the security review, and what a release must satisfy. It is written for maintainers; behavior is in the [specification](spec.md) and running the service is in [Operations](operations.md).

## Code layout

A **modular monolith**: one process, one image, one database, four independent domains. CI fails on any import that crosses a boundary (`bun run architecture`).

```text
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

| Layer | Owns | Never |
| --- | --- | --- |
| `src/domains/` | One domain's policy: provider token validation, the decision rule, admin body validation, token claims. | Touches network, database, framework or environment. |
| `src/app/` | Pipeline order, mapping domain failures to protocol responses, response headers. | Holds a rule. |
| `src/platform/` | Adapters: repository SQL, store driver, listener, provider client. | Decides anything. |
| `src/observability/` | Logs, metrics, constant-time secret comparison. | Depends on anything else. |
| `src/runtime/` | Environment, composition, lifecycle and drain. | — |

`scripts/gates/architecture.ts` (`bun run architecture`, also run by CI and `test/architecture/`) fails when:

1. a domain is imported other than through its `index.ts`;
2. one domain imports another;
3. core domain code imports Hono, a Bun API, an adapter, the application, the platform or the runtime;
4. the application reaches a concrete adapter instead of a domain entry point or observation interface;
5. the platform makes a policy decision or knows the application or runtime;
6. the observation layer depends on anything;
7. anything but the runtime (the composition root) assembles the parts;
8. a catch-all directory or an import cycle appears;
9. the framework leaves the application, or the runtime's API leaves the runtime platform;
10. anything but the runtime reads `process.env`.

`test/architecture/no-scaffolding.test.ts` asserts there is no SAML, console, SCIM or directory sync (§14). `bun run dead` runs `knip`, which names unreachable files and unused exports from the entry points in `knip.json` (tests, operator scripts) plus the service entry point; `bun run dead --fix` removes unused exports.

| Path | Owns |
| --- | --- |
| `src/main.ts` | Process entry point. |
| `src/domains/identity/` | Provider token validation, principal mapping, tenant resolution, login state and the provider client. |
| `src/domains/authorization/` | The decision rule, grant reads, reasons. |
| `src/domains/administration/` | The twelve endpoints, body validation, auditing every change. |
| `src/domains/provider/` | The tokens Access issues, the JWKS, the discovery document, code exchange. |
| `src/observability/` | Logs, metrics, secret comparison. |
| `src/runtime/env.ts` | Environment schema and validation; the only reader of `process.env`. |
| `src/runtime/composition.ts`, `lifecycle.ts` | Wiring; listener and drain deadline. |
| `src/app/app.ts` | Pipeline: request id, probes, routes, unknown-path refusal, error handler. |
| `src/app/{login,oauth,provider}.ts` | Login, token endpoint, discovery, JWKS. |
| `src/app/decision-contract.ts`, `access-context-contract.ts` | The two read contracts. |
| `src/app/administration/`, `src/domains/administration/` | The twelve endpoints of the administration and the audit that reads it, one file per resource (tenants, principals, groups, roles, grants, audit); the domain also holds validation, the limiter, authentication and storage `ports/`. |
| `src/app/{errors,pages,metrics,endpoints,state}.ts` | Refusals, login pages, metrics, probes, request state. |
| `src/platform/postgres/` | Pool, migrations, repositories, statement tracing, tenant scope, audit table. |
| `src/platform/redis/`, `src/platform/bun/` | Code store; listener, request and response, address guard. |
| `scripts/` | `cli/` (smoke test, secret rotation, decision plan, database provisioning), `compat/` (shadow comparison, compatibility runner), `gates/` (architecture, release version), `ops/` (load), `support/`. |
| `scripts/compat/compatibility.ts` | The compatibility suite runner. Outside the application: no `src/` file imports it, and the service depends on no package of the reference. |
| `compatibility.json` | The platform workspaces and the tested revision ([Compatibility suite](#compatibility-suite)). At the repository root. |

**Flows.** Login follows §5.4. A decision (`POST /v1/decisions`) authenticates the gateway, runs one statement over users, tenants, grants, permissions and groups under `ACCESS_DECISION_TIMEOUT_MS`, and answers `{"allow", "reason"}`. A concept spanning three layers has three files: the HTTP **contract** (`src/app/decision-contract.ts`), the **rule** (`src/domains/authorization/decision.ts`) and the **facts** the rule reads (`src/platform/postgres/decision-facts.ts`). Storage never decides; the domain never sees SQL.

**Data model** (§3). Every domain table carries `tenant_id`, and foreign keys are composite `(id, tenant_id)`, so the schema stops a grant naming another tenant's principal. Row level security scopes every statement by the transaction-local `access.scope` and `access.tenant_id`; a statement with no scope sees nothing, and the scope of the platform is asked for by name (§3.10). Grants are the policy: permission, workspace, route, expiry. `admin_audit`, like the migrations table, is infrastructure and holds no domain row.

**Working rules**, beyond the [platform rules](../platform/internals.md#working-rules):

1. Never modify the gateway, for a feature, a bug or a test.
2. The schema reserves nothing: no always-`null` column, empty table or unread flag.
3. Failure is denial everywhere; the service never guesses toward allowing.
4. Back every decision with a measurement, a test or a provider document.

## Tests

The rule that every rule needs a test is in [platform internals](../platform/internals.md#working-rules).

| Kind | Where | What it proves |
| --- | --- | --- |
| Unit | `src/domains/*/*.test.ts` | Provider token validation, mapping, the decision rule, tenant resolution. |
| Contract | `test/contract/` | The whole flow against Access fixtures: browser login, code exchange, decision, the twelve administrative endpoints, the audit, secret rotation. |
| Integration | `test/integration/` | Decisions against real PostgreSQL and Redis, tenant isolation, migrations, the statement deadline, the decision rule against randomly built policies. |
| Compatibility | `test/compatibility/` | **The unchanged gateway against Access.** The gateway reference's fixtures are replaced by Access, and the gateway's contract suite runs against it. |
| Architecture | `test/architecture/` | Import boundaries, the absence of deferred features, the documented routes and counts, and every `§` reference. |
| Tooling | `test/tooling/` | The compatibility suite runner: the reference pin, the checkout sources, and the refusals. |

`bun run test` runs units, contracts and boundaries, and needs neither the reference gateway nor a sibling directory. `bun run test:integration` runs the integration tests.

### Documentation tests

`test/architecture/` also holds the documentation to the code, so a docs change can fail the build:

| Test | Holds |
| --- | --- |
| `routes.test.ts` | Every route registered in `src/app/app.ts` appears as `METHOD /path` in `docs/access/api.md` or `docs/access/operations.md`, and every such pattern in those two files is a real route. |
| `counts.test.ts` | Every phrase that counts the administration (the twelve administrative endpoints, the twelve calls of the session) uses the number of routes the code registers. |
| `spec-references.test.ts` | Every `§N` in the code, the tests and `docs/access/` names a heading of `docs/access/spec.md`. |
| `version.test.ts` | The release version agrees across the files listed in [Release and delivery](#release-and-delivery). |

The root `bun run api:check` also compares the endpoints named in `api.md` with the routes and the OpenAPI description.

### Databases in tests

Tests run on the embedded database by default. A workflow with a server sets `ACCESS_TEST_DATABASE_URL`, and the same tests run against it. The repository is developed and tested against **PostgreSQL 18**: the development compose file, the CI jobs and the release gates run it, and the embedded PostgreSQL is that version.

### Compatibility test

The gateway starts with its own configuration, with its fixtures replaced by Access:

```text
GATEWAY_OIDC_ISSUER   = the issuer of Access
GATEWAY_OIDC_CLIENT_ID= the client id of the tenant
GATEWAY_ACCESS_URL    = the base url of Access
GATEWAY_ACCESS_TOKEN  = the access token of Access
```

The suite asserts that:

1. a browser logs in at the tenant's provider and returns to the gateway with a session;
2. the gateway writes the `x-gateway-user`, `x-gateway-email` and `x-gateway-roles` headers with the principal's values;
3. a request with a grant on the workspace is forwarded, and one without is refused with `403 workspace_forbidden`;
4. a revoked grant is refused within the gateway's cache TTL;
5. the gateway's metrics count the denial as `missing_role`.

A second file, `test/compatibility/cutover.test.ts`, **rehearses a tenant cutover** ([Operations](operations.md#tenant-cutover)), playing the runbook phases against the reference gateway: register the tenant, its principal and its grant; a browser logs in and reaches an upstream; revoke the grant and access ends; switch the tenant again without registering anything.

**The gateway is never modified for these tests.** A test that needs a gateway change is refused: the compatibility test exists to prove none is needed.

## Compatibility suite

`bun run --cwd packages/access test:compat` runs the platform gateway, unchanged, against Access. The reference is the platform's `packages/gateway/` workspace at the repository's revision, pinned in the root `compatibility.json`, the one place that names the workspaces ([platform compatibility](../platform/internals.md#compatibility) describes the manifest). The runner validates it strictly: `version` `2`, the platform repository, only the three known workspaces, and a 40-hex commit (no branch) for a reference.

The runner (`scripts/compat/compatibility.ts`, `bun run test:compat`) is the only way the reference is prepared. A developer-prepared reference (`ACCESS_GATEWAY_PATH`) is checked and never written to; one that carries changes is refused with the reason. To test a published gateway revision, name a repository and a **full commit id**: a branch, tag, short hash or placeholder is refused, because a moving reference cannot be tested twice. A suite run against another revision proves nothing.

The runner reads the manifest from the repository root, clones the gateway at the pinned commit (from the local repository when it holds the commit, so no network), installs its dependencies, checks its tracked files, runs `bun test test/compatibility` with the path in `ACCESS_GATEWAY_PATH` (the suite runs the gateway as a process in its own directory), and checks the reference is still unchanged. Its last line names the tested commit: `the compatibility suite passed against the gateway at <commit> …`.

`bun run compatibility` runs it with the workspace tests and platform acceptance. Plain `bun test` also collects the suite, which then fails with instructions; use `bun run test` day to day.

Sources, first one set wins:

| Variable | Meaning |
| --- | --- |
| `ACCESS_GATEWAY_PATH` | A prepared gateway directory, used as is: never reset, cleaned or checked out over. |
| `GATEWAY_REPOSITORY` + `GATEWAY_COMMIT` | A git URL or local path holding that 40-hex commit. The run tests a **candidate**, not the baseline. |
| `COMPAT_MIRROR` | A directory holding a bare `gateway.git`, for offline runs (Data harness uses the same layout). |
| — | This repository's workspace. |

Options: `COMPAT_WORKSPACE` (checkout directory, default temporary), `COMPAT_KEEP` (keep the checkout), `COMPAT_TESTS` (space-separated test files). To test a running service such as a release image, set `ACCESS_EXTERNAL_URL`, `ACCESS_EXTERNAL_ADMIN_TOKEN` and `ACCESS_EXTERNAL_ACCESS_TOKEN` (its decision token); the suite then starts nothing of its own.

```bash
mkdir -p /srv/compat-mirror
git clone --bare https://github.com/ggpwnkthx/platform.git /srv/compat-mirror/gateway.git
COMPAT_MIRROR=/srv/compat-mirror bun run --cwd packages/access test:compat
```

An override that is set but unusable is an error; the runner never falls back. Temporary checkouts are removed on failure and interruption; a supplied one never is.

| Situation | Output |
| --- | --- |
| Reference has changes | `the workspace … carries changes to its tracked files:` and the changes |
| Source lacks the revision | `the source … does not hold the pinned commit …` |
| Clone failed | `the clone of … failed:`, git output and alternative sources |
| Mirror lacks `gateway.git` | `COMPAT_MIRROR names a directory that holds no bare repository named "gateway.git": …` |
| Suite failed | Suite output; the runner exits with its status |
| Reference changed during the run | `the reference carries changes to its tracked files:` and the changes |

The blocking `compatibility` CI job runs `bun run compatibility` and checks all three reference trees against the manifest. `release.yml` reruns the suite against the published image by digest through `ACCESS_EXTERNAL_URL`.

## Capacity

`scripts/ops/load.ts` measures the production decision statement through the service's repository with the deployment deadline. It runs on every CI build against the job's PostgreSQL; numbers are in the build log. Only measured numbers are published.

```bash
ACCESS_DATABASE_URL=postgres://… bun run scripts/ops/load.ts --requests 5000 --concurrency 20 \
  --max-p50-ms=60 --max-p95-ms=90 --max-p99-ms=120 --min-per-second=100
```

Each `--max-*` option fails the run when that percentile exceeds it, `--min-per-second` when throughput is below it; without them the script only reports. CI thresholds sit far above the targets because runners are shared: they catch a changed plan, a dropped index or a policy-table scan.

The thresholds of the build are set from the measurement of the shared runner, not from the target: a shared runner has two cores and the pool of the service has ten connections, so twenty requests in flight measure the queue of the pool and not the statement. The runner measures a `p50` of about thirty milliseconds at that concurrency, and the gate is twice the measurement. The documented target of a decision under load — a `p99` of fifty milliseconds — is what the gate protects.

The tenant-decision gate allows a higher percentile than the platform-decision gate, because a tenant-scoped statement runs inside a transaction and costs about a third more. Both gates catch the same defects.

| Target | Value | Shape |
| --- | --- | --- |
| Decision `p50` / `p99` | ≤ 3 ms / ≤ 20 ms | One principal, a hundred grants |
| Decision under load | ≤ 50 ms at `p99` | 500 decisions per second, two replicas |
| Pool | ≤ 70 % at peak | 10 connections per replica |
| Login broker overhead | ≤ 150 ms | Around the provider round trip |
| Process memory | ≤ 200 MB | 1 000 concurrent logins |
| Decisions per second per replica | ≥ 500 | As above |

PostgreSQL 18 over loopback, 16-core development machine (load average one), 5 000 requests, 20 in flight, one principal with a hundred grants, median of three runs:

| | Platform decision | Tenant decision |
| --- | --- | --- |
| `p50` | 1.44 ms | 1.95 ms |
| `p95` | 1.85 ms | 2.81 ms |
| `p99` | 2.49 ms | 3.87 ms |
| Decisions per second | 13 639 | 9 765 |

The columns are the two §8.8 schemes. Tenant credentials need a transaction for the transaction-local scope, which costs about a third more. Targets are met on this machine.

Embedded PostgreSQL (one connection), 1 000 requests: `p50` 0.45 ms, `p95` 0.57 ms, `p99` 0.64 ms, maximum 0.71 ms, 2 146 per second. With 20 in flight, `p50` is 42.7 ms and `p99` 48.9 ms at the same throughput: the single connection's queue, not the query.

With 1 000 principals and 1 000 000 grants, for a principal holding a thousand, the plan is `Bitmap Index Scan on grants_user_live` with `Index Cond: (user_id = u.id)`, executing in 1.5 ms.

Not measured yet: deployment-hardware numbers, pool saturation, memory under a thousand logins and broker overhead. They are measured with the same script during the first tenant's [cutover](operations.md#tenant-cutover) and published here.

## Security review

Model: login state is encrypted, authenticated and single use; codes are opaque, hashed, single use and bound; decisions and administration compare credentials in constant time; the database enforces tenant rules; client secrets are encrypted with AES-256-GCM under a key derived with HKDF-SHA256 from the deployment secret.

| # | Item | Result | Where |
| --- | --- | --- | --- |
| 1 | Identifier enumeration: decision reasons reveal whether a subject exists; admin ids sit behind the admin token. The gateway, the only caller, hides reasons. | Accepted | `src/domains/authorization/decision.ts` |
| 2 | Timing: admin, decision and metrics tokens are hashed, then compared in constant time; tampered login state does not decrypt. | Fixed | `src/observability/secrets.ts`, `src/domains/identity/state.ts` |
| 3 | SQL injection: statements are parameterised; identifiers are code constants. | No finding | `src/platform/postgres/` |
| 4 | SSRF via `idp_issuer`: every resolved address must be public in production; development allows loopback fixtures. | Fixed | `src/platform/bun/address.ts` |
| 5 | Provider calls do not follow redirects. | Fixed | `src/platform/bun/http.ts` |
| 6 | Refusal pages escape everything. | Fixed | `src/app/pages.ts` |
| 7 | The logger redacts tokens, secrets, cookies, passwords and `Authorization` in fields and text; statement values are never logged. | Fixed | `src/observability/logging.ts`, `src/platform/postgres/trace.ts` |
| 8 | Both client secrets are encrypted under `ACCESS_SECRET_ENCRYPTION_KEY`; without a key no tenant is written. | Fixed | `src/platform/postgres/secrets.ts` |
| 9 | Login state: encrypted, authenticated, deleted whatever the outcome, ten minutes. | Fixed | `src/domains/identity/state.ts` |
| 10 | Code: opaque, hashed, 60 s, single use, bound to client, redirect URI and PKCE challenge. | Fixed | `src/domains/provider/code.ts`, `src/domains/provider/exchange.ts` |
| 11 | Database or store outage, slow provider and decision timeout all end in denial. | Fixed | `src/app/decision-contract.ts` |
| 12 | Reasons go to the decision log; the contract response carries one and the gateway hides it. | Accepted | `src/app/decision-contract.ts` |
| 13 | Image: non-`root`, no shell or build tools, base pinned by digest. | Fixed | `Dockerfile` |
| 14 | The database password comes from the environment, never the image. | No finding | `src/runtime/env.ts` |
| 15 | Failed-authentication bursts get `429`; counts live in the shared store, so the window is deployment-wide. | Fixed | `src/domains/administration/limiter.ts`, `src/platform/redis/store.ts` |
| 16 | Admin bodies ≤ 64 KiB; provider calls and decisions have deadlines. | Fixed | `src/app/administration/`, `src/domains/identity/provider-client.ts` |
| 17 | An unregistered gateway redirect URI is refused with `400 invalid_request` before the tenant is resolved, and never gets a code. | Fixed | `src/domains/identity/tenant.ts`, `src/app/login.ts` |
| 18 | State cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, path is the callback. | Fixed | `src/app/login.ts` |
| 19 | Tenant credentials asking about another tenant's principal get "principal does not exist"; the bearer token is unscoped. | Fixed | `src/app/decision-contract.ts` |
| 20 | Row level security on all eight tables, transaction-local scope, production refuses a bypassing role. | Fixed | `src/platform/postgres/scope.ts`, `src/platform/postgres/migrations/0003_tenant_isolation.sql` |
| 21 | Rotation without a gap: a replaced gateway secret stays valid 24 hours; environment tokens use two variables. | Fixed | `src/app/decision-contract.ts`, `src/app/oauth.ts`, `src/domains/administration/service.ts`, `docs/access/spec.md` §4.3.1 |
| 22 | The audit is a table naming the credential's fingerprint, written by the same statement as the change. | Fixed | `src/platform/postgres/audited.ts`, `src/platform/postgres/audit.ts`, `src/app/administration/` |
| 23 | Server-side `statement_timeout` frees the connection at the decision deadline. | Fixed | `src/platform/postgres/postgres.ts`, `src/platform/postgres/decision-facts.ts` |
| 24 | Permission keys are unique per `(tenant, key)`; platform catalogue permissions are shared. | Fixed | `src/domains/administration/service.ts`, `src/platform/postgres/permissions.ts` |
| 25 | Per-tenant admin credentials: another tenant is `403 forbidden`, lists cannot be widened, the audit names the operator. | Fixed | `src/domains/administration/credentials.ts`, `src/domains/administration/service.ts`, `src/runtime/composition.ts` |
| 26 | A tenant credential changing `shared_client` or `is_default` gets `403 forbidden`. | Fixed | `src/domains/administration/service.ts` |
| 27 | Decision scope comes from the credential, never a row flag. | Fixed | `src/app/decision-contract.ts` |
| 28 | The guard pins the resolved address and calls it with the original `Host` and certificate check, defeating DNS rebinding. | Fixed | `src/platform/bun/address.ts`, `src/platform/bun/http.ts` |
| 29 | Only failed calls spend the limiter budget, so attackers cannot lock out the token holder. | Fixed | `src/domains/administration/service.ts`, `src/domains/administration/limiter.ts` |
| 30 | Headers: `x-content-type-options`, `x-frame-options`, `referrer-policy` everywhere; `content-security-policy` on refusal pages; `cache-control: no-store` on tokens. | Fixed | `src/app/app.ts`, `src/app/oauth.ts` |

## Open findings

| # | Finding | Severity | Plan |
| --- | --- | --- | --- |
| 1 | A decision reason tells the gateway whether a subject exists. | Low | The gateway hides it; a neutral reason would change the §8.7 vocabulary, a spec change first. |
| 2 | The decision bearer token is unscoped: any gateway holding it may ask about any principal, and all share it. | Medium | The reference gateway only speaks this scheme, so it stays. Deployments move gateways to tenant credentials (§8.8) and then unset the optional token (§4.4); rotation is rolling (§4.3.1); its first use logs a one-time deprecation notice. It is the only scheme that reaches every tenant (item 27). |
| 3 | A tenant may register a plain `http` provider. | Low | Refusing it would break such deployments. The called address is the checked one (item 28) and responses are capped at 1 MiB; operators register `https` issuers. |

## Release readiness

Someone who did not write the service checks each item; every answer is a test, a measurement or a document.

| Area | Item | Answer |
| --- | --- | --- |
| Correctness | Every spec rule has a test | [Tests](#tests); `bun run test`, `bun run test:compat`. |
| Correctness | Compatibility suite passes, gateway diff empty | `test/compatibility/gateway.test.ts`; CI checks the reference; the release reruns it on the published image. |
| Correctness | Migrations apply empty and on the previous release | `test/integration/migrations.test.ts`: idempotent, refuses an unknown migration. |
| Correctness | Dependency failures deny, tested really down | Database down, decision timeout, unreachable provider, store down. |
| Correctness | Reasons reach no caller-readable log | Decision log and contract response only. |
| Security | Review items above | No open finding above low except finding 2, whose plan is a deployment migration. |
| Security | Provider key rotation keeps logins working | Keys re-read for an unknown `kid` (§6.6); `test/contract/rotation.test.ts`. |
| Data | Eight domain tables; production schema is the migrations'; columns dropped two releases after last use | `access_schema_migrations` is infrastructure; no migration drops a column (§14). |
| Data | Backups automatic, restores rehearsed, times written | [Operations](operations.md#backup-and-restore); measured at the quarterly rehearsal. |
| Data | Durable audit | `admin_audit`, written with the change; `GET /v1/admin/audit`. |
| Data | Database isolates tenants | `src/platform/postgres/scope.ts`, §3.10, `test/integration/isolation.test.ts`. |
| Data | Group members are the tenant's principals | Foreign keys plus a domain check (`404`, §10.9). |
| Availability | Stateless replicas; drain keeps in-flight logins; a provider outage hits one tenant | State in cookie and store; five seconds of drain (§12.4); providers called per tenant. |
| Availability | Shared store or explicit single node | `ACCESS_ALLOW_MEMORY_STATE`; production without Redis refuses to start. |
| Availability | Alerts reach a read channel; runbooks walked once | [Operations](operations.md#monitoring); wired and rehearsed at the first cutover. |
| Observability | Redacted structured logs; a decision line found from the gateway's request id | `src/observability/logging.ts`; request id on every line and response; decision lines carry subject, workspace, route. |
| Observability | Bounded labels; dashboard of decision rate, latency, login refusals, failures by dependency | `src/observability/metrics.ts` (tenant capped at 100); dashboard built on the deployment platform. |
| Delivery | Built once, promoted by digest | `release.yml`; gates run on the digest. |
| Delivery | CI runs types, lint, tests, architecture, compatibility, version, scan | Jobs `check`, `compatibility`, `image` in `.github/workflows/ci.yml`. |
| Delivery | Version in `/healthz` and the startup log | `src/app/endpoints.ts`; log `the listener started`. |

Checked on a deployment: capacity with `scripts/ops/load.ts`, pool saturation and memory on the dashboard, and alert wiring and image rollback by someone who did not write the service, all during the first cutover; restore and recovery times quarterly.

## Release and delivery

Tagging, dispatch and artifacts are platform-wide ([platform internals](../platform/internals.md#release)). Access-specific points:

The version appears in five files, and `bun run versions` names any that disagree: `packages/access/package.json`, `packages/access/Dockerfile` (`ARG VERSION`), `packages/access/src/runtime/version.ts`, `docs/access/spec.md` (status) and `docs/access/README.md`. Bump them in one commit.

`tag.yml` tags the commit CI proved with `v<version>` when the version went up, then dispatches the release workflows (a workflow-token push starts none). It refuses disagreeing versions, a pre-release version, and a version that went down; an unchanged version does nothing. Dispatch by hand with `gh workflow run release.yml --ref v1.0.4 -f tag=v1.0.4` (and `release-binaries.yml`), or push a hand-made annotated tag, which starts the release directly.

| Workflow | Does |
| --- | --- |
| `release.yml` | Builds the image once and publishes it (tags `v1.0.4` and `1.0.4`, provenance, SBOM) **before** the gates, so they test the shipped bytes: start with a deployment configuration, answer decisions, refuse a missing secret or a bypassing role, drain, scan, reference gateway's suite. A failed gate withdraws the image. |
| `release-binaries.yml` | Compiles every supported platform, proves the runner's binary starts, applies the schema and serves, and attaches archives to the release. |

Each archive holds the binary and `migrations/` beside it (§3.8); embedded PostgreSQL ships in neither binaries nor image.

```bash
tar -xzf access-1.0.4-linux-x64.tar.gz -C /opt/access
/opt/access/access-1.0.4-linux-x64
trivy image --severity HIGH,CRITICAL --exit-code 1 access:ci
syft access:ci -o spdx-json > access.spdx.json
```

| CI job | Runs |
| --- | --- |
| `check` | Types, lint, format, boundaries, release version, `bun run test`, integration tests on PostgreSQL. |
| `compatibility` | `bun run test:compat` and the reference check. Never skipped: red is a red build. |
| `image` | Build, scan (fails above high), SBOM, runtime user, size, start refusals, startup and drain. |

A change merges on green CI with one reviewer other than the author, and with the spec updated when a rule changed.

## Support policy

A release is supported while current and for one release after: deployments on `N` move to `N+1`, and `N` is not patched after that. Patch releases never change behavior; a contract change updates the spec with the code and is a minor release. The current release is the [`package.json`](../../packages/access/package.json) version and tag `v<version>`, tested against the repository's gateway revision. Changes are in [`CHANGELOG.md`](../../CHANGELOG.md).

## Known limits

Deferred features (SAML, console, SCIM, directory sync, account linking) are in §14; none has a column, table, flag or endpoint, and a test asserts it.

| Limit | Meaning |
| --- | --- |
| One gateway per tenant | A gateway holds one client id. `shared_client` is the refused-by-default escape hatch (§1.4, §5.2). |
| Group membership is a `uuid[]` | Not paginated, one row. A constraint trigger refuses foreign members (§3.5); a GIN index avoids walking groups, but many groups still cost containment checks per decision. |
| The pool's `statement_timeout` is the tightest deadline | PostgreSQL stops the statement and frees the connection. Embedded PostgreSQL cannot interrupt, so locally the statement holds its connection until it answers. |
| Unscoped decision bearer token | See [open finding 2](#open-findings). |
| No refresh token | Tokens live five minutes, then the gateway re-authenticates (§7.2). |
| The audit is a table, not a report | Queryable and exportable as `csv` or `jsonl` (§10.15). No summary, no retention policy: it grows while the deployment keeps it, and operators read it with `curl` and SQL. |
| Capacity from a development machine | See [Capacity](#capacity). |
| The suite needs the reference | Offline, use `COMPAT_MIRROR` or `GATEWAY_REPOSITORY`. |
