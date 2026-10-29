# Internals

For maintainers: how the repository is laid out, which boundaries the build enforces, how the compatibility baseline works and how a release is cut. Operators need [Operations](operations.md) instead.

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
│   ├── access/           Access
│   ├── data/             Data
│   └── console/          console, the platform's interface (HonoX)
```

A workspace is a directory with its own `package.json`; one root `bun install` installs them all against `bun.lock`. `tooling/` is a library only (version checks, import-boundary checks, the compatibility baseline, the development PostgreSQL); the commands that use it live in `scripts/` directories.

All docs live in `docs/`: shared material in `docs/platform/`, each contract in its service's directory. The [atlas](atlas.html) is the only non-Markdown doc: one HTML page with an inline script and no build step. Open it with `bun run atlas`.

## Boundaries

No workspace imports another's source. Services talk over HTTP:

```
gateway/  ──HTTP──▶  access/
gateway/  ──HTTP──▶  data/
data/     ──HTTP──▶  access/
console/  ──HTTP──▶  access/
console/  ──HTTP──▶  gateway/  (data, with the caller's token)
```

They are separate deployments with separate secrets, databases and contracts; shared source would couple their builds and break single-service deployments. The build checks the boundary:

- each workspace's architecture check rejects imports of another workspace;
- the compatibility suite runs the acceptance scenario through all three services.

## Service workspace layout

The gateway, access and data workspaces share one layout, enforced by each workspace's architecture check:

| Directory | Contents |
| --- | --- |
| `src/domains/` | Each domain's policy, behind a public entry point |
| `src/app/` | Endpoints, orchestration, errors |
| `src/platform/` | Adapters implementing the domains' ports |
| `src/runtime/` | Composition root: the only place pieces are assembled |
| `src/observability/` | Logs and metrics |
| `test/` | Tests by kind: unit, contract, integration, architecture |
| `scripts/` | Operator tools and checks: `cli/`, `ops/`, `compat/`, `gates/`, `dev/`, `support/` |

Rules: gateway [§14.3](../gateway/spec.md#143-dependency-rules), Access [§16](../access/spec.md#16-code-layout), Data [§13](../data/spec.md#13-architecture). Each workspace declares its own rules (domain matrix, process entry files, packages a domain core may not import) in `scripts/gates/architecture.ts`; the shared engine is `tooling/architecture.ts`.

## Console workspace

The console is a [HonoX](https://github.com/honojs/honox) app built with Vite. It speaks the three services' contracts and holds none of their policy.

| Path | Contents |
| --- | --- |
| `src/domains/` | Core: contract clients (access sign-in and administration, access context, workspace data through the gateway, probes), sessions, operator scope, record values, the platform map |
| `src/app/` | Interface: routes, islands, components, request middleware, stylesheet |
| `src/runtime/` | Configuration, logging, client composition |
| `src/main.ts` | The process: serves the build, or the sources through Vite in development |

The core imports neither the interface nor HonoX, and no module is in an import cycle. `packages/console/scripts/architecture.ts` checks this with `tooling/web-architecture.ts`.

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

Each workspace's `Dockerfile` builds with the **repository root** as context, because dependencies come from the root lockfile:

```bash
docker build -f packages/gateway/Dockerfile -t gateway:ci .
docker build -f packages/access/Dockerfile  -t access:ci  .
docker build -f packages/data/Dockerfile    -t data:ci    .
```

## Compatibility

The compatibility suites prove the three services still talk over HTTP as their specs say, against a pinned **baseline**: a revision of this repository. The gateway and Access at that revision are the **references**; the harness clones them. The Access and Data in the working tree are the **candidates**.

The manifest is [`compatibility.json`](../../compatibility.json), the single owner of the pin: the harness, the docs and the drift check all read it. A workspace with a `source` is a reference; one without is a candidate:

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

The pin moves every release: a release's baseline is the revision it shipped at. Comparing the tree with itself proves nothing; testing against a revision a deployment may still run does.

| Suite | Proves | Command |
| --- | --- | --- |
| Access contract | The pinned gateway works with the tree's Access | `bun run --cwd packages/access test:compatibility` |
| Platform acceptance | The tree's Data works with the pinned gateway and Access | `bun run --cwd packages/data test:compatibility` |

`bun run compatibility` runs both.

### References and candidates

The harness clones each reference at the pinned revision (from the local repository when it has the revision, so no network is needed; otherwise from the manifest URL), installs its dependencies, and checks its tracked files match. A candidate may carry uncommitted changes; those are what is under test. The harness fails if the suites altered the candidate's tracked changes.

| Variable | Sets |
| --- | --- |
| `GATEWAY_REPOSITORY`, `GATEWAY_COMMIT` | Gateway revision |
| `ACCESS_REPOSITORY`, `ACCESS_COMMIT` | Access revision |
| `DATA_REPOSITORY`, `DATA_COMMIT` | Data revision |
| `ACCESS_GATEWAY_PATH` | A gateway that is already prepared |
| `COMPAT_MIRROR` | Directory of bare repository mirrors |
| `COMPAT_WORKSPACE` | Directory where checkouts are created |
| `COMPAT_KEEP` | If set, keep checkouts after the run |

A run with an override tests a candidate, not the manifest's baseline, and the harness says so.

### Live services and databases

Releases point the access and data suites at a running service to prove the published image. The suite never creates what these name:

| Variable | Sets |
| --- | --- |
| `ACCESS_EXTERNAL_URL` | URL callers use to reach Access |
| `ACCESS_EXTERNAL_ADMIN_TOKEN` | Its administration token |
| `ACCESS_EXTERNAL_ACCESS_TOKEN` | Its decision token |
| `ACCESS_TEST_DATABASE_URL` | PostgreSQL for Access tests (default: embedded) |
| `ACCESS_TEST_REDIS_URL` | Redis for Access tests |
| `GATEWAY_TEST_REDIS_URL` | Redis for gateway tests |
| `GATEWAY_TEST_POSTGRES_URL` | PostgreSQL for gateway tests |

Data harness starts its own PostgreSQL server in a temporary directory: it needs several databases and roles isolated from the development server.

## Release

A release is a git tag named after the root `package.json` version. Pushing it publishes three images and three sets of binaries.

### One version

| Where | What |
| --- | --- |
| Root `package.json` | The platform version (the reference) |
| Each workspace's `package.json` | The platform version |
| Each workspace's `Dockerfile` | Default of `ARG VERSION` |
| Each workspace's `src/runtime/version.ts` | Version reported by the health probe |
| `docs/gateway/spec.md`, `docs/access/spec.md`, `docs/data/spec.md` | The spec's `Status:` (the release it describes) |
| Root `CHANGELOG.md` | Latest release |

`bun run versions` checks they agree, in CI and in the test suite. The retired repositories' version lines are not continued.

### Steps

1. **Bump the version** in the files above, then run `bun run versions`.
2. **Wait for green CI.** Tag only a commit that passed.
3. **Cut the tag.** The tagger refuses a version that isn't newer than every existing tag, or versions that disagree.

   ```bash
   bun run release:tag:dry-run   # show what it would do
   bun run release:tag           # do it
   ```

4. **Dispatch.** GitHub starts no workflow on a push made with the workflow token, so the tag workflow dispatches the image and binary workflows itself.
5. **Publish images.** The image workflow builds the three images, publishes them with provenance and an SBOM, and runs every gate against the published digest. A failed gate withdraws the images.
6. **Publish binaries.** The binary workflow compiles the three services for seven platforms, proves the runner binary starts and serves, and attaches the archives to the tag's release.

### Gates

Run against the published bytes:

- the image starts with a deployment configuration and answers its probes;
- the image refuses an incomplete production environment and names the missing secret;
- the image scan fails the release on any finding above high severity;
- the runner binary starts, serves the probes and stops;
- the compatibility suite runs the release's three services together.

A release that fails its gates publishes nothing: its images are withdrawn and its tag points at nothing. Published artifacts and rollback: [Operations](operations.md).
