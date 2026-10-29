# Data

A headless, permission-aware data API for applications behind the gateway: the `packages/data/`
workspace of [the platform](../../README.md). Documentation: [docs/data](../../docs/data/README.md).

The service holds workspaces, collections, data policies, records, audit and version history, and committed
events. [Access](../access/) owns identity, tenants, groups and grants, and its access
context contract (`/v1/access-context`) is a required dependency: without it the service fails
closed. TypeScript on Bun 1.4.3 with Hono; PostgreSQL 15 or later with row-level security.

Version `1.0.0` is pre-production; see [Release status](../../docs/data/README.md#release-status).

## Install

| Artifact | Where |
| --- | --- |
| Image | `ghcr.io/ggpwnkthx/data:1.0.0` |
| Standalone binaries | Assets of [release `v1.0.0`](https://github.com/ggpwnkthx/platform/releases/tag/v1.0.0) |
| Typed client | `@data-backend/client`, or `data-backend-client-1.0.0.tgz` from the same release ([Client](../../docs/data/client.md)) |

## Commands

Run from the repository root with `bun run --cwd packages/data <script>`:

| Script | Does |
| --- | --- |
| `start` | The API and, per `DATA_PROCESS_ROLE`, the worker. |
| `provision`, `migrate` | Roles and database; schema. |
| `workspace`, `collection`, `policy`, `delivery`, `retention` | Operator commands ([Operations](../../docs/data/operations.md)). |
| `typecheck`, `architecture` | Types; domain boundaries. |
| `test`, `test:integration`, `test:mutation`, `test:compat` | Unit, contract and architecture suites; database; mutation; cross-service compatibility. |
| `check:client-package` | The packed client, installed outside the repository. |

First run: [Getting started](../../docs/data/getting-started.md). Repository-wide workflow:
[Platform development](../../docs/platform/development.md).

## License

MIT. See [LICENSE](../../LICENSE).
