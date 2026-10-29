# Internals

How the repository is laid out, which boundaries the build enforces, how the compatibility baseline works and how a release is cut. It is for maintainers; operators should read [Operations](operations.md) instead.

## Repository layout

```text
platform/
├── package.json          workspaces and root commands
├── bun.lock              one lockfile for all workspaces
├── tsconfig.base.json    shared compiler options
├── biome.json            shared lint and format rules
├── knip.json             dead-code configuration
├── compatibility.json    compatibility baseline
├── deploy/               compose stacks, Kubernetes manifests, config, dev fixtures
├── docs/                 all documentation
├── scripts/              root commands
├── tooling/              code shared by root and workspace commands
├── test/                 platform tests
├── .github/workflows/    CI and releases
├── packages/
│   ├── gateway/          gateway
│   ├── access/           Access
│   ├── data/             Data
│   ├── console/          console, the platform's interface (HonoX)
│   └── cli/              the CLI (platformctl)
```

A workspace is a directory with its own `package.json`. One root `bun install` installs every workspace against `bun.lock`. `tooling/` is a library only (version checks, import-boundary checks, the compatibility baseline, the development PostgreSQL); the commands that use it live in `scripts/` directories.

Every document lives under `docs/`: cross-cutting pages in `docs/platform/` and each service's pages in its own directory. [Where documentation goes](../../CONTRIBUTING.md#where-documentation-goes) describes the page set. The [atlas](atlas.html) is the only non-Markdown document: one HTML page with an inline script and no build step. Open it with `bun run atlas`.

## Boundaries

No workspace imports another's source. The services talk over HTTP:

```text
gateway/  ──HTTP──▶  access/
gateway/  ──HTTP──▶  data/
data/     ──HTTP──▶  access/
console/  ──HTTP──▶  access/
console/  ──HTTP──▶  gateway/  (data, with the caller's token)
```

They are separate deployments with separate secrets, databases and contracts. Shared source would couple their builds and break single-service deployments. Two checks hold the boundary:

- each workspace's architecture check rejects imports from another workspace;
- the compatibility suite runs the acceptance scenario through all three services.

## Service workspace layout

The gateway, Access and Data workspaces share one layout, enforced by each workspace's architecture check:

| Directory | Contents |
| --- | --- |
| `src/domains/` | Each domain's policy, behind a public entry point |
| `src/app/` | Endpoints, orchestration, errors |
| `src/platform/` | Adapters implementing the domains' ports |
| `src/runtime/` | Composition root: the only place pieces are assembled |
| `src/observability/` | Logs and metrics |
| `test/` | Tests by kind: unit, contract, integration, architecture |
| `scripts/` | Operator tools and checks: `cli/`, `ops/`, `compat/`, `gates/`, `dev/`, `support/` |

Each service documents its own rules: [gateway dependency rules](../gateway/internals.md#import-rules), [Access code layout](../access/internals.md#code-layout), [Data architecture](../data/internals.md#code-layout). Each workspace declares them (domain matrix, process entry files, packages a domain core may not import) in `scripts/gates/architecture.ts`; the shared engine is `tooling/architecture.ts`.

## Console workspace

The console is a [HonoX](https://github.com/honojs/honox) app built with Vite. It speaks the three services' contracts and holds none of their policy.

| Path | Contents |
| --- | --- |
| `src/domains/` | Core: contract clients (Access sign-in and administration, access context, workspace data through the gateway, probes), sessions, operator scope, record values, the platform map |
| `src/app/` | Interface: routes, islands, components, request middleware, stylesheet |
| `src/runtime/` | Configuration, logging, client composition |
| `src/main.ts` | The process: serves the build, or the sources through Vite in development |

The core imports neither the interface nor HonoX, and no module is part of an import cycle. `packages/console/scripts/architecture.ts` checks this with `tooling/web-architecture.ts`.

## CLI workspace

The CLI (`platformctl`) is a client of the three services with no policy of its own. It has no dependencies and needs nothing but the runtime.

| Path | Contents |
| --- | --- |
| `src/domains/` | Core: deployment contexts, contract calls, refusals and their exit statuses, login |
| `src/app/` | Interface: argument parsing, the dispatcher, help text, output formats |
| `src/platform/` | Adapters implementing the domains' ports: transport, local files, the browser, the login callback, randomness |
| `src/runtime/` | The command registry and the composition of the ports |
| `src/main.ts` | The process: parses the arguments and exits with the command's status |

Its core imports neither the interface nor the adapters, and it has no import cycles. `packages/cli/scripts/architecture.ts` checks this with the console's engine.

## Working rules

Each workspace adds its own domain rules to these:

- One rule, one domain, one test file next to it. A rule without a test is not implemented.
- The build checks import boundaries, not code review.
- Record a decision before implementing the behavior it decides.
- Take measurements before code depends on them.

## Dependencies

| Package | Declared in |
| --- | --- |
| `typescript`, `@types/bun`, `@types/pg` | root (every workspace is checked with them) |
| `@biomejs/biome`, `knip` | root (platform tools) |
| `hono`, `jose`, `zod`, `pg` | each workspace that uses them |
| `redis`, `pino`, `prom-client` | the workspaces that use them |
| `@electric-sql/pglite` | workspaces whose tests run on the embedded database |
| `playwright`, `oidc-provider` | gateway (tests and fixtures) |

Every version is pinned exactly; Dependabot opens the pull request that moves one.

The tree of the dependencies is **flat**: `bunfig.toml` sets `linker = "hoisted"`, so every dependency is installed at the root of the repository and a workspace holds no `node_modules` of its own. The resolution of a module walks the parents of the file, and the root is a parent of the workspace, so a workspace resolves its dependencies at the root.

The layout is the same decision as the one the images make: an image copies the root `node_modules` alone, and a tree of links that points into a store the image does not copy breaks the process at its start with `ENOENT reading "node_modules/<package>"`. The development machine and the image of a package hold the same tree now.

Each workspace's `Dockerfile` builds with the **repository root** as context, because dependencies come from the root lockfile:

```bash
docker build -f packages/gateway/Dockerfile -t gateway:ci .
docker build -f packages/access/Dockerfile  -t access:ci  .
docker build -f packages/data/Dockerfile    -t data:ci    .
```

## Compatibility

The compatibility suites prove that the three services still talk over HTTP as their specs say, measured against a pinned **baseline**: a revision of this repository. The gateway and Access at that revision are the **references**, which the harness clones. Access and Data in the working tree are the **candidates**.

The manifest is [`compatibility.json`](../../compatibility.json). It is the single owner of the pin: the harness, the docs and the drift check all read it. A workspace with a `source` is a reference; one without is a candidate:

```json
{
  "version": 2,
  "repository": "https://github.com/ggpwnkthx/platform.git",
  "workspaces": {
    "gateway": {
      "path": "packages/gateway",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "0123456789abcdef0123456789abcdef01234567"
      }
    },
    "access": {
      "path": "packages/access",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "0123456789abcdef0123456789abcdef01234567"
      }
    },
    "data": { "path": "packages/data" }
  }
}
```

The pin moves with every release: a release's baseline is the revision it shipped at. Comparing the tree with itself proves nothing, while testing against a revision that a deployment may still run does.

| Suite | Proves | Command |
| --- | --- | --- |
| Access contract | The pinned gateway works with the tree's Access | `bun run --cwd packages/access test:compatibility` |
| Platform acceptance | The tree's Data works with the pinned gateway and Access | `bun run --cwd packages/data test:compatibility` |

`bun run compatibility` runs both.

### References and candidates

For each reference, the harness clones the pinned revision, installs its dependencies, and checks that its tracked files match. It clones from the local repository when that has the revision, so no network is needed, and from the manifest URL otherwise. A candidate may carry uncommitted changes, because those changes are what is under test. The harness fails if the suites altered the candidate's tracked changes.

| Variable | Sets |
| --- | --- |
| `GATEWAY_REPOSITORY`, `GATEWAY_COMMIT` | Gateway revision |
| `ACCESS_REPOSITORY`, `ACCESS_COMMIT` | Access revision |
| `DATA_REPOSITORY`, `DATA_COMMIT` | Data revision |
| `ACCESS_GATEWAY_PATH` | A gateway that is already prepared |
| `COMPAT_MIRROR` | Directory of bare repository mirrors |
| `COMPAT_WORKSPACE` | Directory where checkouts are created |
| `COMPAT_KEEP` | If set, keep checkouts after the run |

A run with an override tests a candidate rather than the manifest's baseline, and the harness says so.

### Live services and databases

To prove a published image, releases point the Access and Data suites at a running service. The suite never creates what these variables name:

| Variable | Sets |
| --- | --- |
| `ACCESS_EXTERNAL_URL` | URL callers use to reach Access |
| `ACCESS_EXTERNAL_ADMIN_TOKEN` | Its administration token |
| `ACCESS_EXTERNAL_ACCESS_TOKEN` | Its decision token |
| `ACCESS_TEST_DATABASE_URL` | PostgreSQL for Access tests (default: embedded) |
| `ACCESS_TEST_REDIS_URL` | Redis for Access tests |
| `GATEWAY_TEST_REDIS_URL` | Redis for gateway tests |
| `GATEWAY_TEST_POSTGRES_URL` | PostgreSQL for gateway tests |

The Data harness starts its own PostgreSQL server in a temporary directory, because it needs several databases and roles isolated from the development server.

## Release

A release is a git tag named after the root `package.json` version. Pushing the tag publishes three images and three sets of binaries.

### One version

| Where | What |
| --- | --- |
| Root `package.json` | The platform version (the reference) |
| Each workspace's `package.json` | The platform version |
| Each workspace's `Dockerfile` | Default of `ARG VERSION` |
| Each workspace's `src/runtime/version.ts` | Version reported by the health probe |
| `docs/gateway/spec.md`, `docs/access/spec.md`, `docs/data/spec.md` | The spec's `Status:` (the release it describes) |
| Root `CHANGELOG.md` | Latest release |

`bun run versions` checks that they agree, both in CI and in the test suite. The retired repositories' version lines are not continued.

### Release steps

1. **Bump the version** in the files above, then run `bun run versions`.
2. **Wait for green CI.** Tag only a commit that passed.
3. **Cut the tag.** The tagger refuses a version that is not newer than every existing tag, and refuses versions that disagree.

   ```bash
   bun run release:tag:dry-run   # show what it would do
   bun run release:tag           # do it
   ```

4. **Dispatch.** GitHub starts no workflow for a push made with the workflow token, so the tag workflow dispatches the image and binary workflows itself.
5. **Publish images.** The image workflow builds the three images, publishes them with provenance and an SBOM, and runs every gate against the published digest. A failed gate withdraws the images.
6. **Publish binaries.** The binary workflow compiles the three services for seven platforms, proves that the runner binary starts and serves, and attaches the archives to the tag's release.

### Release gates

The gates run against the published bytes:

- the image starts with a deployment configuration and answers its probes;
- the image refuses an incomplete production environment and names the missing secret;
- the image scan fails the release on any finding above high severity;
- the runner binary starts, serves the probes and stops;
- the compatibility suite runs the release's three services together.

A release that fails its gates publishes nothing: its images are withdrawn and its tag points at nothing. For the published artifacts and rollback, see [Operations](operations.md#images-and-binaries).
