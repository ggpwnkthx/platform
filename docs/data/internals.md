# Internals

How Data is built, tested, measured and released, how it proves compatibility with the gateway and Access, and what its security review leaves open. This page is for maintainers of `packages/data/`.

## Architecture

Data is a headless modular monolith with an optional separate worker process and no user interface; splitting it into more services is not required. Studios, websites, scripts and services are all API clients, and none has a privileged database connection. Data never reads Access tables, never mints an identity (it holds only the gateway's public key), and never creates a session or runs a login flow ([spec §1.2](spec.md#12-ownership)).

### Code layout

| Path in `packages/data/` | Owns |
| --- | --- |
| `src/main.ts` | The process entry point. |
| `src/app/` | Hono routes, HTTP parsing, context establishment, response and error mapping. |
| `src/domains/<domain>/` | A domain's policies, use cases, ports, public entry point and tests. |
| `src/domains/<domain>/adapters/` | Concrete port implementations, assembled by the runtime. |
| `src/platform/bun/` | The listener, transport primitives and process APIs. |
| `src/platform/postgres/` | Connection lifecycle, scoped transactions, statement execution and migration mechanics. |
| `src/runtime/` | Configuration, composition root, subscribers, readiness, signals and drain. |
| `src/observability/` | Structured logs and metrics interfaces. |
| `src/protocol/` | Errors, clock and envelopes shared by domains. |
| `packages/client/` | The typed client ([Client](client.md)). |
| `manifests/` | This deployment's manifest and policy bundle. |
| `migrations/` | The reviewed SQL migrations. |
| `test/` | Contract, compatibility, database, load and architecture suites. |

Only `src/runtime/config.ts` reads environment variable names; everything else receives typed settings ([Configuration](configuration.md)).

### Domains and import rules

The required domains are `gateway-context`, `workspaces`, `schema`, `authorization`, `catalog`, `records`, `audit` and `events`, plus `model` for the workspace model.

| Domain | May import |
| --- | --- |
| `gateway-context`, `workspaces`, `schema`, `audit`, `events` | nothing |
| `authorization` | `gateway-context`, `workspaces`, `schema` |
| `catalog` | `schema`, `authorization`, `workspaces`, `model` |
| `model` | `schema` |
| `records` | `gateway-context`, `workspaces`, `schema`, `authorization`, `audit`, `events` |

1. A domain's core imports no Hono, no Bun API, no application handler, no runtime and no concrete adapter.
2. The application imports domains' public entry points, never their internals.
3. Only the composition root constructs concrete adapters.
4. Worker orchestration lives in the runtime and calls the domains' public use cases.
5. Audit and events accept primitive-typed envelopes and injected persistence ports, and do not import records.
6. A unit-of-work port lets records coordinate its repositories, audit sink and outbox without importing the concrete SQL adapters.
7. No cycle is allowed, including a type-only cycle, and no catch-all directory of shared implementations.

`bun run architecture` enforces the matrix and these rules, and `test/architecture` checks that the matrix names every domain.

### Request flow

1. The gateway signs the caller's identity into `x-gateway-signature`. Data rebuilds the canonical payload from method, path, query, host and headers and verifies it with the route's public key; it never trusts a transmitted payload.
2. One statement reads the workspace and its catalog (collections and policy bundle).
3. Access answers the principal's permission keys for subject, tenant, workspace and route, or a refusal, outside the business-data transaction.
4. The scoped transaction projects only granted fields, authorizes a write by one complete policy, and commits record, audit entry, domain event and receipt together ([spec §10](spec.md#10-mutations-and-transactions)).

### Storage

1. Deployments run PostgreSQL 15 or later; development, tests and CI use 18 ([decision 32](decisions.md#32-development-and-ci-use-postgresql-18-deployments-may-run-15-or-later)).
2. Business tables carry `tenant_id` and `workspace_id` under row-level security, scoped per transaction with `set_config(…, true)`.
3. There are five roles: migration owner, API runtime, registry reader, delivery and maintenance. The API never holds the credentials of the other four ([Operations](operations.md#database-roles)).
4. Tables come only from reviewed migrations. A declared history table mirrors its collection table and is written by the change statement ([spec §11.6](spec.md#116-record-version-history)).

### Catalog, model and events

1. The catalog (registered collections and policy bundle) is a logical registry over the global physical schema ([spec §7.5](spec.md#75-workspace-catalog)). It is read uncached, so a published bundle applies on the next request.
2. The model overlays the manifest in realtime ([spec §7.6](spec.md#76-workspace-model)). Its domain owns the model store, table column reader and workspace collection registrar ports.
3. Subscribers registered in the composition root receive each committed event at least once, possibly out of order. Workers claim deliveries with leases and act with a fresh context for their service principal; the originating user is only an attribution.

The process roles (`api`, `worker`, `all`) are described in [Operations](operations.md#process-roles).

## Development

Installation and the platform-wide commands are in [platform development](../platform/development.md).

### Test suites

| Suite | Command | Covers |
| --- | --- | --- |
| Domain rules | `bun test test/unit` | Predicates, field rules, write checks, schema validation, context expiry, identity, secrets, metrics. |
| API contract | `bun test test/contract` | Paths, envelopes, limits, error codes, ETags, receipts, aggregates, search, catalog, attack cases. |
| Database and worker | `bun test test/integration` | Row-level security, transactions, worker claims, replicas, differential tests, search plan. |
| Boundaries | `bun test test/architecture` | Imports, cycles, private adapter construction. |
| Suite strength | `bun run test:mutation` | Breaks code on purpose; the suites must notice. |
| Client | `bun test packages/client/test` | The client against a mocked API. |
| Platform | `bun run test:compat` | Real gateway, Access and Data. |

The differential tests (`test/integration/filter.property.test.ts` and `write-guard.test.ts`) compare generated predicates and write policies evaluated in memory and in the database. Fuzzing (`test/unit/fuzz.test.ts`) proves caller input never reaches a statement as an identifier. Integration tests start their own PostgreSQL 18 server ([decision 16](decisions.md#16-tests-run-against-a-real-postgresql-server)).

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

The operational gates come on top: the backup rehearsal, the capacity measurement, the declared rate and latency objective, and CI's dependency audit. The mutation gate is textual, so a refactor that moves a mutation's text must update the mutation, or the gate fails it as stale.

### Scripts

Operator commands run on the deployment machine. They are never HTTP routes and never bypass Access. Their credentials are listed in [Configuration](configuration.md#operator-commands).

| Directory | Commands |
| --- | --- |
| `scripts/cli/` | `provision.ts` (roles and database), `migrate.ts` (migrations as schema owner), `workspace.ts` and `collection.ts` (`create`/`register`, `enable`, `disable`, `list`), `policy.ts` (`publish`, `list`, `show`), `delivery.ts` (`list`, `requeue`, `backlog`), `retention.ts`. |
| `scripts/ops/` | `backup.sh`, `restore.sh`, `rehearse-backup.sh` (run with `bash` on a dedicated server), `capacity.ts`, `scale.ts`. |
| `scripts/compat/` | `compatibility.ts` (harness), `check-compatibility.ts` (baseline drift). |
| `scripts/gates/` | `architecture.ts`, `mutation.ts`, `check-client-package.ts` (packed client installed outside the repository). |
| `scripts/dev/` | `generate-client.ts` (types from the manifest), `generate-fixtures.ts` (signature fixtures). |

`bun run dead` finds unreachable modules, unread exported names and unused dependencies. `bun run release:tag` tags a release whose version increased.

To add a collection to this deployment, follow [Modeling](modeling.md#add-a-collection).

## Release acceptance

No requirement is complete until an automated check demonstrates its behavior.

| Suite | Required evidence |
| --- | --- |
| Domain | Predicate evaluation, field rules, write check composition, schema validation, context expiry and event envelope rules. |
| HTTP contract | Paths, envelopes, query limits, error codes, canonical ETags, create receipts, and the absence of deferred endpoints. |
| Gateway compatibility | The workspace's unmodified gateway forwards real `ES256`-signed requests that Data accepts with the public key; forged signatures, tampered identities and workspace mismatches fail; a current-format route refuses the legacy format. |
| Client packaging | The client tarball installs outside the repository, imports by its public name, and resolves its own files without the service's dependencies. |
| Baseline drift | The baseline manifest, the spec's baseline block and the workflows agree. |
| Access compatibility | The real context implementation returns the complete user and group key set and preserves the existing decisions contract. |
| PostgreSQL integration | Row-level security, composite reference constraints, refusal of a missing context, pool reuse, concurrent version checks, migration drift and role restrictions. |
| Transaction failure | A failure injected at every mutation stage leaves record, audit, event and receipt all committed or all absent. |
| Version history | A version image is written by the change statement; a change the guard refuses writes no image; a version the caller may not read is not found; the deployment's policies authorize a rollback. |
| Subscriber integration | Multi-worker claims, lease expiry, duplicate delivery, retry exhaustion, missing handlers, service principal revocation and causation depth bounds. |
| Architecture | Allowed imports, public entry points, no cycles and private adapter construction. |
| Dead code | Modules no root reaches, exported names nobody reads, and unused dependencies. |
| Operations and load | Deadlines cancel SQL, resources stay bounded, dependency failures fail closed, the drain completes, and the restore is rehearsed. |

Mandatory adversarial cases:

1. A grant for workspace A cannot read, write, count, reference or expand workspace B's data.
2. An Access grant for one tenant does not make another tenant's registered workspace accessible.
3. A forged tenant, forged route, e-mail address match or stale role claim cannot influence authorization.
4. Group removal, grant revocation and expiry, a disabled principal and a disabled tenant take effect within the documented freshness bounds.
5. Filtering and sorting by a hidden field are refused, and counts and relation expansions cannot bypass row policies.
6. Two policies with complementary field sets cannot authorize a synthetic write neither permits.
7. An update that moves a row outside its check is refused atomically.
8. Concurrent updates with one ETag yield one successful version change and one precondition refusal.
9. A version hidden by the deployment's policies is not found in the history, and a rollback they forbid is refused: history is not a path around authorization.
10. A `POST` retried after a committed but lost response creates one record and returns its original receipt.
11. Reusing a create key with another body cannot create another record within the retention window.
12. An expired or malformed Access context, wrong context identifiers and incomplete capability sets never allow a data operation.
13. A pooled connection never keeps a previous tenant, workspace or principal scope.
14. Runtime credentials cannot disable row-level security, alter the schema, edit audit history, or query Access's tables.
15. A subscriber cannot turn an actor's attribution into current authorization.
16. All backend functionality and API tests run without any Studio process or package.

## Capacity

`bun run scripts/ops/capacity.ts` starts PostgreSQL, a fixture Access, Data and concurrent clients that sign like the pinned gateway, then runs the scenarios of [spec §15.5](spec.md#155-capacity-and-rollout). Tune it with `CAPACITY_CLIENTS` (default 16) and `CAPACITY_DURATION_MS` (default 10000 per scenario). The numbers describe one machine at one moment; a deployment measures its own with the same command.

| Machine | Value |
| --- | --- |
| Hardware | 16 cores, x86_64, 31 GiB, Linux 7.2.9, Bun 1.4.3 |
| Database | PostgreSQL 18.6 on the same machine, `fsync=off` and `synchronous_commit=off` |
| Deployment | One api process, `DATA_DB_POOL_MAX=20`, registry and delivery pools of 5 |
| Context cache | `DATA_CONTEXT_CACHE_TTL_MS=0`: every request asks Access |
| Catalog | The workspace registered nothing; the deployment catalog is read with the registry in one statement |
| Data | 1000 articles in one workspace, one policy per action, pages of 50 |

### Results

Release candidate `1.0.0`, guarded write path:

| Scenario | Requests | Rate | p50 | p95 | p99 | Failures |
| --- | --- | --- | --- | --- | --- | --- |
| Read heavy, a page of 50 | 15102 | 1510/s | 10.4 ms | 13.4 ms | 15.5 ms | 0 |
| Mixed, half creations | 21491 | 2149/s | 7.3 ms | 9.4 ms | 10.7 ms | 0 |
| Concurrent updates of one record | 6011 | 601/s | 26.6 ms | 30.9 ms | 33.8 ms | 0 (379 successes, 5632 precondition failures) |
| Access down | 62617 | 6262/s | 2.5 ms | 3.2 ms | 4.6 ms | 62617 answers 503 |

1. Reads hold up with a context fetch per request: the fetch precedes the statement and is the cheap part.
2. No update is lost: an update without the current validator gets `412 PRECONDITION_FAILED`, and its latency is the row lock's.
3. With Access down, requests fail closed in about two milliseconds (`503 AUTHORIZATION_UNAVAILABLE`), with no queue.
4. Version `1.0.0` on PostgreSQL 15.19 measured 991/s, 1251/s, 313/s and 4280/s (p50 15.8, 11.6, 50.8 and 3.6 ms). Runs on different database versions are not comparable.
5. Three consecutive read-heavy runs gave 1510/s, 1571/s and 1371/s, a spread of about a fifth.

### Statement shape at scale

`bun run scripts/ops/scale.ts` writes a million-row collection, reads a page statement's plan, walks every page and compares the rows with those of a single statement. Pages are selected first and projected afterwards ([decision 2](decisions.md#2-read-projection-is-built-in-the-database)), in an index order ([decision 3](decisions.md#3-page-order-is-the-databases-order)).

| Collection | Plan before | Plan now | Page time |
| --- | --- | --- | --- |
| 200 000 rows | Sequential scan, sort of the whole scope, projection of every row | Index scan of the page, 51 lookups | 97 ms → 0.9 ms |
| 1 000 000 rows | The same, three times the rows | The same plan | 0.9 ms |

The walk over 200 000 rows read 4 000 pages, every row, in database order. Sorting or filtering on a field needs that field's index in the collection's reviewed migration.

Not measured:

1. Several replicas: reads scale with replicas, writes with the database.
2. Worker capacity: integration tests cover claims, leases and retries; watch `data_outbox_backlog` and `data_outbox_oldest_age_seconds`.
3. Maximum bounds (a 200-record page, a 50-predicate filter or a 1000-row expansion): contract tests check them and refuse an excess with `422 RESULT_TOO_LARGE`.

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
| Availability | Cache lifetime and revocation bound | `DATA_CONTEXT_CACHE_TTL_MS=0`: revocation shows on the next request; an Access outage answers `503` |

The reference objectives add a 50% margin to the measurement (1 510 and 2 149 requests per second at a p95 of 13.4 and 9.4 ms). A deployment that declares more than its machine holds answers `503` when full.

## Compatibility

The harness runs this repository's real gateway, Access and Data against a real PostgreSQL server.

### Integration baseline

`compatibility.json` at the repository root names the three service workspaces and the revision they are tested against ([spec §1.1](spec.md#11-integration-baseline)).

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
        "commit": "dc3d421a5f490594fe012d04eaaef21733736563"
      }
    },
    "access": {
      "path": "packages/access",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "dc3d421a5f490594fe012d04eaaef21733736563"
      }
    },
    "data": {
      "path": "packages/data"
    }
  }
}
```

<!-- compatibility-manifest:end -->

References, candidates and overrides work as described in [platform compatibility](../platform/internals.md#compatibility): here the gateway and Access are references and Data is the candidate. `bun run check:compatibility` proves the spec's baseline block agrees with the manifest, and refuses a CI workflow that pins its own revision.

### Harness

```bash
bun run --cwd packages/data test:compat   # Data harness
bun run compatibility                     # Access contract and platform acceptance suites
GATEWAY_REPOSITORY=/srv/mirrors/gateway ACCESS_REPOSITORY=/srv/mirrors/access \
  bun run --cwd packages/data test:compat
```

Through the gateway, a client discovers a collection, creates a record under its own identity, reads the fields it may read, updates with a current validator, observes the audit metadata, and proves another tenant cannot reach the data.

The harness takes each reference's source from the first of these that is available:

1. `GATEWAY_REPOSITORY` and `ACCESS_REPOSITORY`: a git URL or a local path, cloned without network,
2. the `COMPAT_MIRROR` directory of bare `gateway.git` and `access.git` mirrors,
3. the local repository,
4. the manifest URL.

A URL with or without `.git` names the same mirror. `GATEWAY_COMMIT` and `ACCESS_COMMIT` must be full revisions; anything else is an error, with no fallback. `COMPAT_KEEP` keeps the run's temporary directory.

### Access extension

Without Access answering `/v1/access-context`, Data fails closed: the extension is a required dependency, and it lives upstream ([decision 15](decisions.md#15-the-access-extension-lives-in-access)). To change it, land the change in the Access workspace (keeping the gateway decision contract), then pass the harness against the new revision.

### Signature fixtures

```bash
GATEWAY_CHECKOUT=/path/to/platform/gateway \
  bun run --cwd packages/data scripts/dev/generate-fixtures.ts
```

Gateway code at the repository revision produces the canonical payload and signature, and the fixture records that revision. Legacy `v4` is included; since the gateway stopped signing it in `1.0.0`, only its key derivation is kept locally.

### Platform release 1.0.0

Platform release `1.0.0` is a major change to the gateway and Access contracts. The Data contract (`v1` routes, `v5` identity, access context `1`), the route table format, the decision protocol and the identity headers are unchanged. Impact on Data:

| Change | Impact |
| --- | --- |
| The gateway writes the caller subject as is (an unwritable one gets `500`). | Subjects are Access UUIDs. Data never trims or normalizes the header, and the unit suite proves a subject the gateway did not write is refused. |
| The gateway decides the host before the method. | Bindings are per signed host; a deployment relying on a catch-all naming `GET` must move the hosts it names into the catch-all. |
| Gateway: `GATEWAY_TRUSTED_PROXY_HOPS` (default one), ranges only from `GATEWAY_TRUSTED_PROXIES`, password-free Redis user rules (passwords set after start). | Gateway deployment only. |
| Access: tenant-scoped gateway credentials (deployment bearer token deprecated), platform-owned `shared_client` and `is_default` flags, limiter budget spent by failing calls, provider calls to the checked address, browser headers, uncached token answers. | None: Data calls no decision endpoint or provider, holds no tenant, reads only the access context body, and its credential is scoped to the tenants it may ask about. |

## Release readiness

A gate is done when it is a repository fact (a running check, a published measurement, a written decision), and outside when the repository cannot hold it. `1.0.0` is published but stays pre-production until both outside gates are met. The suites make requirements checked, not proved: the author wrote every check.

| Gate | State | Proof |
| --- | --- | --- |
| [Release gates](#release-gates) | Done | Every command passes. |
| Fuzzing and both differential tests | Done | Eight seeds each. |
| Client outside the repository, with bun and node | Done | `bun run check:client-package` |
| Service image built and started | Done | Image job in [CI](../../.github/workflows/ci.yml) |
| Baseline drift | Done | `bun run check:compatibility` |
| Backup and restore rehearsal | Done | `bash scripts/ops/rehearse-backup.sh`; [Operations](operations.md#rehearse-backup-and-restore) |
| Capacity measurement | Done | [Capacity](#capacity) |
| Dependency audit | Done | `bun audit` in CI |
| A deployment with a real studio and tenant | **Outside** | Real traffic and an environment: a machine, a domain, a tenant and a person who answers the phone. |
| A review by someone other than the author | **Outside** | The [security review](#review), item by item. |

### Releasing

Follow the [platform release steps](../platform/internals.md#release). The tag's workflows publish the image, binaries for seven platforms, the client and checksums. For Data:

1. Update `README.md`, `docs/data/README.md`, `CHANGELOG.md` and `docs/data/internals.md`: retire the pre-production wording, and write "proved" only where someone else's check proves it.
2. `bun run release:tag` compares versions numerically (`0.10.0` is greater than `0.9.0`) and falls back to the workflow's release identity when the checkout has no committer identity.
3. The changelog's "Unreleased" section lists client-visible changes: the database evaluates a write's predicate, legacy identity is refused by default, the client is on a registry and runs on node, and backup works with the deployment's roles.

## Security

The rules are [spec §2.3](spec.md#23-invariants) and [§6.4](spec.md#64-postgresql-isolation). This section reviews them and everything around them.

> [!IMPORTANT]
> `1.0.0` has never run outside its own harness: no production history, no external users, no audit by anyone but the code's author. "Fixed" and "no finding" mean a check in this repository passes, nothing more.

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
| 2 | Service availability is Access's: with no cache, an outage answers `503` to every call. | Medium | **Open, with a decision.** A deployment preferring availability sets `DATA_CONTEXT_CACHE_TTL_MS` and declares the revocation bound (cache lifetime plus running request). The reference deployment declares no cache ([Capacity](#deployment-declaration)). |
| 3 | The driver reads timestamps in milliseconds while statements compare microseconds, so a sub-millisecond value compares differently on the two paths; likewise a JSON field holding JSON `null`. | Low | **Open, outside the contract.** API writes normalize to the millisecond; only rows written directly to the database, against the migration contract, are affected. |
| 4 | The service has never run outside its own harness; an author's check is not an assurance. | Medium | **Open.** `1.0.0` is marked pre-production. The first real deployment is the review the harness cannot replace. |
| 5 | Suites and code share assumptions; the mutation gate covers only imagined mutations. | Medium | **Open.** The gate runs in CI and grows with the code: each reviewed behavior has a mutation naming the suite that catches it, fourteen trust-boundary mutations so far. |
