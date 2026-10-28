# Development

Data-service specifics for contributors: package layout, test suites, release gates, scripts and how
to add a collection. For installation, local run modes and platform-wide commands, see
[platform development](../platform/development.md).

## Layout

Paths are relative to `packages/data/` unless they start with `docs/`.

| Path | Holds |
| --- | --- |
| `src/app/` | HTTP boundary shell, API routes, request parsing, OpenAPI and secrets. |
| `src/domains/` | Service rules, one directory per domain. |
| `src/platform/` | Bun listener and PostgreSQL adapters. |
| `src/runtime/` | Configuration, composition root, subscribers, readiness and drain. |
| `src/observability/` | Logs and metrics. |
| `src/protocol/` | Errors, clock and envelopes shared by the domains. |
| `scripts/` | Operator commands, measurement commands, release gates and harnesses, one directory per kind. |
| `test/` | Test suites. |
| `packages/client/` | Typed API client. |
| `manifests/` | This deployment's collection manifest and policy bundle. |
| `migrations/` | Reviewed schema migrations. |
| `docs/data/` | Service documentation. |

The domain import matrix is in [Architecture](architecture.md#code-boundaries).

### `src/app/`

| Path | Holds |
| --- | --- |
| `src/app/app.ts` | Service shell: request id, failure-to-answer mapping, operational endpoints. |
| `src/app/routes.ts` | Contract paths and per-request context establishment. |
| `src/app/query.ts` | Query parameters; refuses unknown and repeated ones. |
| `src/app/helpers.ts` | Path parameters, write bodies and request context. |
| `src/app/types.ts` | Application environment and dependencies. |
| `src/app/openapi.ts` | The API document. |
| `src/app/openapi-paths.ts` | Document paths with their parameters and responses. |

### `scripts/`

| Path | Holds |
| --- | --- |
| `scripts/cli/` | Deployment operator commands: workspaces, provisioning, migrations, collections, policies, deliveries, retention. |
| `scripts/ops/` | Operations: backup, restore, restore rehearsal, capacity, statement shape at scale. |
| `scripts/compat/` | Compatibility harness with the gateway and access service, and the baseline drift check. |
| `scripts/gates/` | Repository gates: architecture, mutation, packaged client. |
| `scripts/dev/` | Generators for the client and the identity fixtures. |

## Test suites

| Suite | Command | Proves |
| --- | --- | --- |
| Domain rules | `bun test test/unit` | Predicate evaluation, field rules, write-check composition, schema validation, context expiry, identity verification, secrets, metrics. |
| API contract | `bun test test/contract` | Paths, envelopes, query limits, error codes, canonical ETags, receipts, aggregates, search, catalog, attack cases. |
| Database and worker | `bun test test/integration` | Row-level security, transactions, worker claims, replicas, predicate and write-guard differential tests, search plan. |
| Boundaries | `bun test test/architecture` | Allowed imports, no cycles, private adapter construction. |
| Suite strength | `bun run test:mutation` | Breaks code on purpose and checks the suites notice; a surviving mutation is unproven behavior. |
| Client consumer | `bun test packages/client/test` | The client against a mocked API. |
| Whole repository | `bun run test:all` | Every suite above. |
| Platform | `bun run test:compat` | Real gateway, access service and data service, with the acceptance scenario through the gateway. |

Integration tests and the harness start their own PostgreSQL 18 server, the version the suites prove;
the start script warns when the machine has another major. See
[decision 16](decisions.md#16-tests-run-against-a-real-postgresql-server).

Suites that are not ordinary tests:

- **Predicate differential test** (`test/integration/filter.property.test.ts`): generates predicates
  and compares database and in-memory answers row by row.
- **Write-guard differential test** (`test/integration/write-guard.test.ts`): generates write
  policies and compares in-memory evaluation of their predicates with the database statement, over
  the row before and after the change.
- **Trust-boundary fuzzing** (`test/unit/fuzz.test.ts`): random filters, JSON and signatures; checks
  that no caller input reaches a statement as an identifier and that verification never throws.

## Release gates

A release is a green run of:

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

- Operational gates: backup and restore rehearsal, capacity measurement, and the deployment's
  declared rate and latency objective.
- The mutation gate is **textual**: each mutation names the file and text it replaces. A refactor
  that moves that text must update the mutation, or the gate refuses it as stale and fails.
- CI audits dependencies and refuses a build with a known vulnerability.

## Scripts

| Command | Does |
| --- | --- |
| `bun run scripts/cli/provision.ts` | Creates the separated roles and the database. |
| `bun run scripts/cli/migrate.ts` | Applies migrations as the schema owner. |
| `bun run scripts/cli/workspace.ts` | `create`, `enable`, `disable`, `list` workspaces. |
| `bun run scripts/cli/collection.ts` | `register`, `enable`, `disable`, `list` a workspace's collections. |
| `bun run scripts/cli/policy.ts` | `publish`, `list`, `show` a workspace's bundles. |
| `bun run scripts/cli/delivery.ts` | `list`, `requeue`, `backlog` deliveries. |
| `bun run scripts/cli/retention.ts` | History retention. |
| `bun run scripts/ops/backup.sh`, `restore.sh` | Backup and restore rehearsal. |
| `bash scripts/ops/rehearse-backup.sh` | Backup and restore rehearsal on a dedicated server. |
| `bun run scripts/gates/architecture.ts` | Code boundary check. |
| `bun run dead` | Dead code hunt: unreachable modules, unread names, unused dependencies. |
| `bun run scripts/ops/capacity.ts` | Capacity measurement. |
| `bun run scripts/ops/scale.ts` | Statement plans at a million rows, and a walk of every page. |
| `bun run scripts/dev/generate-client.ts` | Collection types from the manifest. |
| `bun run scripts/dev/generate-fixtures.ts` | Signature fixtures from the pinned gateway. |
| `bun run scripts/compat/check-compatibility.ts` | Integration baseline drift check. |
| `bun run scripts/gates/check-client-package.ts` | Packed client, installed outside the repository. |
| `bun run scripts/compat/compatibility.ts` | Compatibility harness. |
| `bun run release:tag` | Tags the release when the platform version increased. |

Every script is an operator command: it runs on the deployment machine, is not an HTTP route, and
never bypasses the access service. Required credentials: [Configuration](configuration.md#operator-commands).

## Release tags

Tag `v1.0.0` names version `1.0.0`; the release workflows (image, binaries for seven platforms,
client, checksums) run on the tag. The full sequence is in [platform release](../platform/release.md).

```bash
bun run versions        # root manifest, workspace manifests, client and Dockerfile ARG VERSION agree
git commit -m "release: the version 1.0.0 of the platform"
git push origin main
bun run release:tag:dry-run   # the tag the workflow would create, without creating it
```

- **The repository workflow creates the tag** after CI is green on `main` for the commit: it reads
  the project version, compares it with existing tags, and creates and pushes the tag if the version
  increased. The tag therefore names a commit CI proved.
- The command can also be run by hand. It refuses mismatched versions (root manifest, workspace
  manifests, the `Dockerfile`s' `ARG VERSION`) and compares versions numerically, never as text:
  `0.10.0` is greater than `0.9.0`. It refuses a version not greater than the latest tag.
- **The release is dispatched, not triggered.** GitHub does not start workflows from pushes made with
  the repository token (to prevent loops), so the tag workflow dispatches the image and binary
  workflows on the tag, and they run in that tag's context. A tag pushed by hand starts them directly.
  No repository secret is needed.
- The tag is annotated, and git refuses an annotated tag without a committer identity. The workflow
  sets the release identity first, and the command falls back to it when the checkout has none.

## What "checked" means

The suites show a requirement is **checked**: a check exists, runs with a repository command, and
passes. That is not **proved**: every check was written by the code's author, which is not
assurance. The service has never run outside its own harness: no production history, no external
users, no independent review. Version `1.0.0` is published, and the gates outside the repository are
still open; see [release readiness](release.md). The security review and open findings are in
[Security](security.md).

## Adding a collection

A collection is a physical table plus a logical registration; both are reviewed artifacts.

1. Write the migration creating the table with its columns, composite relations and row-level
   security, and apply it with `bun run migrate`.
2. Declare the collection in `manifests/schema.json` with its fields, bounds and relations.
3. Write its policies in `manifests/policies.json`.
4. Regenerate client types with `bun run scripts/dev/generate-client.ts`.
5. Register it for the workspaces that serve it with `bun run collection -- register`.

The runtime role never creates or alters a table; a table no migration describes is not part of the
deployment.
