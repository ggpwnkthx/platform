# Decisions

Data's contract and implementation decisions, each with its reason. The
[specification](spec.md) is normative for behavior; the decision process and table shape are in the
[platform decisions](../platform/decisions.md).

## Contract decisions

**Stated in** names the specification section that states each decision.

| # | Question | Decision | Stated in | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Is the service a studio? | No: it is headless; Studio is a separate project. | §1.3 | resolved | `src/app/app.ts`, `test/contract/http.test.ts` |
| 2 | Who owns identity and capabilities? | Access stays the authority for identity and capability assignment. | §5 | resolved | `src/domains/authorization/access-context.ts`, `test/contract/http.test.ts` |
| 3 | Where is the authentication boundary? | The gateway, through its existing signed-identity contract. | §4 | resolved | `src/domains/gateway-context/verify.ts`, `test/contract/http.test.ts` |
| 4 | What is the access context contract? | A new Access contract; stale role snapshots are not enough. | §5.2 | resolved | `src/domains/authorization/access-context.ts`, `test/integration/replicas.test.ts` |
| 5 | Where do workspaces and policies live? | Workspaces and data policy semantics belong to the backend. | §6 | resolved | `src/domains/workspaces/index.ts`, `test/contract/catalog.test.ts` |
| 6 | What is the first supported schema model? | PostgreSQL, reviewed migrations and registered manifests. | §7.1 | resolved | `migrations/`, `src/platform/postgres/migrations.ts` |
| 7 | What is the first transport? | REST, with metadata, OpenAPI and a small typed client. | §9 | resolved | `src/app/openapi.ts`, `packages/client/` |
| 8 | What is transactional? | Audit, committed events and creation receipts are part of a mutation's transaction. | §11 | resolved | `src/domains/audit/index.ts`, `test/integration/transactions.test.ts` |
| 9 | How do trusted subscribers receive? | With an explicit service-principal authority and at-least-once delivery. | §11.4 | resolved | `src/domains/events/index.ts`, `test/integration/worker.test.ts` |
| 10 | What is deferred? | Assets, content lifecycle, public realtime, workflow configuration, GraphQL, MCP and AI, and other database engines need later specifications. | §2.2 | resolved | `docs/data/spec.md` §2.2 |

## Implementation decisions

Choices the implementation made inside the contract.

### 1. The records domain builds its own SQL

Identifiers come from the manifest, values are bound, and the platform layer owns connections, scopes
and transactions. A query engine accepting outside statements would have to trust the domain's query
rules, which the specification forbids; the cost is a domain that knows SQL.

### 2. Read projection is built in the database

The statement adds a field to a row's payload only when a policy that matched the row grants it, so a
hidden value never leaves the database, at the cost of longer statements. It selects the page first
and projects only those rows; writes build the same projection, so a record's validator is identical
whether read or written (measurements: [Internals](internals.md#statement-shape-at-scale)).

### 3. Page order is the database's order

Nulls sort last in both directions, written `col asc nulls last` so the workspace-scope index serves
the order; the equivalent `((col is null))::int asc, col asc` forced a full sort per page. Cost: a
descending sort needs an index declared `desc nulls last` in the collection's reviewed migration.

### 4. Page position is a tuple, not an offset

The cursor holds the sort columns' values and null ranks, and continuation expands the tuple
comparison. An offset grows with the table and shifts on insert; a tuple is stable and bounded.

### 5. One policy authorizes a write, and the database evaluates its predicates

The write statement carries the `where` over the row before the change and the `check` over the row
after it, supplied as a CTE of bound parameters; in-memory evaluation stays as the oracle and as a
fast refusal. The two evaluations had diverged three times, and the generated guard check now fails
CI on divergence. Cost: two row images per write, and one more read of the locked row because the
database does not resolve a CTE inside an update's condition.

### 6. Idempotency keys are claimed with a waiting statement

The claim is `insert … on conflict do update … where false`, which waits for the transaction holding
the key (two-second lock timeout); `on conflict do nothing` does not always wait and could create two
records. Cost: an update privilege on receipts, limited to rows in the transaction's scope.

### 7. The access context is not cached by default

`DATA_CONTEXT_CACHE_TTL_MS` defaults to zero, so a revoked grant is visible on the next request, as
the specification requires. An enabled cache entry expires at the earlier of the announced validity
and the local lifetime, and revocation is then bounded by that lifetime plus the running request.

### 8. Transaction scope uses `set_config(…, true)`

`data.tenant_id`, `data.workspace_id` and `data.principal_id` are transaction-local, so a pooled
connection never carries another request's scope and table policies deny rows without them. The
setting is a scope, not a credential: callers never read it and it never goes over the wire.

### 9. Gateway identity is verified with a public key

The backend holds the gateway's public identity key, never `GATEWAY_SESSION_SECRET` or the private
key, so a verifier cannot mint identities and a compromised backend exposes no gateway session. The
legacy derived-key format stays readable for routes that name it explicitly, because switching
binding format and gateway key at once takes a deployment down.

### 10. The integration baseline is one checked file

`compatibility.json` holds the gateway and Access repositories and tested revisions, and the
drift check refuses docs or workflows that disagree or pin their own revision. Earlier baselines'
revisions stay in the release notes as historical evidence.

### 11. The workspace is read before the context exists

The registry reader may select five columns of one table (`id`, `tenant_id`, `status`, `slug` and
`display_name`) and only look a workspace up by exact id, because the tenant is needed before the
principal's context exists. It is the specification's narrowest exception and touches no business
table.

### 12. Events and audit are written by the domain in the mutation's transaction

The records service writes audit entry, event and receipt through the mutation's unit of work. Only
that transaction can make the four effects commit together, and failure injection at every stage
proves it.

### 13. Subscribers are registered in the composition root

Subscribers are code with a stable id and an event filter; the specification refuses uploaded plugins
and caller-defined handlers. The worker resolves a fresh service-principal context before every
command; the originating caller is only an attribution.

### 14. Page rows are bounded by the answer, not the page

The 4 MiB budget is checked while rows are encoded, and expansion is bounded before rows are
materialized, using one statement per relation and parent batch, never one per parent.

### 15. The Access extension lives in Access

The access context extension lives in `packages/access/`, `compatibility.json` pins the revision
carrying it, and Data keeps no copy that could rot. The harness proves the contract
against the real Access at that revision.

### 16. Tests run against a real PostgreSQL server

Integration tests and the compatibility harness start their own server, because isolation, locking
and worker claims are server behavior that an embedded engine cannot prove.

### 17. Null comparisons follow the database

Reads (SQL) and writes (memory) both use three-valued logic: only `_is_null` matches null. Text
compares bytewise (collation `C`; `'Zebra' < 'apple'` is true), UUID operands are lowercased and JSON
compares by content, and a differential test with a Unicode-collation column requires identical
answers from both engines.

### 18. Dependency and cache metrics are recorded by their owners

The Access client times its calls, the resolver counts cache hits and misses, the pool counts
connection waits, and the store counts rollbacks. Only the component that sees an event can count it
without guessing.

### 19. A workspace catalog is a logical registry over deployment tables

A workspace registers deployment collections and publishes its bundle; registration never creates or
names an undeclared table. This keeps the physical schema global, reviewed and drift-checked while the
logical schema is per workspace. Cost: one workspace cannot have a field another lacks without a
migration; a workspace that registered nothing serves every collection ([spec §7.5](spec.md#75-workspace-catalog)).

### 20. Bundle publication is an operator command, not an HTTP route

A publishing endpoint would be an authority outside Access: a tenant able to publish could
grant itself every field. The command uses schema-owner credentials on the operator's machine and
keeps a history that audit entries reference. Cost: tenants cannot change policies through the API; a
studio needing that requires an endpoint defined in Access.

### 21. Predicate negation keeps three-valued logic

`_not` of unknown is unknown, so `not (a = 1 and b = 2)` never matches when `b` is null; treating it
as false would let a caller write a record the read hides. Memory carries the third value explicitly,
and the differential test covers negation row by row.

### 22. The catalog is read with the workspace registry and carried by the context

One statement fetches the workspace and its catalog: a separate round trip cut read throughput to a
third, and the combined statement costs a tenth of a millisecond more. The context carries the
catalog, so every operation of a request sees the same versions. The resolved catalog is memoized by input fingerprint
([spec §7.5](spec.md#75-workspace-catalog)); an edited bundle has a new digest and is parsed again.

### 23. Search is a query parameter, not a filter operator

Database ranking and stemming have no in-memory equivalent, so search in a policy would authorize
writes by a rule reads do not apply. Searchable fields must be filterable and sortable by the caller,
and an integration test fails when the plan does not use the search index from the reviewed
migration.

### 24. Aggregates read what lists read, over filterable fields

An aggregate is a list statement with `group by`, over fields the caller may filter and sort, so it
discloses no distribution the caller could not query. Integer sums and averages stay decimals because
a big-integer sum may overflow, and truncation is always reported.

### 25. Database failures map to contract codes

One platform-layer table maps SQLSTATE to contract codes; unmapped states and service defects stay
internal errors, since hiding a defect behind a plausible answer is worse. Cost: the reason is the
error's cause, logged with the server state, not the response message.

### 26. A failing statement does not break its connection

A failed statement rolls back and leaves the connection usable; a connection failure destroys the
connection. Conflating them leaked connections: twenty failing writes exhausted the API pool and every
later request answered `503`.

### 27. The database measures answer size, and the budget is spent while building

The statement measures each payload piece and the answer is refused once 4 MiB is spent; checking only
the finished answer let a 4 MB answer cost 200 MB first. Expansion is read in chunks of about one
mebibyte sized by row size. Cost: pieces the policies do not grant are counted, so an answer near the
limit may be refused slightly early.

### 28. The context cache is bounded

Expired entries are dropped and the least recently used entry is evicted when full. The earlier
unbounded map leaked exactly while the cache was mitigating an Access outage.

### 29. Per-tenant bounds apply once the tenant is known

The listener bound answers `503 OVERLOADED`; the tenant bound, applied after signature verification
and registry lookup, answers `429 TOO_MANY_REQUESTS` with `Retry-After`, telling a crowding tenant it
is the problem. Cost: multi-tenant deployments must declare each tenant's room, and no bound can be
disabled.

### 30. The suites are broken on purpose and must notice

The mutation gate breaks the code and requires the suites to fail, because checks written by the
code's author may share its assumptions. It found five unproven behaviors (protected header type,
critical header, a row's fields, a collection bound, pool connection). Cost: one suite run per
mutation, and only imagined mutations are covered.

### 31. Version history is a typed mirror written by the change statement

The versions table mirrors the collection table plus history columns, and the change statement writes
the image, so record and history cannot disagree; reads apply the same predicates and rollback is an
ordinary write. Cost: the first surface holding business values, so it is deployment-declared,
migrated, retention-bounded and policy-read. Rejected: a trigger, which images every row whether or
not the service wrote it.

### 32. Development and CI use PostgreSQL 18; deployments may run 15 or later

Suites run against the newest major a deployment may meet, while the contract requires only 15 or
later because managed PostgreSQL lags. Cost: developers need 18 binaries or the container the
development runner starts; the test server script warns on another major and refuses another major's
data directory.

### 33. The records service is one class with its pure parts beside it

Record operations share one vocabulary (scope, collection, policies, context, answer budget), so they
stay in one class while `sql.ts`, `rows.ts` and `values.ts` hold the pure parts. Rejected: reader,
writer and history classes, which would need a base class holding most of the code. Cost: the
repository's longest file, kept honest by domain boundaries, the import matrix and the mutation gate.
