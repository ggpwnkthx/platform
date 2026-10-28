# Decisions

Contract and implementation decisions of the data service, with the reason for each. The
[specification](spec.md) is normative for behavior.

How contract-changing decisions are made, and the shape of the table below, are defined in the
[platform decisions](../platform/decisions.md).

## Contract decisions

**Stated in** names the specification section that states each decision.

| # | Question | Decision | Stated in | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Is the service a studio? | No: the service is headless; Studio is a separate project. | §1.3 | resolved | `src/app/app.ts`, `test/contract/http.test.ts` |
| 2 | Who owns identity and capabilities? | The access service stays the authority for identity and capability assignment. | §5 | resolved | `src/domains/authorization/access-context.ts`, `test/contract/http.test.ts` |
| 3 | Where is the authentication boundary? | The gateway stays the authenticated boundary; integration uses its existing signed-identity contract. | §4 | resolved | `src/domains/gateway-context/verify.ts`, `test/contract/http.test.ts` |
| 4 | What is the access context contract? | A new access-service access context contract is required; stale role snapshots are not enough. | §5.2 | resolved | `src/domains/authorization/access-context.ts`, `test/integration/replicas.test.ts` |
| 5 | Where do workspaces and policies live? | Workspaces and data policy semantics belong to the backend. | §6 | resolved | `src/domains/workspaces/index.ts`, `test/contract/catalog.test.ts` |
| 6 | What is the first supported schema model? | PostgreSQL, reviewed migrations and registered manifests. | §7.1 | resolved | `migrations/`, `src/platform/postgres/migrations.ts` |
| 7 | What is the first transport? | REST, with metadata, OpenAPI and a small typed client. | §9 | resolved | `src/app/openapi.ts`, `packages/client/` |
| 8 | What is transactional? | Audit, committed events and creation receipts are the transactional parts of a mutation's correctness. | §11 | resolved | `src/domains/audit/index.ts`, `test/integration/transactions.test.ts` |
| 9 | How do trusted subscribers receive? | With an explicit service-principal authority and at-least-once delivery. | §11.4 | resolved | `src/domains/events/index.ts`, `test/integration/worker.test.ts` |
| 10 | What is deferred? | Assets, content lifecycle, public realtime, workflow configuration, GraphQL, MCP and AI, and other database engines need later specifications. | §2.2 | resolved | `docs/data/spec.md` §2.2 |

## Implementation decisions

Choices the implementation made inside the contract.

### 1. The records domain builds its own SQL

Identifiers come from the manifest and values are bound parameters; the platform layer owns
connections, scopes and transactions. Query rules (visible fields, rows a policy covers, paging) are
domain rules, and a query engine that accepted outside statements would have to trust them, which the
specification forbids. Cost: the domain knows SQL. The alternative puts one rule in two places.

### 2. Read projection is built in the database

The statement assembles each row's payload, adding a field only when a policy that matched the row
grants it, so a value the caller may not see never leaves the database. This is the only way to meet
the specification's no-materialization rule without an extra round trip per row. Cost: longer
statements.

- **The projection covers the page, not the scope.** The statement first selects the page (ids,
  order, limit), then builds payloads for those rows. Projecting the whole scope cost 97 ms per
  50-row page at 200,000 rows, against 0.9 ms for the page alone.
- **Writes build the same projection.** The statement that locks a written row computes the read
  policy flags with the same compiler, and the representation is built from them. A record's
  validator is identical whether read or written, and the database decides which policies match.
  Previously the write path rebuilt the representation in memory, evaluating the predicates a second
  time: one rule in two places, and two implementations behind one validator.

### 3. Page order is the database's order

The service sorts nulls last in both directions, written as `col asc nulls last`; the cursor position
keeps each value's null rank. The equivalent `((col is null))::int asc, col asc` is not recognised as
an index order, so the database read and sorted the whole scope per page; `col asc nulls last` uses
the workspace-scope index. The null rank stays in the cursor because continuation must compare nulls
with the position's nulls.

Cost: a descending sort needs an index the deployment declares `desc nulls last` (the default column
index is `asc nulls first` for the descending direction). Indexes belong in the collection's reviewed
migration.

### 4. Page position is a tuple, not an offset

The cursor holds the sort columns' values and their null ranks; continuation is the explicit
expansion of the tuple comparison. An offset grows with the table and shifts on insert; a tuple is
stable and bounded. The null rank is part of the tuple because PostgreSQL sorts nulls last in both
directions and continuation must match the order.

### 5. One policy authorizes a write, and the database evaluates its predicates

Policy predicates compile to SQL for both reads and writes. The write statement carries the `where`
over the row before the change and the `check` over the row after it, the latter supplied as a common
table expression of bound parameters. In-memory evaluation remains as the oracle and as a fast path
that refuses a write before it touches the database.

The two evaluations previously lived apart and diverged three times before comparison was made by
field type. One implementation fixes that. The generated guard check compares both answers on
predicates not written by hand, so divergence fails CI instead of surprising a deployment.

Cost: the write statement carries two row images. The database does not resolve a CTE inside an
update's condition, so the condition is a subquery over the expressions; the write reads the locked
row once more.

### 6. Idempotency keys are claimed with a waiting statement

The claim is `insert … on conflict do update … where false`: it waits for the transaction holding the
key, bounded by a two-second lock timeout. `on conflict do nothing` does not always wait, and a
duplicate answered before the first commit would create two records. Cost: an update privilege on
receipts, limited to rows in the transaction's scope.

### 7. The access context is not cached by default

`DATA_CONTEXT_CACHE_TTL_MS` defaults to zero. An operator may enable read caching; an entry expires at
the earlier of the validity the access service announced and the local lifetime. The specification
allows 0 to 5000 ms and requires no cache by default, so a revoked grant is visible on the next
request. A revocation's bound is the cache lifetime plus the running request's duration.

### 8. Transaction scope uses `set_config(…, true)`

`data.tenant_id`, `data.workspace_id` and `data.principal_id` are transaction-local. A pooled
connection never carries another request's scope, and table policies deny rows when the settings are
missing. The setting is a scope, not a credential: callers never read it and it never goes over the
wire.

### 9. Gateway identity is verified with a public key

The backend holds the gateway's **public** identity-signing key, never `GATEWAY_SESSION_SECRET` or
the gateway private key. The legacy format, which derives the signing key from the session secret, is
still readable as a migration path for deployments sharing a key with their gateway, and a route must
name it explicitly.

The derived key kept the two secrets apart and sufficed while the trust boundary was the gateway's
network, but any upstream that could verify an identity could also mint one. With a public key the
boundary is the key: verifiers cannot mint, the backend holds no gateway secret, and a compromised
backend does not expose gateway sessions. The legacy format stays readable because switching the
binding format and the gateway key at the same moment takes a deployment down; the route names its
format, so the two never mix.

### 10. The integration baseline is one checked file

Gateway and access-service repositories and tested revisions live in `compatibility.json`; the
baseline docs and workflows read it. A pin written twice drifts. The drift check compares the
specification's baseline block with the manifest and refuses workflows with their own revision.
Earlier baselines' revisions stay in the release notes as historical evidence, not as the active
baseline.

### 11. The workspace is read before the context exists

The registry reader may select three columns of one table and only look a workspace up by exact id.
The request scope is the workspace, whose tenant is needed before the principal's context exists.
This reader is the specification's narrowest exception and touches no business table.

### 12. Events and audit are written by the domain in the mutation's transaction

The records service writes the audit entry, event and receipt through the mutation's unit of work.
The specification requires the four effects to commit together or not at all; only the mutation's
own transaction can guarantee that, and only failure injection at every stage proves it.

### 13. Subscribers are registered in the composition root

Subscribers are code with a stable id and an event filter; the worker resolves a fresh
service-principal context before every command. The specification requires trusted subscribers and
refuses uploaded plugins and caller-defined handlers. A subscriber's authority is the service
principal's; the originating caller is an attribution.

### 14. Page rows are bounded by the answer, not the page

The 4 MiB budget is checked while rows are encoded, and relation expansion is bounded before rows are
materialized. A limit checked after the page is built is not a limit. Expansion uses one statement
per relation and parent batch, never one per parent.

### 15. The access-service extension lives in the access service

The access context contract extension is an access-service change taken upstream: it lives in
`packages/access/`, `compatibility.json` pins the platform revision that carries it, and the data
service keeps no copy. Gateway and access service are platform contracts; a patch reviewed against a
pinned revision is reviewable, a fork is not, and a local copy would be a second source of truth that
rots. The compatibility harness proves the contract against the real access service at the pinned
revision.

### 16. Tests run against a real PostgreSQL server

Integration tests and the compatibility harness start their own server. Isolation, locking and
worker claims are server behavior; an embedded engine proves only domain rules, and the specification
requires server-level checks.

### 17. Null comparisons follow the database

Reads compile predicates to SQL and writes evaluate them in memory; both use the database's
three-valued logic. A comparison with null is unknown and never matches; only `_is_null` matches null.
Otherwise a policy reading records whose body differs from a value would let a caller write a
null-body record the read hides, and the service would contradict itself within one request.

- **Text compares by bytes**, not database locale: the compiler emits collation `C` on text columns,
  and memory compares code units. Under a locale collation `'Zebra' < 'apple'` is false, while bytewise
  it is true.
- **Database normalizations live in the parser**: UUID operands are lowercased, and JSON compares by
  content, not key order.
- **A differential test** runs the same predicates on the same rows in memory and on the server and
  requires identical answers. Its fixture includes a Unicode-collation column, proving the compiler
  does not depend on the deployment's collation, and that a change to either engine keeps a policy's
  meaning.

### 18. Dependency and cache metrics are recorded by their owners

The access-service client records its calls and their duration; the resolver records context cache
hits and misses; the pool records connection waits; the store records rolled-back transactions. Only
the component that sees the event can count it without guessing, and the specification requires
access-service duration, cache hits and rollbacks.

### 19. A workspace catalog is a logical registry over deployment tables

A workspace registers the deployment collections it serves and publishes its policy bundle.
Registration never creates a table or names one the deployment does not declare.

The physical schema is the service's strongest property: tables come from reviewed migrations that
also define their isolation, the API role cannot alter them, and readiness refuses drift between
manifest and schema. Per-tenant tables would give that up (isolation policies written at runtime on
undescribed tables, nothing to check drift against). The registry keeps the physical schema global
and makes the *logical* schema per workspace, which is what platform customers ask for.

Cost: one workspace cannot have a field another lacks. Deployment tables are the platform
vocabulary; a different vocabulary needs a migration, keeping review where it belongs. A workspace
that registered nothing serves every deployment collection ([spec](spec.md) §7.5).

### 20. Bundle publication is an operator command, not an HTTP route

Policy bundles are published by an operator command on the deployment machine; no endpoint writes a
bundle. A bundle defines what a permission grants, so a publishing endpoint would be an authority
outside the access service: a tenant able to publish could grant itself every field of every
collection, and workspace isolation would hold only while that endpoint stayed closed. The command
uses schema-owner credentials, runs on the operator's machine, and keeps a publication history that
record audit entries reference. Principal grants stay with the access service.

Cost: tenants cannot change their policies through the API. A studio editing workspace policies will
need an endpoint with its own authority, defined in the access service, not the deployment.

### 21. Predicate negation keeps three-valued logic

`_not` negates a whole predicate, and negating unknown gives unknown, so a negated comparison never
matches a null row. Memory evaluation carries the third value explicitly; SQL carries it natively.
Negation is the first operator that forces unknown to be a distinct value: `not (a = 1 and b = 2)` is
unknown when `b` is null, and treating it as false would let a caller write a record the read hides.
The differential test covers negation against a real server, row by row.

### 22. The catalog is read with the workspace registry and carried by the context

The registry reader fetches the workspace **and** its catalog registry in one statement, and the
application puts the resolved catalog in the context that domain operations receive. The records
service uses the context's manifest and bundle and never resolves them itself.

- The registry is on every request's path (the tenant is needed before asking the access service). A
  separate catalog round trip would double the load on the registry pool, the smallest in the
  deployment; measured, it cut read-path throughput to a third. The combined statement costs a tenth
  of a millisecond more.
- The catalog is the same for every operation of a request: a bundle published mid-request does not
  change that request, and its cursors, audit entries and statements all name the same versions.
- The resolved catalog is memoized in-process, keyed by an input fingerprint ([spec](spec.md) §7.5).
  This removes bundle parsing from the request path without weakening the guarantee: a bundle edited
  in the database has a new digest and is parsed again, and refused if unusable.

### 23. Search is a query parameter, not a filter operator

Search is the `search` parameter of lists and aggregates. Policy predicates are evaluated both in SQL
(reads) and in memory over the locked row (writes), and the differential test proves the two agree.
Database ranking and stemming have no in-memory equivalent, so a policy using text search would
authorize writes by a rule reads do not apply. Search therefore never reaches a policy predicate.

- Searchable fields are deployment-declared and must be fields the caller may filter and sort by;
  searching a hidden field would disclose it, as sorting by it would.
- The search index belongs to the collection's reviewed migration, and its expression must equal the
  search statement's expression. Otherwise the database silently falls back to a table scan with the
  same results. The integration test reads the query plan and fails when the index is unused.

### 24. Aggregates read what lists read, over filterable fields

An aggregate is a list statement with `group by`: same scope, same disjunction of read predicates,
same caller filter. Group and metric fields must be filterable and sortable by the caller. An
aggregate over other rows would be a privileged query path, which the specification refuses; a
caller who may not filter by a field may not learn its distribution either.

Integer sums and averages are decimals as the database returns them, since a big-integer sum may not
fit a big integer. Group count is bounded, and the answer says when it is truncated; a silent
truncation would be a lie.

### 25. Database failures map to contract codes

The PostgreSQL driver reports the server's SQLSTATE; one table in the platform layer maps it to a
contract code, and the domain never sees server states. A lock timeout is `409 CONFLICT`, not an
internal error; a statement over budget is `504 DEADLINE_EXCEEDED`. The mapping is conservative:
unmapped states stay untranslated, and service defects (unparseable statement, missing column) stay
internal errors, because hiding a defect behind a plausible answer is worse than an obviously wrong
one.

Cost: the failure reason is the error's cause, not its message. The response carries the code's safe
summary; the log carries the server state.

### 26. A failing statement does not break its connection

A failed statement (violated constraint, lock not granted) leaves the connection usable: the
transaction rolls back and the session is clean. A connection failure leaves session state unknown,
so that connection must not return to the pool.

The two used to be conflated: a failing statement's connection was neither returned nor destroyed,
just lost. Twenty failing writes exhausted the API pool and every later request answered `503`. Tenant
isolation relies on that pool, and a client who can drain it with twenty bad requests can do so with
twenty thousand.

Cost: a broken connection is destroyed and replaced, so a network failure costs a pool connection,
not a request.

### 27. The database measures answer size, and the budget is spent while building

The contract's 4 MiB bounds service resources, not just outgoing bytes. The statement that builds a
row measures each payload piece, the budget is spent as the answer is built, and the answer is
refused once it is exhausted. Checking only the finished answer bounded output but not memory: a
4 MB answer could cost 200 MB before refusal. Measuring in the database costs the hot path nothing;
the process never serializes a row to size it.

- **Relation expansion is read in chunks** targeting one mebibyte, sized by row size (small rows, big
  chunks; large rows, small chunks). A page's relation is read in one statement, not one per root
  row; previously expansion was one query per page row, bounded at a thousand rows per root record.
- **Cost:** the measure counts pieces the policies do not grant, so the budget is an upper bound on
  answer size; an answer just under the limit may be refused slightly early.

### 28. The context cache is bounded

Expired entries are dropped, and the least recently used entry is evicted when full. The cache
mitigates access-service unavailability for deployments that prefer availability over instant
revocation. It used to be an unbounded map, swept only when the same key was asked again; a
mitigation that grows without bound is a leak, and it leaks exactly when the mitigation is in use.

### 29. Per-tenant bounds apply once the tenant is known

The listener bound is the machine's and answers `503 OVERLOADED`. The tenant bound applies after
gateway signature verification and registry lookup and answers `429 TOO_MANY_REQUESTS` with
`Retry-After`. The first says the service is full; the second says the caller sends too much. A tenant
crowding out others should learn it is the problem, not that the service is broken.

Cost: a tenant's room is the whole process until the deployment declares otherwise; single-tenant
deployments need nothing, multi-tenant ones declare each tenant's room. A bound cannot be disabled:
the specification refuses a bound that zero turns off.

### 30. The suites are broken on purpose and must notice

The mutation gate breaks the code deliberately and checks that the suites fail. A surviving mutation
is behavior nothing in the repository proves. Every check here was written by the code's author, and
a check sharing the code's assumptions proves nothing. The gate does not replace independent review,
but it found five unproven behaviors: the signature's protected header type, the critical header, a
row's fields, a collection bound, and the pool connection.

Cost: the gate is slow (one suite run per mutation), covers only mutations someone thought of, and an
equivalent mutation (a defect already covered by another) survives meaninglessly.

### 31. Version history is a typed mirror written by the change statement

A collection with history declares its versions table in the manifest. That table mirrors the
collection table (same columns, names and types) plus history columns. The change statement writes
the image itself (the change is a CTE and the image insert reads it). Rollback is an ordinary update,
or an ordinary creation for a deleted record.

Version authorization equals record authorization: the database evaluates read predicates over the
image, and hidden fields are omitted. A JSON-document history would need in-memory evaluation, which
decision 5 removed from the write path. History written by a separate statement could disagree with
the record (a change committed without its image, or an image of a refused change).

Cost: the versions table is the first surface holding business values. It is deployment-declared,
created by reviewed migration, bounded by retention and read under deployment policies. Rollback is
not privileged: a forbidden version write is refused, and the record version never moves back.

Rejected: a database trigger would write images without service involvement and catch script and
worker writes, but it images every row and the service would not know which rows it wrote, making
history depend on whichever paths reach the database. The service writes, and knows, what it changed.

### 32. Development and CI use PostgreSQL 18; deployments may run 15 or later

Local development, integration tests, the compatibility harness and CI run PostgreSQL 18. The service
requires no particular major: deployments may run 15 or later, and deployment scripts check their
client version against the server. Suites prove one version's semantics, so they run against the
newest major a deployment may meet, catching version differences before a deployment does.

Cost: developers need version 18 binaries and CI installs them (the runner lacks them); the
development stack's database image is also 18. Without local binaries the server starts in a
version 18 container, which the development runner stops when it stops. The test server script warns
on another local major and refuses a data directory from another major, since an 18 server will not
start on 15 files and the server's own error is not the message a developer needs.

Rejected: requiring 18 in the `1.0.0` contract. Managed PostgreSQL lags the newest major by months,
and the requirement would exclude managed-database deployments. It belongs to developer machines,
not the deployment contract.

### 33. The records service is one class with its pure parts beside it

The records service is one class in one file. Read statements, row mapping and value comparison live
in `sql.ts`, `rows.ts` and `values.ts`, where they can be read, compared and proved alone. Record
operations share one vocabulary (scope, collection, deployment policies, request context, answer
budget). Splitting into reader, writer and history would push that vocabulary into a base class
holding most of the code, with boundaries following operation names rather than work. Parts outside
the shared vocabulary are split out.

Cost: the service file is the repository's longest, and finding an operation means walking it. Domain
boundaries, the import matrix and the mutation gate keep it honest.

Rejected: three classes, because every operation uses the shared helpers and the required base class
would hold the code the split meant to divide.
