# Data service

A headless, permission-aware data API for applications behind the gateway: the `packages/data/`
workspace of [the platform](../../README.md). Full documentation is in
[docs/data](../../docs/data/README.md).

The service owns workspaces, registered collections, data policies, records, audit history, record
version history and committed events. [The access service](../access/) owns identity, tenants,
groups and grants. It is a standalone deployment that knows nothing of a studio; a studio is just
another client.

- **Runtime:** TypeScript on Bun 1.4.3, Hono at the HTTP boundary.
- **Storage:** PostgreSQL 15 or later in a deployment, with row-level security isolating tenants and
  workspaces. The version the repository uses is in
  [Architecture](../../docs/data/architecture.md).

```
clients ──▶ gateway ──▶ data service ──▶ PostgreSQL
                │              │
                │              └──▶ access service (the access context)
                └─────────────────▶ access service (the login and the decisions)
```

The gateway signs the caller's identity. The data service verifies the signature, resolves the
workspace in its registry, asks the access service for the principal's current capabilities, and
enforces the deployment's policies on every record.

The access service's access context contract is a **required dependency**: an access service that
doesn't answer `/v1/access-context` can't serve this service, which fails closed without it. The
extension lives **upstream** in the platform's access service, not as a copy here, and the
compatibility harness proves it against the real access service.

## Status

Platform version `1.0.0` is a pre-production release, and the next release is a release candidate:
see [Data service](../../docs/data/README.md#release-status) and
[Release readiness](../../docs/data/release.md).

## Install

| Artifact | Where |
| --- | --- |
| The image | `ghcr.io/ggpwnkthx/data:1.0.0` |
| The standalone binaries | The assets of the [release `v1.0.0`](https://github.com/ggpwnkthx/platform/releases/tag/v1.0.0) |
| The typed client | `data-backend-client-1.0.0.tgz`, an asset of the same release |

```bash
# The image of the service.
docker pull ghcr.io/ggpwnkthx/data:1.0.0

# The typed client.
bun add https://github.com/ggpwnkthx/platform/releases/download/v1.0.0/data-backend-client-1.0.0.tgz
# or, from the registry of the packages:
bun add @data-backend/client
```

The client is the nested package `@data-backend/client`, runs on bun and node, and is published both
to a package registry and as a release asset. The repository root is the **service**, so
`bun add github:ggpwnkthx/platform` does not install the client.

## Local development

Full stack:

```bash
bun install
bun run scripts/dev-keys.ts
export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"
docker compose -f deploy/compose/platform.compose.yaml up --build
```

This workspace alone:

```bash
bun run --cwd packages/data provision                          # the roles and the database
bun run --cwd packages/data migrate                            # the schema
bun run --cwd packages/data workspace -- create --id 22222222-2222-4222-8222-222222222222 \
  --tenant aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa --slug acme
bun run --cwd packages/data start
```

Integration tests and the compatibility harness need PostgreSQL; tests start their own server and the
harness starts one in a temporary directory. See [Getting started](../../docs/data/getting-started.md).

## Commands

| Command | What it does |
| --- | --- |
| `bun run --cwd packages/data start` | The API and, when the role says so, the worker. |
| `bun run --cwd packages/data migrate` | Applies migrations as the schema owner. |
| `bun run --cwd packages/data workspace -- create --id <uuid> --tenant <uuid> --slug <slug>` | Creates a workspace. |
| `bun run --cwd packages/data collection -- register --workspace <uuid> --collection <key>` | Registers a collection for a workspace. |
| `bun run --cwd packages/data policy -- publish --workspace <uuid> --file <path>` | Publishes a workspace's policy bundle. |
| `bun run --cwd packages/data typecheck` / `bun run lint` / `bun run format:check` | Types and style. |
| `bun run --cwd packages/data architecture` | Domain boundaries. |
| `bun test --cwd packages/data test/unit` | Domain rules. |
| `bun test --cwd packages/data test/contract` | HTTP API contract. |
| `bun test --cwd packages/data test/integration` | Database, transactions and worker. |
| `bun run --cwd packages/data test:mutation` | Breaks the code on purpose and checks that the suites notice. |
| `bun run --cwd packages/data test:compat` | The real gateway, access service and data service together. |
| `bun run --cwd packages/data check:client-package` | The packed client, installed outside the repository. |
| `docker build -f packages/data/Dockerfile .` / `docker compose -f deploy/compose/platform.compose.yaml up --build` | The image, and the local stack. |

## License

MIT. See [LICENSE](../../LICENSE).
