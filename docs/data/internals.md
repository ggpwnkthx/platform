# Internals

Maintainer reference for the data service: how it is built and tested, what it measured, how it
proves platform compatibility, and what its release and security review leave open.

## Architecture

A headless modular monolith with an optional worker process and no user interface
([spec §13](spec.md#13-architecture)). Studios, websites, scripts and services are all API clients;
none has a privileged database connection. The backend never reads access-service tables, never
mints an identity (it holds only the gateway's public key), and never creates a session or runs a
login flow ([spec §1.2](spec.md#12-ownership)).

### Request flow

1. The gateway signs the caller's identity into `x-gateway-signature`; the backend rebuilds the
   canonical payload from method, path, query, host and headers and verifies it with the route's
   public key, never trusting the transmitted payload.
2. One statement reads the workspace and its catalog (collections, policy bundle).
3. The access service answers the principal's permission keys for subject, tenant, workspace and
   route, or a refusal, outside the business-data transaction.
4. The scoped transaction projects only granted fields, authorizes a write by one complete policy,
   and commits record, audit entry, domain event and receipt together
   ([spec §10](spec.md#10-mutations-and-transactions)).

### Storage

- Deployments run PostgreSQL 15 or later; development, tests and CI use 18
  ([decision 32](decisions.md#32-development-and-ci-use-postgresql-18-deployments-may-run-15-or-later)).
- Business tables carry `tenant_id` and `workspace_id` under row-level security, scoped per
  transaction with `set_config(…, true)`.
- Five roles: migration owner, API runtime, registry reader, delivery and maintenance; the API never
  holds the other four's credentials ([Operations](operations.md)).
- Tables come only from reviewed migrations. History, when declared, mirrors the collection table and
  is written by the change statement ([spec §11.6](spec.md#116-record-version-history)).

### Catalog, model and events

- The **catalog** (registered collections and policy bundle) is a logical registry over the global
  physical schema ([spec §7.5](spec.md#75-workspace-catalog)), read uncached, so a published bundle
  applies on the next request.
- The **model** overlays the manifest in realtime ([spec §7.6](spec.md#76-workspace-model)); its
  domain owns the model store, table column reader and workspace collection registrar ports.
- Subscribers registered in the composition root receive each committed event at least once, possibly
  out of order. Workers claim deliveries with leases and act with a fresh context for their service
  principal; the originating user is only an attribution.

### Process roles

| `DATA_PROCESS_ROLE` | Does | Needs |
| --- | --- | --- |
| `api` | Endpoints and probes. | Gateway bindings and the cursor key. |
| `worker` | Delivery claims. | Delivery credentials and its service principal. |
| `all` | Both; the local development default. | Both sets. |

### Code boundaries

Layers are in [spec §13](spec.md#13-architecture). Also in `packages/data/`: `src/protocol/` (errors,
clock and envelopes shared by domains), `packages/client/` (typed client), `manifests/` (this
deployment's manifest and bundle) and `migrations/`. Only `src/runtime/config.ts` reads variable names;
the rest receives typed settings.

| Domain | May import |
| --- | --- |
| `gateway-context`, `workspaces`, `schema`, `audit`, `events` | nothing |
| `authorization` | `gateway-context`, `workspaces`, `schema` |
| `catalog` | `schema`, `authorization`, `workspaces`, `model` |
| `model` | `schema` |
| `records` | `gateway-context`, `workspaces`, `schema`, `authorization`, `audit`, `events` |

A domain core imports no framework, runtime or adapter; only the composition root builds adapters.
`bun run architecture` refuses violations and cycles, including type-only ones.

## Development

Installation and platform-wide commands: [platform development](../platform/development.md).

### Test suites

| Suite | Command | Covers |
| --- | --- | --- |
| Domain rules | `bun test test/unit` | Predicates, field rules, write checks, schema validation, context expiry, identity, secrets, metrics. |
| API contract | `bun test test/contract` | Paths, envelopes, limits, error codes, ETags, receipts, aggregates, search, catalog, attack cases. |
| Database and worker | `bun test test/integration` | Row-level security, transactions, worker claims, replicas, differential tests, search plan. |
| Boundaries | `bun test test/architecture` | Imports, cycles, private adapter construction. |
| Suite strength | `bun run test:mutation` | Breaks code on purpose; the suites must notice. |
| Client | `bun test packages/client/test` | The client against a mocked API. |
| Platform | `bun run test:compat` | Real gateway, access service and data service. |

Differential tests (`test/integration/filter.property.test.ts`, `write-guard.test.ts`) compare
generated predicates and write policies in memory and in the database; fuzzing
(`test/unit/fuzz.test.ts`) proves caller input never reaches a statement as an identifier. Integration
tests start their own PostgreSQL 18 server
([decision 16](decisions.md#16-tests-run-against-a-real-postgresql-server)).

### Release gates

```bash
bun run typecheck
bun run lint
bun run format:check
bun run architecture
bun run dead
bun test test/unit test/contract test/integration test/architecture packages/client/test
bun run test:mutation
bun run test:compat
```

Plus the operational gates (backup rehearsal, capacity, the declared rate and latency objective) and
CI's dependency audit. The mutation gate is textual: a refactor that moves a mutation's text must
update the mutation, or the gate fails it as stale.

### Scripts

Operator commands run on the deployment machine, are never HTTP routes and never bypass the access
service. Credentials: [Configuration](configuration.md#operator-commands).

| Directory | Commands |
| --- | --- |
| `scripts/cli/` | `provision.ts` (roles and database), `migrate.ts` (migrations as schema owner), `workspace.ts` and `collection.ts` (`create`/`register`, `enable`, `disable`, `list`), `policy.ts` (`publish`, `list`, `show`), `delivery.ts` (`list`, `requeue`, `backlog`), `retention.ts`. |
| `scripts/ops/` | `backup.sh`, `restore.sh`, `rehearse-backup.sh` (run with `bash` on a dedicated server), `capacity.ts`, `scale.ts`. |
| `scripts/compat/` | `compatibility.ts` (harness), `check-compatibility.ts` (baseline drift). |
| `scripts/gates/` | `architecture.ts`, `mutation.ts`, `check-client-package.ts` (packed client installed outside the repository). |
| `scripts/dev/` | `generate-client.ts` (types from the manifest), `generate-fixtures.ts` (signature fixtures). |

`bun run dead` hunts unreachable modules, unread names and unused dependencies; `bun run release:tag`
tags a release whose version increased.

### Adding a collection

1. Write and apply (`bun run migrate`) the migration creating the table with its columns, composite
   relations and row-level security. A table no migration describes is not part of the deployment.
2. Declare it in `manifests/schema.json` and its policies in `manifests/policies.json`.
3. Regenerate client types with `bun run scripts/dev/generate-client.ts`.
4. Register it for the workspaces that serve it with `bun run collection -- register`.

## Capacity

`bun run scripts/ops/capacity.ts` starts PostgreSQL, a fixture access service, the backend and
concurrent clients that sign like the pinned gateway, then runs the scenarios of
[spec §15.5](spec.md#155-capacity-and-rollout). Tune with `CAPACITY_CLIENTS` (default 16) and
`CAPACITY_DURATION_MS` (default 10000 per scenario). The numbers describe one machine at one moment;
a deployment measures its own with the same command.

| Machine | Value |
| --- | --- |
| Hardware | 16 cores, x86_64, 31 GiB, Linux 7.2.9, Bun 1.4.3 |
| Database | PostgreSQL 18.6 on the same machine, `fsync=off` and `synchronous_commit=off` |
| Deployment | One api process, `DATA_DB_POOL_MAX=20`, registry and delivery pools of 5 |
| Context cache | `DATA_CONTEXT_CACHE_TTL_MS=0`: every request asks the access service |
| Catalog | The workspace registered nothing; the deployment catalog is read with the registry in one statement |
| Data | 1000 articles in one workspace, one policy per action, pages of 50 |

### Results

Release candidate `1.0.0`, guarded write path:

| Scenario | Requests | Rate | p50 | p95 | p99 | Failures |
| --- | --- | --- | --- | --- | --- | --- |
| Read heavy, a page of 50 | 15102 | 1510/s | 10.4 ms | 13.4 ms | 15.5 ms | 0 |
| Mixed, half creations | 21491 | 2149/s | 7.3 ms | 9.4 ms | 10.7 ms | 0 |
| Concurrent updates of one record | 6011 | 601/s | 26.6 ms | 30.9 ms | 33.8 ms | 0 (379 successes, 5632 precondition failures) |
| Access service down | 62617 | 6262/s | 2.5 ms | 3.2 ms | 4.6 ms | 62617 answers 503 |

- Reads hold with a context fetch per request: it precedes the statement, the cheap part.
- No lost update: an update without the current validator gets `412 PRECONDITION_FAILED`; latency is
  the row lock's.
- With the access service down, requests fail closed in about two milliseconds
  (`503 AUTHORIZATION_UNAVAILABLE`), with no queue.
- Version `1.0.0` on PostgreSQL 15.19 measured 991/s, 1251/s, 313/s and 4280/s (p50 15.8, 11.6, 50.8
  and 3.6 ms); runs on different database versions are not comparable.
- Three consecutive read-heavy runs gave 1510/s, 1571/s and 1371/s, a spread of about a fifth.

### Statement shape at scale

`bun run scripts/ops/scale.ts` writes a million-row collection, reads a page statement's plan, walks
every page and compares the rows with one statement's. Pages are selected first and projected after
([decision 2](decisions.md#2-read-projection-is-built-in-the-database)), in an index order
([decision 3](decisions.md#3-page-order-is-the-databases-order)).

| Collection | Plan before | Plan now | Page time |
| --- | --- | --- | --- |
| 200 000 rows | Sequential scan, sort of the whole scope, projection of every row | Index scan of the page, 51 lookups | 97 ms → 0.9 ms |
| 1 000 000 rows | The same, three times the rows | The same plan | 0.9 ms |

The walk over 200 000 rows read 4 000 pages, every row, in database order. Sorting or filtering on a
field needs its index in the collection's reviewed migration.

Not measured: several replicas (reads scale with replicas, writes with the database); worker capacity
(integration tests cover claims, leases and retries; watch `data_outbox_backlog` and
`data_outbox_oldest_age_seconds`); maximum bounds (a 200-record page, 50-predicate filter or
1000-row expansion), which contract tests check and refuse with `422 RESULT_TOO_LARGE`.

### Deployment declaration

A deployment declares these items, measures them on its own hardware and publishes the result.

| Item | Declares | Reference deployment |
| --- | --- | --- |
| Request rate | Requests per second | 1 000 per second, context fetched for every request |
| Latency objective | Percentile and value | p95 under 25 ms for a page of 50, under 50 ms for a write |
| Data shape | Records, page size, filter predicates | 1 000 records in one workspace, pages of 50, ten-predicate filters |
| Policy complexity | Policies per collection, fields per policy | One policy per action, five fields each |
| Pool | `DATA_DB_POOL_MAX`, database size | `DATA_DB_POOL_MAX=20`, registry and delivery pools of five |
| Replicas | API processes and workers | One of each, on the measurement machine |
| Availability | Cache lifetime and revocation bound | `DATA_CONTEXT_CACHE_TTL_MS=0`: revocation shows on the next request; an access-service outage answers `503` |

The reference objectives add a 50% margin to the measurement (1 510 and 2 149 requests per second at
p95 of 13.4 and 9.4 ms). A deployment that declares more than its machine holds answers `503` when
full.

## Compatibility

The harness runs this repository's real gateway, access service and data service against a real
PostgreSQL server.

### Integration baseline

`compatibility.json` at the repository root owns the three service workspaces and the revision tested
against them ([spec §1.1](spec.md#11-integration-baseline)).

<!-- compatibility-manifest:start -->

```json
{
  "version": 2,
  "repository": "https://github.com/ggpwnkthx/platform.git",
  "workspaces": {
    "gateway": {
      "path": "packages/gateway",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "d3cdb48b79c3962e66bf51d8f386132baff824b7"
      }
    },
    "access": {
      "path": "packages/access",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "d3cdb48b79c3962e66bf51d8f386132baff824b7"
      }
    },
    "data": {
      "path": "packages/data"
    }
  }
}
```

<!-- compatibility-manifest:end -->

References, candidates and overrides work as in
[platform compatibility](../platform/internals.md#compatibility): here the gateway and access service
are references and the data service is the candidate. `bun run check:compatibility` proves the spec's
baseline block agrees with the manifest and refuses a CI workflow that pins its own revision.

### Harness

```bash
bun run --cwd packages/data test:compat   # data service harness
bun run compatibility                     # access-service contract and platform acceptance suites
GATEWAY_REPOSITORY=/srv/mirrors/gateway ACCESS_REPOSITORY=/srv/mirrors/access \
  bun run --cwd packages/data test:compat
```

Through the gateway, a client discovers a collection, creates a record under its own identity, reads
the fields it may read, updates with a current validator, observes the audit metadata, and proves
another tenant cannot reach the data.

Reference sources, in precedence order: `GATEWAY_REPOSITORY` and `ACCESS_REPOSITORY` (a git URL or a
local path, cloned without network), the `COMPAT_MIRROR` directory of bare `gateway.git` and
`access.git` mirrors, the local repository, then the manifest URL. A URL with or without `.git` names
the same mirror. `GATEWAY_COMMIT` and `ACCESS_COMMIT` must be full revisions (anything else is an
error, with no fallback). `COMPAT_KEEP` keeps the run's temporary directory.

### Access service extension

Without an access service answering `/v1/access-context`, the data service fails closed: the
extension is a required dependency, and it lives upstream
([decision 15](decisions.md#15-the-access-service-extension-lives-in-the-access-service)). To change
it, land the change in the access service workspace (keeping the gateway decision contract), then
pass the harness against the new revision.

### Signature fixtures

```bash
GATEWAY_CHECKOUT=/path/to/platform/gateway \
  bun run --cwd packages/data scripts/dev/generate-fixtures.ts
```

Gateway code at the repository revision produces the canonical payload and signature, and the fixture
records that revision. Legacy `v4` is included; since the gateway stopped signing it in `1.0.0`, only
its key derivation is kept locally.

### Platform release 1.0.0

A **MAJOR** change to the gateway and access-service contracts; the data service contract (`v1`
routes, `v5` identity, access context `1`), route table format, decision protocol and identity headers
are unchanged. Impact on the data service:

| Change | Impact |
| --- | --- |
| The gateway writes the caller subject as is (an unwritable one gets `500`). | Subjects are access-service UUIDs. The backend MUST NOT trim or normalize the header; the unit suite proves a subject the gateway did not write is refused. |
| The gateway decides the host before the method. | Bindings are per signed host; a deployment relying on a catch-all naming `GET` must move the hosts it names into the catch-all. |
| Gateway: `GATEWAY_TRUSTED_PROXY_HOPS` (default one), ranges only from `GATEWAY_TRUSTED_PROXIES`, password-free Redis user rules (passwords set after start). | Gateway deployment only. |
| Access service: tenant-scoped gateway credentials (deployment bearer token deprecated), platform-owned `shared_client` and `is_default` flags, limiter budget spent by failing calls, provider calls to the checked address, browser headers, uncached token answers. | None: the data service calls no decision endpoint or provider, holds no tenant, reads only the access context body, and its credential is scoped to the tenants it may ask about. |

## Release readiness

A gate is **done** when it is a repository fact (a running check, a published measurement, a written
decision) and **outside** when the repository cannot hold it. `1.0.0` is published but stays
pre-production until both outside gates are met. The suites make requirements **checked**, not
**proved**: the author wrote every check.

| Gate | State | Proof |
| --- | --- | --- |
| [Release gates](#release-gates) | Done | Every command passes. |
| Fuzzing and both differential tests | Done | Eight seeds each. |
| Client outside the repository, with bun and node | Done | `bun run check:client-package` |
| Service image built and started | Done | Image job in [CI](../../.github/workflows/ci.yml) |
| Baseline drift | Done | `bun run check:compatibility` |
| Backup and restore rehearsal | Done | `bash scripts/ops/rehearse-backup.sh`; [Operations](operations.md) |
| Capacity measurement | Done | [Capacity](#capacity) |
| Dependency audit | Done | `bun audit` in CI |
| A deployment with a real studio and tenant | **Outside** | Real traffic and an environment: a machine, a domain, a tenant and a person who answers the phone. |
| A review by someone other than the author | **Outside** | The [security review](#review), item by item. |

### Releasing

Follow the [platform release steps](../platform/internals.md#release); the tag's workflows publish the
image, binaries for seven platforms, the client and checksums. For the data service:

- Update `README.md`, `docs/data/README.md`, `CHANGELOG.md` and `docs/data/internals.md`: retire the
  pre-production wording, and write "proved" only where someone else's check proves it.
- `bun run release:tag` compares versions numerically (`0.10.0` is greater than `0.9.0`) and falls
  back to the workflow's release identity when the checkout has no committer identity.
- The changelog's "Unreleased" section lists client-visible changes: the database evaluates a write's
  predicate, legacy identity is refused by default, the client is on a registry and runs on node, and
  backup works with the deployment's roles.

## Security

The rules are [spec §2.3](spec.md#23-invariants) and [§6.4](spec.md#64-postgresql-isolation); this
section reviews them and everything around them.

> [!IMPORTANT]
> `1.0.0` has never run outside its own harness: no production history, no external users, no audit
> by anyone but the code's author. "Fixed" and "no finding" mean a check in this repository passes,
> nothing more.

### Review

Reviewed with no finding:

| # | Area | Where |
| --- | --- | --- |
| 1, 3–5 | Identity and routing: detached JWS rebuilt from the request, empty payload segment, `ES256` with the gateway's public key only. The binding, never a header, picks version, algorithm and key, with no fallback. Exact host, one matching binding, ambiguity refused at load; encoded separators, backslashes and dots are not workspaces; the path's workspace must equal the signature's. | `src/domains/gateway-context/` (`verify.ts`, `bindings.ts`, `index.ts`), `src/runtime/identity-keys.ts` |
| 6, 8 | Context validated, fresh per mutation, deadline rechecked before commit, `503` when absent. The registry reader sees five columns of one table (id, tenant, state, slug, name), by exact id. | `src/domains/authorization/access-context.ts`, `src/domains/authorization/adapters/access-context.ts`, `src/platform/postgres/adapters.ts` |
| 7, 18 | Forced row-level security, transaction-local scope. The API role cannot alter the schema, read deliveries or update the audit (insert and read only; no values). | `migrations/0002_platform.sql`, `migrations/0004_isolation.sql`, `src/platform/postgres/scoped.ts` |
| 9, 13–17 | Records: one in-statement projection for reads and writes; one complete policy, checked before and after a change; references readable in scope, refused generically; validators, receipts and lock-bounded key claims; signed cursors bound to caller, scope, query, versions and permissions; atomic mutations, with failure injected at every stage. | `src/domains/authorization/rules.ts`, `src/domains/records/service.ts`, `src/domains/records/canonical.ts`, `test/integration/transactions.test.ts` |
| 19–21 | Worker with its own principal, route and fresh context, and bounded chain depth; at-least-once delivery, recovering leases, deployment-registered subscribers; no undeclared tables; bundles published only by operator command. | `src/runtime/worker.ts`, `src/runtime/subscribers.ts`, `src/platform/postgres/adapters.ts`, `src/domains/catalog/index.ts`, `scripts/cli/policy.ts` |
| 22–25 | Every work bound, plus the authorization deadline before commit; secrets from files, never in image or log, redacted by the logger; metrics need their token (`404` without one); non-`root` image without shell or build tools, digest-pinned, built in CI. | `src/runtime/config.ts`, `src/domains/records/types.ts`, `src/observability/logger.ts`, `src/app/app.ts`, `Dockerfile`, `.github/workflows/ci.yml` |
| 35 | Version images (the first business values outside the record) are read under the record's policies; rollback is an authorized write; the API role cannot update or delete images, and retention belongs to the maintenance role. | `migrations/0008_record_versions.sql`, `src/domains/records/service.ts`, `src/domains/records/write-guard.ts` |

Fixed:

| # | Finding and fix | Where |
| --- | --- | --- |
| 1b | Subjects are read as is, never trimmed or normalized. | `src/domains/gateway-context/index.ts`, `test/unit/gateway-context.test.ts` |
| 2 | CI fuzzing: malformed, altered and payload-carrying signatures are refused without throwing. | `test/unit/fuzz.test.ts` |
| 3b | Symmetric `v4` can sign: refused unless `DATA_LEGACY_IDENTITY` allows it; removed in `2.0.0`. | `src/domains/gateway-context/bindings.ts`, `src/runtime/config.ts` |
| 10 | Memory compared numeric-looking text as numbers and strings by UTF-16 units; now by field type. | `src/domains/authorization/filter/compile.ts`, `src/domains/authorization/filter/evaluate.ts`, `test/integration/filter.property.test.ts` |
| 10b | The write statement evaluates the predicates; memory is the oracle. | `src/domains/records/write-guard.ts`, `test/integration/write-guard.test.ts` |
| 10c | Reads no longer evaluate predicates in memory. | `src/domains/records/service.ts` |
| 11 | Fuzzing proves no caller value or identifier reaches statement text. | `src/domains/authorization/filter/parse.ts`, `src/domains/authorization/filter/compile.ts`, `test/unit/fuzz.test.ts` |
| 12 | JSON lists are bound as text, not list literals. | `src/domains/authorization/filter/parse.ts` |
| 26 | CI fails on a known dependency vulnerability. | `.github/workflows/ci.yml` |
| 27 | The metrics token comparison leaked prefix length through timing; values are hashed first. | `src/app/secrets.ts` |
| 28 | Database failures answered `500`; SQLSTATE now maps to contract codes. | `src/platform/postgres/errors.ts` |
| 29 | A tampered cursor answered `500`; it now answers `400 INVALID_CURSOR`. | `src/domains/records/canonical.ts` |
| 30 | Failed statements leaked pool connections until every request got `503`. | `src/platform/postgres/scoped.ts` |
| 31 | The response budget was checked after building; now it is spent while building. | `src/domains/records/budget.ts`, `src/domains/records/service.ts` |
| 32 | The context cache was unbounded. | `src/domains/authorization/index.ts` |
| 33 | No per-tenant bound; now `429 TOO_MANY_REQUESTS`. | `src/runtime/limits.ts` |
| 34 | The mutation gate found five unproven behaviors, now covered. | `scripts/gates/mutation.ts` |

### Open findings

| # | Finding | Severity | State and plan |
| --- | --- | --- | --- |
| 1 | A write's predicate was evaluated twice (SQL for reads, memory for writes) and diverged three times. | Medium | **Closed** by [decision 5](decisions.md#5-one-policy-authorizes-a-write-and-the-database-evaluates-its-predicates); the generated guard check compares both answers. |
| 2 | Service availability is the access service's: with no cache, an outage answers `503` to every call. | Medium | **Open, with a decision.** A deployment preferring availability sets `DATA_CONTEXT_CACHE_TTL_MS` and declares the revocation bound (cache lifetime plus running request). The reference deployment declares no cache ([Capacity](#deployment-declaration)). |
| 3 | The driver reads timestamps in milliseconds while statements compare microseconds, so a sub-millisecond value compares differently on the two paths; likewise a JSON field holding JSON `null`. | Low | **Open, outside the contract.** API writes normalize to the millisecond; only rows written directly to the database, against the migration contract, are affected. |
| 4 | The service has never run outside its own harness; an author's check is not an assurance. | Medium | **Open.** `1.0.0` is marked pre-production. The first real deployment is the review the harness cannot replace. |
| 5 | Suites and code share assumptions; the mutation gate covers only imagined mutations. | Medium | **Open.** The gate runs in CI and grows with the code: each reviewed behavior has a mutation naming the suite that catches it, fourteen trust-boundary mutations so far. |
