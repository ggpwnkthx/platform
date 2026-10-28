# The architecture of the repository

## The layout

```
platform/
├── package.json          the workspaces and the commands of the platform
├── bun.lock              one lockfile for the three workspaces
├── tsconfig.base.json    the compiler options the three share
├── biome.json            the style of the three
├── knip.json             the dead code of the three
├── compatibility.json    the baseline of the platform
├── docs/                 the documentation of the platform and of the three contracts
├── scripts/              the commands of the platform
├── tooling/              the code the commands of the platform and of the workspaces share
├── test/                 the tests of the platform
├── .github/workflows/    the continuous integration and the releases
├── packages/             the workspaces of the three services and the console
│   ├── gateway/          the workspace of the gateway
│   ├── access/           the workspace of the access service
│   ├── data/             the workspace of the data service
│   └── console/          the workspace of the console, the interface of the platform (HonoX)
```

Every document of the platform lives in `docs/`, in one tree: the
documentation that is common to the three services is in `docs/platform/`,
and the documentation of the contract of a service is in the directory
of its name — `docs/gateway/`, `docs/access/` and `docs/data/`. The
console has a directory of its own too: `docs/console/`.

The **atlas** is the one document of the platform that is not markdown:
[atlas.html](atlas.html) holds the whole platform on one page — the
callers, the three services, the stores, the identity provider, and the
contracts between them — and it lets a reader walk a request over that
map. It is a document of html with a script in it, it has no build step,
and the command that opens it is `bun run atlas`.

A workspace is a directory with a `package.json` of its own. Bun
workspaces are the mechanism of the merge: one `bun install` at the root
installs the three workspaces, and the root of the repository is the
only place a dependency is declared.

The root of the repository holds what belongs to the three of them:

| What | Where |
| --- | --- |
| The commands of the platform | `package.json`, `scripts/` |
| The code the commands share | `tooling/` |
| The compiler options the three share | `tsconfig.base.json` |
| The style of the three | `biome.json` |
| The code that nothing uses | `knip.json` |
| The baseline of the compatibility | `compatibility.json` |
| The checks of the platform | `test/` |
| The continuous integration and the releases | `.github/workflows/` |

## The boundaries

The three workspaces are **independent**: a workspace never imports the
source of another one.

```
gateway/  ──HTTP──▶  access/
gateway/  ──HTTP──▶  data/
data/     ──HTTP──▶  access/
console/  ──HTTP──▶  access/
console/  ──HTTP──▶  gateway/  (the data, with the token of the caller)
```

The reasons are the ones of the merge of the repositories: the services
are separate deployments with separate secrets, separate databases and
separate contracts. A shared source would make a change of one of them a
change of the build of the others, and it would break the deployments
that run one of them alone.

The boundary is checked, not only documented:

- the check of the architecture of each workspace refuses an import of
  another workspace;
- the compatibility suite starts the three services and performs the
  acceptance scenario through them.

## The organization inside a workspace

The three workspaces are organized the same way, and the check of the
architecture of each of them holds the organization:

| Directory | What it holds |
| --- | --- |
| `src/domains/` | The policy of each domain, behind a public entry point. |
| `src/app/` | The application: the endpoints, the orchestration, the errors. |
| `src/platform/` | The adapters that implement the ports of the domains. |
| `src/runtime/` | The composition root: the only place where the pieces are assembled. |
| `src/observability/` | The logs and the metrics. |
| `test/` | The tests, by kind: unit, contract, integration, architecture. |
| `scripts/` | The commands of the workspace: the operator tools and the checks. They are grouped by their kind, and the directory of a command is its kind: `cli/`, `ops/`, `compat/`, `gates/`, `dev/` and `support/`. |
| `docs/` | The documentation of the platform and of the three contracts. It is one tree, and it is at the root of the repository. |

The rules are in the specification of each workspace
([§14.3](../gateway/spec.md) of the gateway,
[§16](../access/spec.md) of the access service,
[§13](../data/specification.md) of the data service), and the
check of the architecture of the workspace is what holds them.

The console is the **one** interface of the platform, and it is a
**client** of it: it speaks the contracts of the three services and it
holds no policy of their own. It is an application of
[HonoX](https://github.com/honojs/honox) built with Vite, and its source
holds two halves:

| Directory | What it holds |
| --- | --- |
| `src/domains/` | The core: the clients of the contracts (the sign-in and the administration of the access service, the contract of the access context, the data of a workspace through the gateway, the probes), the sessions, the scope of an operator, the values of the records and the map of the platform. |
| `src/app/` | The interface: the routes of HonoX (`src/app/routes/`), the islands that live in the browser (`src/app/islands/`), the pieces of the pages (`src/app/components/`), the middleware of a request and the sheet. |
| `src/runtime/` | The configuration, the log and the composition of the clients. |
| `src/main.ts` | The process: it serves the build, or the sources through Vite on a development machine. |

The core imports neither the interface nor HonoX, and no module of the
console is part of a cycle. The check is
`packages/console/scripts/architecture.ts`, and the engine it is checked
with is in `tooling/web-architecture.ts`.

The `tooling/` directory of the root is the code that the commands of
the platform and of the workspaces share: the check of the version of
a release, the check of the import boundaries, the baseline of the
compatibility and the PostgreSQL of the development machine. It holds
no command of its own: a file in it is a library, and the command
that uses it is in a `scripts/` directory.

A workspace owns its own rules: the matrix of the domains, the files
that enter the process and the packages the core of a domain may not
import are in the `scripts/gates/architecture.ts` of the workspace, and
the engine they are checked with is in `tooling/architecture.ts`. The
three workspaces do not share the rules they enforce, only the engine
that enforces them.

## The dependencies

The dependencies are declared in the package of the workspace that uses
them, and the tools of the platform are declared in the package of the
root:

| Package | Where it is declared |
| --- | --- |
| `typescript`, `@types/bun`, `@types/pg` | the root: the three workspaces are checked with them |
| `@biomejs/biome`, `knip` | the root: the tools of the platform |
| `hono`, `jose`, `zod`, `pg` | each workspace that uses them |
| `redis`, `pino`, `prom-client` | the workspaces that use them |
| `@electric-sql/pglite` | the workspaces whose tests run on the embedded database |
| `playwright`, `oidc-provider` | the gateway: its tests and its fixtures |

Every version is pinned to an exact one. A version that moves is a
version that was not tested, and Dependabot opens the pull request that
moves it.

## The images

Each workspace has its own `Dockerfile`, and the build context of the
three is the **root of the repository**: the dependencies of a workspace
are installed by the root `bun install`, and a workspace that is built
alone would install a tree that the other workspaces do not share.

```bash
docker build -f packages/gateway/Dockerfile -t gateway:ci .
docker build -f packages/access/Dockerfile  -t access:ci  .
docker build -f packages/data/Dockerfile    -t data:ci    .
```
