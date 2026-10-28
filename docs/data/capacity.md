# Capacity

The release's capacity report: numbers measured by `bun run scripts/ops/capacity.ts` on the machine
described below ([Specification](spec.md) §15.5). They are **not** a promise about any other machine:
a deployment declares its own request rate and latency objective and measures them with the same
command on its own hardware.

## Method

The command starts a complete local deployment: a PostgreSQL server, a fixture access service, the
backend and a set of concurrent clients. The clients speak the gateway protocol: like the pinned
gateway, they sign requests with the identity pair's private key, and the backend verifies with the
public key.

```bash
bun run scripts/ops/capacity.ts
```

The scenarios come from the specification: read-heavy traffic with no context cache, mixed
creations and reads, concurrent updates of one record, and an authorization dependency failure.

Tune it with the environment:

| Variable | Default | What it changes |
| --- | --- | --- |
| `CAPACITY_CLIENTS` | 16 | The number of the concurrent clients. |
| `CAPACITY_DURATION_MS` | 10000 | The duration of every scenario. |

## Measurement machine

| | |
| --- | --- |
| The processor | 16 cores, x86_64 |
| The memory | 31 gibibytes |
| The kernel | Linux 7.2.9 |
| The runtime | Bun 1.4.3 |
| The database | PostgreSQL 18.6, on the same machine, `fsync=off` and `synchronous_commit=off` |
| The deployment | one api process, `DATA_DB_POOL_MAX=20`, the registry and the delivery pools of 5 |
| The context cache | `DATA_CONTEXT_CACHE_TTL_MS=0`: every request asks the access service |
| The catalog | the workspace registered nothing: the catalog of the deployment is read with the registry of the workspaces, in one statement |
| The data | 1000 articles of one workspace, one policy per action, the read of a page of 50 |

The database shares the machine and doesn't fsync: these are development-machine numbers, and a
deployment measures its own.

## Results

Release candidate `1.0.0`, on the machine above, with the `1.0.0` guarded write path:

| Scenario | The requests | The rate | p50 | p95 | p99 | The failures |
| --- | --- | --- | --- | --- | --- | --- |
| Read heavy, a page of 50 | 15102 | 1510/s | 10.4 ms | 13.4 ms | 15.5 ms | 0 |
| Mixed, half of the creations | 21491 | 2149/s | 7.3 ms | 9.4 ms | 10.7 ms | 0 |
| The concurrent updates of one record | 6011 | 601/s | 26.6 ms | 30.9 ms | 33.8 ms | 0 (379 successes, 5632 precondition failures) |
| the access service is down | 62617 | 6262/s | 2.5 ms | 3.2 ms | 4.6 ms | 62617 answers 503 |

What the numbers show:

- **The read path holds.** A page of fifty records takes ten milliseconds at p50, even with the
  access service context fetched on every request. The access service is a dependency of every
  request but not on the critical path of reading records: the context is fetched before the
  statement, and the statement is the cheap part.
- **Writes cost more than reads.** A creation writes the record, audit entry, event and receipt in
  one transaction. The mixed scenario is slower than read-heavy at p95, and the writes pay for it.
- **Optimistic concurrency works.** Concurrent updates of one record answer
  `412 PRECONDITION_FAILED` for every update without the current validator: one version change and
  one refusal per attempt, and no lost update. The scenario's latency is the row lock's latency.
- **The service fails closed and fast.** With the access service down, every request answers
  `503 AUTHORIZATION_UNAVAILABLE` in two milliseconds. The service doesn't queue work or serve a
  context it can't prove; the refusal rate tracks the dependency's failure rate.

**Version 1.0.0 numbers** were measured on PostgreSQL 15.19: 991/s, 1251/s, 313/s and 4280/s, with
p50 of 15.8 ms, 11.6 ms, 50.8 ms and 3.6 ms. The two sets aren't comparable: they are two runs on a
shared machine and on two database versions. Development-machine numbers describe that machine at
that moment; the report is a measurement, not a promise.

**Runs vary.** Three consecutive runs on the measurement machine gave 1510/s, 1571/s and 1371/s for
read-heavy: the machine is shared, and run-to-run spread is about a fifth. Each number here is from
one run, so comparing two of them compares two moments of a shared machine, not two service
versions. Response size is now measured by the database while the response is built, and that
measurement isn't visible in the spread: rows are measured where the data already is, and the
process never serializes a row to learn its size.

## Statement shape at scale

The report above measures latency on a small table. Statement shape is a separate question, measured
by `bun run scripts/ops/scale.ts`: it writes a million-row collection, reads the database plan for a
page statement, walks every page and compares the rows with a single statement's rows.

A read runs in two parts. The first reads the page: row IDs, order and limit. The second builds the
payload for the page's rows; the statement builds it because a value the caller may not see must
never leave the database (see [Decisions](decisions.md) §2).

The service's order is [Decisions](decisions.md) §3. The database writes it as `col asc nulls last`,
which is an index order, so the page is read through the scope index with no sort.

| The collection | The plan before | The plan now | The time of the page |
| --- | --- | --- | --- |
| 200 000 rows | sequential scan, sort of the whole scope, projection of every row | index scan of the page, 51 lookups | 97 ms → 0.9 ms |
| 1 000 000 rows | the same, three times the rows | the same plan | 0.9 ms |

Pagination was walked over a 200 000-row collection: 4 000 pages, covering every row, in database
order.

**A deployment declares its collections' indexes.** Pages are read through the workspace scope
index, and sorting on a field needs that field's index in the collection's reviewed migration. A
descending sort needs an index declared `desc nulls last`: for the descending direction, a column's
default index is `asc nulls first`, and the service orders nulls last.

## Not measured here

- **Replicas.** The measurement runs one API process. With several replicas, reads scale with the
  replica count and writes scale with the database.
- **The worker.** Integration tests check delivery claims, leases and retries; their capacity is
  measured with the outbox metrics `data_outbox_backlog` and `data_outbox_oldest_age_seconds`.
- **Slow statements.** The measurement uses a small table. `bun run scripts/ops/scale.ts` measures
  statement shape at scale, and filter indexes belong in the collection's reviewed migration.
- **Maximum bounds.** No scenario uses a 200-record page, a fifty-predicate filter or a
  thousand-row expansion. Contract tests check those bounds, and the service refuses them with
  `422 RESULT_TOO_LARGE`.

## Deployment declaration

A deployment declares:

| | |
| --- | --- |
| The rate of the requests | the number of the requests per second that it accepts |
| The objective of the latency | the percentile that it holds, and the number |
| The shape of the data | the number of the records, the size of the page, the number of the predicates of a filter |
| The complexity of the policies | the number of the policies of a collection, the number of the fields of a policy |
| The settings of the pool | `DATA_DB_POOL_MAX` and the size of the database |
| The replicas | the number of the api processes and the number of the workers |

It measures them with the same command on its own hardware and publishes the result as this report
does.

### Reference deployment

This repository's deployment is the reference. It declares:

| | The declaration |
| --- | --- |
| The rate of the requests | 1 000 requests per second, with the context of the access service asked for every request |
| The objective of the latency | the ninety fifth percentile under 25 milliseconds for a page of fifty records, and under 50 milliseconds for a write |
| The shape of the data | 1 000 records of one workspace, a page of fifty, a filter of ten predicates |
| The complexity of the policies | one policy per action, five fields of a policy |
| The settings of the pool | `DATA_DB_POOL_MAX=20`, and the pools of the registry and of the deliveries of five |
| The replicas | one api process and one worker, on the machine of the measurement |
| The availability | `DATA_CONTEXT_CACHE_TTL_MS=0`: the revocation of a grant is visible in the next request, and an access service that is down answers `503` to every call |

The objectives are the measurement above with a 50% margin: it reached 1 510 requests per second
read-heavy and 2 149 mixed, at p95 of 13.4 and 9.4 milliseconds. A deployment that declares more
than its machine holds answers `503` when full; the service is measured with the repository's
command, not with a promise.

A grant revocation takes effect within the context cache lifetime plus the running request's
duration. With the default (no cache), that is just the request's duration.
