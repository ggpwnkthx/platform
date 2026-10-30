# Data

The `packages/data/` workspace of [the platform](../../README.md): a headless, permission-aware data API for applications behind the gateway. The documentation is in [docs/data](../../docs/data/README.md).

Data holds workspaces, collections, data policies, records, audit and version history, and committed events. [Access](../access/) owns identity, tenants, groups and grants, and its access context contract (`/v1/access-context`) is a required dependency: without it, Data fails closed. It is written in TypeScript on Bun 1.4.3 with Hono, and runs on PostgreSQL 15 or later with row-level security.

Version `1.0.3` is pre-production; see [Release status](../../docs/data/README.md#release-status).

## Install

| Artifact | Where |
| --- | --- |
| Image | `ghcr.io/ggpwnkthx/data:1.0.3` |
| Standalone binaries | Assets of [release `v1.0.3`](https://github.com/ggpwnkthx/platform/releases/tag/v1.0.3) |
| Typed client | `@data-backend/client`, or `data-backend-client-1.0.3.tgz` from the same release ([Client](../../docs/data/client.md)) |

## Commands

Run them from the repository root with `bun run --cwd packages/data <script>`:

| Script | Does |
| --- | --- |
| `start` | The API and, depending on `DATA_PROCESS_ROLE`, the worker. |
| `provision`, `migrate` | Roles and database; schema. |
| `workspace`, `collection`, `policy`, `delivery`, `retention` | Operator commands ([Operations](../../docs/data/operations.md)). |
| `typecheck`, `architecture` | Types; domain boundaries. |
| `test`, `test:integration`, `test:mutation`, `test:compat` | Unit, contract and architecture suites; database; mutation; cross-service compatibility. |
| `check:client-package` | The packed client, installed outside the repository. |

For a first run, see [Getting started](../../docs/data/getting-started.md). The repository-wide workflow is in [Platform development](../../docs/platform/development.md), and maintainer details are in [Internals](../../docs/data/internals.md).

## License

MIT. See [LICENSE](../../LICENSE).
