# Architecture

How the repository is laid out, how its workspaces are organized, and which boundaries are enforced between them.

## Layout

```
platform/
├── package.json          workspaces and root commands
├── bun.lock              one lockfile for all workspaces
├── tsconfig.base.json    shared compiler options
├── biome.json            shared lint and format rules
├── knip.json             dead-code configuration
├── compatibility.json    compatibility baseline
├── docs/                 platform docs and the service contracts
├── scripts/              root commands
├── tooling/              code shared by root and workspace commands
├── test/                 platform tests
├── .github/workflows/    CI and releases
├── packages/
│   ├── gateway/          gateway
│   ├── access/           access service
│   ├── data/             data service
│   └── console/          console, the platform's interface (HonoX)
```

All docs are in `docs/`: shared material in `docs/platform/`, each contract in `docs/gateway/`, `docs/access/`, `docs/data/`, and the console in `docs/console/`.

The [atlas](atlas.html) is the only non-Markdown doc: one HTML page with an inline script and no build step that shows callers, services, stores, the identity provider and the contracts between them, and walks a request across the map. Open it with `bun run atlas`.

A workspace is a directory with its own `package.json`. One `bun install` at the root installs every workspace against the root lockfile.

| What | Where |
| --- | --- |
| Root commands | `package.json`, `scripts/` |
| Shared command code | `tooling/` |
| Shared compiler options | `tsconfig.base.json` |
| Lint and format rules | `biome.json` |
| Dead-code configuration | `knip.json` |
| Compatibility baseline | `compatibility.json` |
| Platform checks | `test/` |
| CI and releases | `.github/workflows/` |

## Boundaries

Workspaces are independent: no workspace imports another's source.

```
gateway/  ──HTTP──▶  access/
gateway/  ──HTTP──▶  data/
data/     ──HTTP──▶  access/
console/  ──HTTP──▶  access/
console/  ──HTTP──▶  gateway/  (data, with the caller's token)
```

The services are separate deployments with separate secrets, databases and contracts. Shared source would couple their builds and break single-service deployments. The boundary is checked, not just documented:

- each workspace's architecture check rejects imports of another workspace;
- the compatibility suite starts all three services and runs the acceptance scenario through them.

## Inside a service workspace

The gateway, access and data workspaces share one layout, enforced by each workspace's architecture check:

| Directory | Contents |
| --- | --- |
| `src/domains/` | Each domain's policy, behind a public entry point |
| `src/app/` | Endpoints, orchestration, errors |
| `src/platform/` | Adapters implementing the domains' ports |
| `src/runtime/` | Composition root: the only place pieces are assembled |
| `src/observability/` | Logs and metrics |
| `test/` | Tests by kind: unit, contract, integration, architecture |
| `scripts/` | Operator tools and checks, grouped by kind: `cli/`, `ops/`, `compat/`, `gates/`, `dev/`, `support/` |

The rules are in each spec: gateway [§14.3](../gateway/spec.md#143-dependency-rules), access service [§16](../access/spec.md#16-code-layout), data service [§13](../data/spec.md#13-architecture).

Each workspace owns its rules (domain matrix, process entry files, packages a domain core may not import) in its `scripts/gates/architecture.ts`. The engine that checks them is shared: `tooling/architecture.ts`.

`tooling/` is a library only: version checks, import-boundary checks, the compatibility baseline and the development PostgreSQL. Commands that use it live in a `scripts/` directory.

## Working rules

Shared by all workspaces; each adds its own domain rules:

- One rule, one domain, one test file next to it. A rule without a test is not implemented.
- The build checks import boundaries, not code review.
- Record a decision before implementing the behavior it decides.
- Take measurements before code depends on them.

## Console

The console is the platform's only interface and a client of it: it speaks the three services' contracts and holds none of their policy. It is a [HonoX](https://github.com/honojs/honox) application built with Vite.

| Path | Contents |
| --- | --- |
| `src/domains/` | Core: contract clients (access sign-in and administration, access context, workspace data through the gateway, probes), sessions, operator scope, record values, the platform map |
| `src/app/` | Interface: HonoX routes (`src/app/routes/`), browser islands (`src/app/islands/`), page components (`src/app/components/`), request middleware, stylesheet |
| `src/runtime/` | Configuration, logging, client composition |
| `src/main.ts` | The process: serves the build, or the sources through Vite in development |

The core imports neither the interface nor HonoX, and no console module is in an import cycle. Checked by `packages/console/scripts/architecture.ts` using `tooling/web-architecture.ts`.

## Dependencies

Tools are declared at the root; each workspace declares the dependencies it uses.

| Package | Declared in |
| --- | --- |
| `typescript`, `@types/bun`, `@types/pg` | root (all workspaces are checked with them) |
| `@biomejs/biome`, `knip` | root (platform tools) |
| `hono`, `jose`, `zod`, `pg` | each workspace that uses them |
| `redis`, `pino`, `prom-client` | the workspaces that use them |
| `@electric-sql/pglite` | workspaces whose tests run on the embedded database |
| `playwright`, `oidc-provider` | gateway (tests and fixtures) |

Every version is pinned exactly. Dependabot opens the pull request that moves one.

## Images

Each workspace has its own `Dockerfile`, built with the **repository root** as context, because dependencies come from the root `bun install` and lockfile:

```bash
docker build -f packages/gateway/Dockerfile -t gateway:ci .
docker build -f packages/access/Dockerfile  -t access:ci  .
docker build -f packages/data/Dockerfile    -t data:ci    .
```
