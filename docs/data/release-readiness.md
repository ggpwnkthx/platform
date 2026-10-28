# The readiness of the version 1.0.0

The gates of the version `1.0.0` of the platform — the release that
carries the service — one by one, with their state. A gate is **done**
when it is a fact of the repository: a check that runs, a measurement
that is published, or a decision that is written down. A gate is
**outside** when it needs something the repository cannot hold: a
deployment with a real studio and a real tenant, and a review that was
written by somebody other than the author of the code.

The version `1.0.0` is published, and the two gates that are outside the
repository are still open: the service is still a pre-production release
until they are met. The gates of the code are in [the
development](development.md) §"The gates of a release", and the findings
of the review are in [the security](security.md).

## The gates of the code

| The gate | The state | Where it is proved |
| --- | --- | --- |
| The types, the style and the boundaries | Done | `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run architecture` |
| The dead code | Done | `bun run dead` |
| The rules of the domains | Done | `bun test test/unit` |
| The contract of the API | Done | `bun test test/contract` |
| The database, the transactions and the worker | Done | `bun test test/integration` |
| The boundaries of the code | Done | `bun test test/architecture` |
| The consumer of the client | Done | `bun test packages/client/test` |
| The fuzzing of the trust boundary | Done | `bun test test/unit/fuzz.test.ts`, with eight seeds |
| The differential test of the predicates | Done | `bun test test/integration/filter.property.test.ts`, with eight seeds |
| The differential test of the guard of a write | Done | `bun test test/integration/write-guard.test.ts`, with eight seeds |
| The client outside of the repository, with bun and with node | Done | `bun run check:client-package` |
| The image of the service, built and started | Done | The job of the image of [the continuous integration](../../.github/workflows/ci.yml) |
| The compatibility of the platform | Done | `bun run test:compat`: the pinned gateway, the pinned access service and the backend, with the acceptance scenario through the gateway |
| The drift of the baseline | Done | `bun run check:compatibility` |
| The rehearsal of the backup and of the restore | Done | `bash scripts/ops/rehearse-backup.sh`, and [the record](backup-restore.md) |
| The measurement of the capacity | Done | `bun run scripts/ops/capacity.ts`, and [the report](capacity.md) |
| The audit of the dependencies | Done | `bun audit`, a step of the continuous integration |
| The power of the suites | Done | `bun run test:mutation`: the code is broken on purpose and the suites have to notice |

## The findings of the review

| The finding | The state | Where it is |
| --- | --- | --- |
| The predicate of a write is evaluated twice | **Closed.** The statement of the write carries the predicates of the policies and the row after the change is given to the database. The evaluation in memory is the oracle of the check. | [the security](security.md), [the decisions](decisions.md) §5 |
| The availability of the service is the availability of the access service | **Open, with a decision.** The cache of the context is off by default and it is configurable. The bound of the revocation is the lifetime of the cache plus the duration of the request, and a deployment that prefers the availability over the instant revocation declares it. The declaration of the reference deployment is in [the capacity](capacity.md). | [the security](security.md) §2 |
| The resolution of a timestamp is the millisecond in the write path | **Open, out of the contract.** A row that was written directly in the database may hold a fraction of a millisecond, and the two evaluations of a predicate that reads it do not agree. The rows of the service never hold one: the api writes the timestamps that it normalizes to the millisecond. | [the security](security.md) §3 |
| The service has never run outside its own harness | **Open.** It is the gate below. | [the security](security.md) §4 |

## The gates that are outside the repository

| The gate | What it is | Why the repository cannot hold it |
| --- | --- | --- |
| **A deployment with a real studio and a real tenant.** The service answers the traffic of a platform that is not a test: the writes of the studio, the tenants that share the server, the volumes of the data, the incidents of the night. | A deployment is an environment: it is a machine, a domain, a tenant and a person who answers the phone. |
| **A review that was written by somebody other than the author of the code.** The review of [the security](security.md), item by item: the model of the trust, the isolation of the rows, the predicates, the audit, the image, the dependencies. | Every check of this repository was written by the author of the code, and a check of the author of the code is not an assurance. The suites say "checked" and not "proved" for that reason. |

## The last steps of the release

The version `1.0.0` is published. These are the steps that took it, and
they are the steps of the next release of the platform: the version in
the `package.json` of the root, in the `package.json` of the three
workspaces, in the `package.json` of the client and in the `ARG VERSION`
of the `Dockerfile`s. The command `bun run versions` proves that they
agree, and the continuous integration refuses a release whose versions
disagree.

The steps that are left are written down in the files that hold them:
`README.md`, `docs/data/README.md`, `CHANGELOG.md`,
`docs/data/security.md` and `docs/data/development.md`. The wording of
the pre-production release is retired, and the wording of "checked"
becomes the wording of "proved" only where a check of somebody else
proves it.

The changelog of the platform is "Unreleased" today, and it says what the
version changes for a client: the predicate of a write is evaluated by
the database, the legacy verification of the identity is refused by
default, the client is published on a registry and it runs with node, and
the backup of a deployment works with the roles of the deployment.

The workflow of the release creates the tag of the version and pushes it,
once the continuous integration of the commit is green. The workflow
dispatches the workflows of the release on the tag, and they publish the
image, the binaries of the seven platforms, the client and the checksums
of the release. The details of the tag are in [the development](development.md)
§"The tag of a release".