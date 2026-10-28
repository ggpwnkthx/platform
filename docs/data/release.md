# Release readiness

Each gate of platform version `1.0.0`, the release that carries the data service, with its state. A
gate is **done** when it is a fact of the repository (a check that runs, a published measurement, or
a written decision) and **outside** when it needs something the repository can't hold.

Version `1.0.0` is published, but its two outside gates are still open, so the service remains a
pre-production release until they are met. Code gates are described in
[Development](development.md); review findings are in [Security](security.md).

## Code gates

| Gate | State | Proof |
| --- | --- | --- |
| Types, style and boundaries | Done | `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run architecture` |
| Dead code | Done | `bun run dead` |
| Domain rules | Done | `bun test test/unit` |
| API contract | Done | `bun test test/contract` |
| Database, transactions and worker | Done | `bun test test/integration` |
| Code boundaries | Done | `bun test test/architecture` |
| Client consumer | Done | `bun test packages/client/test` |
| Trust boundary fuzzing | Done | `bun test test/unit/fuzz.test.ts`, with eight seeds |
| Predicate differential test | Done | `bun test test/integration/filter.property.test.ts`, with eight seeds |
| Write guard differential test | Done | `bun test test/integration/write-guard.test.ts`, with eight seeds |
| Client outside the repository, with bun and node | Done | `bun run check:client-package` |
| Service image, built and started | Done | The image job in [CI](../../.github/workflows/ci.yml) |
| Platform compatibility | Done | `bun run test:compat`: the pinned gateway, the pinned access service and the backend, with the acceptance scenario through the gateway |
| Baseline drift | Done | `bun run check:compatibility` |
| Backup and restore rehearsal | Done | `bash scripts/ops/rehearse-backup.sh`, and [the record](backup-restore.md) |
| Capacity measurement | Done | `bun run scripts/ops/capacity.ts`, and [the report](capacity.md) |
| Dependency audit | Done | `bun audit`, a CI step |
| Suite power | Done | `bun run test:mutation`: the code is broken on purpose and the suites must notice |

## Review findings

| Finding | State | Where |
| --- | --- | --- |
| A write's predicate is evaluated twice | **Closed.** The write statement carries the policy predicates, and the post-change row is given to the database. In-memory evaluation is the check's oracle. | [Security](security.md), [Decisions](decisions.md) §5 |
| Service availability equals access service availability | **Open, with a decision.** The context cache is off by default and configurable. Revocation is bounded by the cache lifetime plus the request duration, and a deployment that prefers availability over instant revocation declares it. The reference deployment's declaration is in [Capacity](capacity.md). | [Security](security.md) §2 |
| Timestamp resolution is the millisecond on the write path | **Open, outside the contract.** A row written directly to the database may hold a sub-millisecond fraction, and the two evaluations of a predicate reading it disagree. Service rows never do: the API writes timestamps normalized to the millisecond. | [Security](security.md) §3 |
| The service has never run outside its own harness | **Open.** See the outside gates below. | [Security](security.md) §4 |

## Outside gates

| Gate | What it is | Why the repository can't hold it |
| --- | --- | --- |
| **A deployment with a real studio and a real tenant** | The service handles traffic from a platform that isn't a test: studio writes, tenants sharing the server, real data volumes, night-time incidents. | A deployment is an environment: a machine, a domain, a tenant and a person who answers the phone. |
| **A review written by someone other than the code's author** | The [security](security.md) review, item by item: trust model, row isolation, predicates, audit, image, dependencies. | Every check in this repository was written by the code's author, and an author's check is not an assurance. That is why the suites say "checked", not "proved". |

## Final release steps

Version `1.0.0` is published. The same steps apply to the next platform release. Set the version in
the root `package.json`, the three workspaces' `package.json`, the client's `package.json` and each
`Dockerfile`'s `ARG VERSION`. `bun run versions` proves they agree, and CI refuses a release whose
versions disagree.

The remaining steps live in the files they change: `README.md`, `docs/data/README.md`,
`CHANGELOG.md`, `docs/data/security.md` and `docs/data/development.md`. Retire the pre-production
wording, and change "checked" to "proved" only where someone else's check proves it.

The platform changelog is currently "Unreleased" and says what the version changes for a client: the
database evaluates a write's predicate, legacy identity verification is refused by default, the
client is published to a registry and runs on node, and a deployment's backup works with the
deployment's roles.

The release workflow creates and pushes the version tag once the commit's CI is green. It then
dispatches the release workflows on the tag, which publish the image, binaries for seven platforms,
the client and the release checksums. Tag details are in [Development](development.md).
