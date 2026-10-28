# The access service

The access service is an **OpenID Connect broker** and an **access
decision service**. It authenticates a caller against the identity
provider of a *tenant*, maps the external identity to a *principal*, and
answers the decision contract that the gateway already speaks.

The whole domain model is eight tables — `tenants`, `users`,
`permissions`, `grants`, `groups` — and the whole administration surface
is twelve `curl` endpoints, plus one that reads the audit of the changes.

| Document | What it holds |
| --- | --- |
| [spec.md](spec.md) | **The normative contract.** The behavior of the service. A change of behavior is a change of this document first. |
| [api.md](api.md) | The HTTP surface: every endpoint, its request, its answer, its errors, with `curl` examples. |
| [architecture.md](architecture.md) | How the code is laid out, the boundaries the build checks, the two flows, the data model. |
| [operations.md](operations.md) | Running it: configuration, deployment, probes, metrics, alerts, runbooks, backup, capacity. |
| [security.md](security.md) | The security model and the item-by-item review, with the findings that are open. |
| [release.md](release.md) | Shipping it: readiness, the cutover of a tenant, the delivery of the image, what is still open. |
| [compatibility.md](compatibility.md) | The pinned gateway of the reference, the runner of the compatibility suite and the way to move the pin. |
| [../../CHANGELOG.md](../../CHANGELOG.md) | The releases of the platform, and the changes of the contract of each one. |

A reference to `§N` in the code, in the tests or in these documents is a
reference to a section of [spec.md](spec.md).

A change of behaviour is a change of [spec.md](spec.md) first, in the
same commit as the code. The guide of a contribution is in
[CONTRIBUTING.md](../../CONTRIBUTING.md), and it holds the order of a
change, the commands and the style of the repository.

The parts of the platform that are common to the three services are in
[the documentation of the platform](../platform/).

## Running it

```bash
bun install
ACCESS_SECRET_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) bun run src/main.ts
```

Without a database in the environment, a development machine runs the
**embedded PostgreSQL** of the process (`pglite`) in `./.access/pglite`:
the same PostgreSQL as the one of a deployment, so the migrations of the
production are the migrations of the development. `ACCESS_DATABASE_URL`
names a server (`postgres://…`) or another embedded database
(`pglite://<path>`); a production environment must name a server.

The runner of the development machine of the repository
(`bun run dev` at the root) names the **server of the machine**: the
machine has one PostgreSQL, and every service has its own database on
it. The embedded database is the fallback of a service that is run
alone.

The repository is developed and tested against **PostgreSQL 18**: the
compose file of the development machine, the jobs of the CI and the gates
of the release run it, and the embedded PostgreSQL is that version. A
deployment names the server it uses, and the service does not read its
version.

The tests run on the embedded PostgreSQL too:

```bash
bun run test
ACCESS_TEST_DATABASE_URL=postgres://access:access@localhost:5432/access bun run test:integration
```

`bun run test` runs the tests of **this** repository: the units, the
contracts, the integrations, the boundaries and the tooling. It needs no
gateway of the reference and no sibling directory.

The compatibility suite is a separate command: it runs the real gateway
of the gateway, unchanged, against this service.

```bash
bun run test:compat
bun run test:all   # the two
```

The other commands:

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # biome lint
bun run format      # biome format --write .
bun run architecture # the import boundaries
```

## The gateway it brokers for

The gateway is the workspace `packages/gateway/` of the platform, and it is
read-only here. The version this service is built against is the
revision of the repository. The compatibility suite
(`test/compatibility/`) runs the gateway, unchanged, against this
service, and the CI fails when the tree of the reference is touched.

The runner of the suite, the sources it accepts and the way the
reference is chosen are in [compatibility.md](compatibility.md).

## The state of the release

Version `1.0.0` of the platform. The milestones M0 to M9 are closed: the
process starts, validates its environment, answers the probes, drains on
a signal, brokers the login of a caller, issues its own tokens, answers
the decisions of a gateway, and runs the gateway of the reference
against itself, unchanged.

The release carries the administration that has a credential per tenant,
the denial that carries the code of its reason, the groups of the
principals, the batches of the administration, and the audit that is
exported. The behaviour of the service is the one it had before the
merge: the gateway of the reference is the workspace of the repository,
and the release proves the published image against it. What is **not**
done is written down in [release.md](release.md) §6. It is a short list,
and it is a list of facts, not of intentions.
