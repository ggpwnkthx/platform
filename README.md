# Platform

Three HTTP services and a web console in one Bun monorepo. The **gateway** authenticates callers and forwards their requests, **Access** decides what a caller may do, and **Data** stores workspace data. The **console** is the web interface: a client of the three that decides nothing itself.

The services are separate processes and deployments that talk only over HTTP. They share one lockfile, one CI and one release line (currently `1.0.0`).

## Quickstart

You need Bun 1.4.3 or later.

```bash
bun install
bun run dev    # three services, console, PostgreSQL and a dev identity provider
```

Then open the console at http://localhost:8083/ and sign in as `alice@gateway.test` / `alice-password`. The full walkthrough is in the [Quickstart](docs/platform/quickstart.md).

## Documentation

Start at [`docs/`](docs/README.md), or jump in by role, task or service.

| Find pages | Start with |
| --- | --- |
| By role: dba, sysops, secops, developer, maintainer, end user | [docs/roles/](docs/roles/README.md) |
| By task: deploy, onboard a tenant, manage access, rotate secrets, troubleshoot … | [docs/guides/](docs/guides/README.md) |
| Gateway | [docs/gateway/](docs/gateway/README.md) |
| Access | [docs/access/](docs/access/README.md) |
| Data | [docs/data/](docs/data/README.md) |
| Console | [docs/console/](docs/console/README.md) |
| CLI (`platformctl`) | [docs/cli/](docs/cli/README.md) |
| Platform: overview, concepts, quickstart, development, operations, security, internals | [docs/platform/](docs/platform/README.md) |

## Repository layout

| Path | Contents | Image |
| --- | --- | --- |
| [`packages/gateway/`](packages/gateway/) | Gateway | `ghcr.io/ggpwnkthx/gateway` |
| [`packages/access/`](packages/access/) | Access | `ghcr.io/ggpwnkthx/access` |
| [`packages/data/`](packages/data/) | Data | `ghcr.io/ggpwnkthx/data` |
| [`packages/console/`](packages/console/) | Console (HonoX) | built from `packages/console/Dockerfile` |
| [`packages/cli/`](packages/cli/) | CLI (`platformctl`) | |
| [`deploy/`](deploy/README.md) | Compose stacks, Kubernetes manifests, config and dev fixtures | |
| `docs/`, `scripts/`, `tooling/`, `test/` | Docs, root commands, shared tooling, platform tests | |

The full layout is in [Internals](docs/platform/internals.md#repository-layout). See also [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
