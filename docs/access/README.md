# Access service

The access service is an OpenID Connect broker and access decision service: it authenticates callers against each tenant's identity provider, maps external identities to principals, and answers the gateway's existing decision contract.

The domain model is eight tables (`tenants`, `users`, `permissions`, `grants`, `groups`, `roles`, `role_permissions`, `role_roles`). Administration is twelve `curl` endpoints, plus one that reads the change audit.

## Pages

| Page | Use it for |
| --- | --- |
| [spec.md](spec.md) | **The normative contract.** Change it first when behavior changes. |
| [api.md](api.md) | Every HTTP endpoint: request, response, errors, `curl` examples. |
| [architecture.md](architecture.md) | Code layout, build-checked boundaries, login and decision flows, data model. |
| [decisions.md](decisions.md) | Design decisions with their evidence. |
| [operations.md](operations.md) | Configuration, deployment, probes, metrics, alerts, runbooks, backup, capacity. |
| [security.md](security.md) | Security model, item-by-item review, open findings. |
| [release.md](release.md) | Readiness, tenant cutover, image delivery, known limits. |
| [compatibility.md](compatibility.md) | The pinned reference gateway and the compatibility suite runner. |
| [CHANGELOG.md](../../CHANGELOG.md) | Platform releases and their contract changes. |

`§N` in code, tests and these pages means a section of [spec.md](spec.md). A behavior change updates [spec.md](spec.md) in the same commit as the code; see [CONTRIBUTING.md](../../CONTRIBUTING.md) for the change workflow, commands and style. For what the three services share, see [Platform](../platform/).

## Running it

```bash
bun install
ACCESS_SECRET_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) bun run src/main.ts
```

With no database configured, the process runs **embedded PostgreSQL** (`pglite`) in `./.access/pglite`, so local development uses the same migrations as production. `ACCESS_DATABASE_URL` names a server (`postgres://…`) or another embedded database (`pglite://<path>`); production must name a server.

The repository's dev runner (`bun run dev` at the root) uses the machine's single PostgreSQL server, with one database per service (§4).

The repository is developed and tested against **PostgreSQL 18**: the dev compose file, CI jobs, release gates and embedded database all use it. A deployment chooses its server; the service does not check its version.

Tests also run on the embedded database:

```bash
bun run test
ACCESS_TEST_DATABASE_URL=postgres://access:access@localhost:5432/access bun run test:integration
```

`bun run test` covers units, contracts, integrations, boundaries and tooling. It needs no reference gateway and no sibling directory. The compatibility suite, which runs the real gateway unchanged against this service, is separate:

```bash
bun run test:compat
bun run test:all   # both
```

Other commands:

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # biome lint
bun run format      # biome format --write .
bun run architecture # the import boundaries
```

## Gateway

The gateway is the platform's `packages/gateway/` workspace and is read-only here; this service is built against the repository's revision of it. The compatibility suite (`test/compatibility/`) runs it unchanged against this service, and CI fails if the reference tree is touched. See [Compatibility](compatibility.md) for the runner and its sources.

## Release state

Version `1.0.0` of the platform. Milestones M0 to M9 are closed: the process starts, validates its environment, answers probes, drains on a signal, brokers logins, issues its own tokens, answers gateway decisions, and passes the unchanged reference gateway's suite.

The release adds per-tenant administration credentials, denial reason codes, principal groups, administration batches and audit export. Behavior is unchanged from before the merge: the reference gateway is the repository's own workspace, and the release proves the published image against it. What is **not** done is listed in [release.md](release.md#7-what-this-release-does-not-do).
