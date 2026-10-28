# Platform

Three HTTP services and a web console in one Bun monorepo. The **gateway** authenticates callers and forwards requests, the **access service** decides what a caller may do, and the **data service** stores workspace data. The **console** is the web interface: a client of the three services that decides nothing itself.

```
clients ──▶ gateway ──▶ data service ──▶ PostgreSQL
                │              │
                │              └──▶ access service (access context)
                └─────────────────▶ access service (login and decisions)
```

The services are separate processes and deployments that talk only over HTTP; no workspace imports another's source. They share one lockfile, one CI, and one release line (currently `1.0.0`).

## Quick start

Requires Bun 1.4.3 or later.

```bash
bun install
bun run dev            # three services, console, PostgreSQL and a dev identity provider
curl -s http://localhost:8080/healthz
curl -s http://localhost:8080/readyz | jq
```

`bun run dev` applies migrations, seeds a tenant, principal and grants, and prints the addresses and sign-in credentials. Other modes (gateway only, containers, services from source) are in [Development](docs/platform/development.md).

Run the checks before a pull request:

```bash
bun run typecheck && bun run lint && bun run format:check
bun run architecture && bun run dead && bun run versions
bun run repositories:check && bun run deploy:check
bun run test && bun run compatibility
```

## Documentation

All docs live in [`docs/`](docs/README.md). Each service's spec is normative.

| Area | Start with |
| --- | --- |
| Platform: repository, development, operations, release, security | [docs/platform/](docs/platform/README.md) |
| Gateway | [docs/gateway/](docs/gateway/README.md), [spec](docs/gateway/spec.md) |
| Access service | [docs/access/](docs/access/README.md), [spec](docs/access/spec.md) |
| Data service | [docs/data/](docs/data/README.md), [spec](docs/data/spec.md) |
| Console | [docs/console/](docs/console/README.md), [spec](docs/console/spec.md) |
| Whole platform on one page | [atlas](docs/platform/atlas.html) (`bun run atlas`) |

See also [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

## Repository layout

| Path | Contents | Env prefix | Image |
| --- | --- | --- | --- |
| [`packages/gateway/`](packages/gateway/) | HTTP gateway: OIDC authentication, access checks, forwarding to the matched route's upstream | `GATEWAY_*` | `ghcr.io/ggpwnkthx/gateway` |
| [`packages/access/`](packages/access/) | OIDC broker and access decision service | `ACCESS_*` | `ghcr.io/ggpwnkthx/access` |
| [`packages/data/`](packages/data/) | Headless data backend: workspaces, collections, policies, records, audit, events | `DATA_*` | `ghcr.io/ggpwnkthx/data` |
| [`packages/console/`](packages/console/) | HonoX web console | `CONSOLE_*` | built from `packages/console/Dockerfile` |
| [`deploy/`](deploy/README.md) | Compose stacks, Kubernetes manifests, config and dev fixtures | | |
| `docs/`, `scripts/`, `tooling/`, `test/` | Docs, root commands, shared tooling, platform tests | | |

Full layout: [Architecture](docs/platform/architecture.md).

## License

MIT. See [LICENSE](LICENSE).
