# Compatibility suite

The compatibility suite runs the **real platform gateway**, unchanged, against the access service. This page covers where the reference comes from, how to run the suite, how to test another revision, and what failures mean.

For all three services together, see [platform compatibility](../platform/compatibility.md).

## Reference

The reference gateway is the `packages/gateway/` workspace at the revision pinned by `compatibility.json` at the repository root. That manifest is the one place that names the workspaces:

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
    "access": "packages/access",
    "data": "packages/data"
  }
}
```

The runner validates it strictly:

- `version` is `2`; any other version is refused.
- `repository` is the platform repository.
- `workspaces` names the platform's three workspaces; an unknown workspace is refused.
- A workspace may have a `source`: a repository and a 40-hex-character commit (branches are refused). A workspace with a source is a **reference** and is cloned at that commit. One without is the run's **candidate**: the working tree.

There is no second pin: CI reads the manifest, as the runner and developers do.

The runner clones the source at the pinned commit, installs the clone's dependencies, and uses its `packages/gateway/`. If the local repository holds the pinned commit, it is the clone source, so no network is needed. The clone's tracked files must match the commit, and your working tree is never written to.

## Running the suite

From a fresh checkout:

```bash
bun install --frozen-lockfile
bun run --cwd packages/access test:compat
```

The command:

1. Reads `compatibility.json` from the repository root, whatever the current directory.
2. Clones the gateway at the pinned commit, installs its dependencies, and checks its tracked files match the commit.
3. Runs `bun test test/compatibility` with the reference path in `ACCESS_GATEWAY_PATH`; the gateway runs as a process in its own directory with its own configuration.
4. Checks the reference is unchanged after the run.

It prints the commit it tested:

```
the reference is cloned from /srv/platform at 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c
the reference is unchanged: it is still 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c
the compatibility suite passed against the gateway at 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c (the baseline of the manifest (https://github.com/ggpwnkthx/platform.git at 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c))
```

The revision is a commit, not a branch, so the [integration baseline](https://github.com/ggpwnkthx/platform) is exactly the code the access service is tested against.

## Workspace tests vs. compatibility suite

| Command | Runs |
| --- | --- |
| `bun run --cwd packages/access test` | This workspace's units, contracts, integrations and boundaries. Needs no gateway and no sibling directory. |
| `bun run --cwd packages/access test:compat` | The real platform gateway, unchanged, against the access service. |
| `bun run compatibility` | Both, plus platform acceptance. |

Plain `bun test` also collects the compatibility suite, which then fails with instructions for preparing the reference. Use `bun run test` day to day.

## Reference sources

The runner picks its source from the environment. **The first one set wins:**

| Variable | Meaning |
| --- | --- |
| `ACCESS_GATEWAY_PATH` | An already-prepared gateway directory, used as is: never reset, cleaned or checked out over. |
| `GATEWAY_REPOSITORY` | A git URL or local repository path. Must hold the `GATEWAY_COMMIT` revision. |
| `GATEWAY_COMMIT` | The gateway revision: 40 hex characters. |
| `COMPAT_MIRROR` | A directory holding a bare repository named `gateway.git`, for running without network. |
| — | This repository's workspace: the canonical source. |

Run options:

| Variable | Meaning |
| --- | --- |
| `COMPAT_WORKSPACE` | Directory for the checkout. Defaults to a temporary directory. |
| `COMPAT_KEEP` | When set, keeps the checkout after the run for manual inspection. |
| `COMPAT_TESTS` | Space-separated suite test files. Defaults to all of `test/compatibility`; use it to run one file. |

### Against a running access service

By default the suite starts its own access service in the test process. To test one that is **already running**, such as a release image, set:

| Variable | Meaning |
| --- | --- |
| `ACCESS_EXTERNAL_URL` | The URL callers use to reach it. The suite then never starts its own. |
| `ACCESS_EXTERNAL_ADMIN_TOKEN` | Its administration token. |
| `ACCESS_EXTERNAL_ACCESS_TOKEN` | Its decision token, which the gateway uses to ask for a principal's roles. |

```bash
ACCESS_EXTERNAL_URL=http://127.0.0.1:8081 \
ACCESS_EXTERNAL_ADMIN_TOKEN=the-admin-token \
ACCESS_EXTERNAL_ACCESS_TOKEN=the-access-token-of-the-development \
bun run --cwd packages/access test:compat
```

The suite never creates what the environment names; see [platform compatibility](../platform/compatibility.md).

### Without network

```bash
mkdir -p /srv/compat-mirror
git clone --bare https://github.com/ggpwnkthx/platform.git /srv/compat-mirror/gateway.git
COMPAT_MIRROR=/srv/compat-mirror bun run --cwd packages/access test:compat
```

The mirror is a bare repository named after the reference. The data service harness uses the same convention, so one mirror serves both.

## Testing another revision

The reference moves with the platform: a gateway change that breaks the suite is a contract change, fixed in the gateway in this repository.

To test a **published** gateway revision against the current access service:

```bash
GATEWAY_REPOSITORY=https://github.com/ggpwnkthx/platform.git \
GATEWAY_COMMIT=d3cdb48b79c3962e66bf51d8f386132baff824b7 \
bun run --cwd packages/access test:compat
```

The runner makes a fresh checkout at the commit and never touches the source tree. The source must hold the commit; if its default branch has moved away from it, the runner refuses and names the missing commit. A run with an override tests a **candidate**, not the repository baseline.

## Failures

An override that is set but unusable is an **error**: the runner never falls back to another source, since a run against another revision proves nothing.

| Situation | Runner output |
| --- | --- |
| The reference has changes | `the workspace … carries changes to its tracked files:` plus the changes |
| The source lacks the revision | `the source … does not hold the pinned commit …` |
| The clone failed | `the clone of … failed:` plus git output and alternative sources |
| The mirror has no `gateway.git` | `COMPAT_MIRROR names a directory that holds no bare repository named "gateway.git": …` |
| The suite failed | The suite output; the runner exits with the suite's status. |
| The reference changed during the run | `the reference carries changes to its tracked files:` plus the changes |

Temporary checkouts are removed on failure and interruption. A checkout you supplied is never removed.

## CI

The `compatibility` job of `.github/workflows/ci.yml` runs `bun run compatibility`, then checks that all three reference trees match the tested revision. It reads the manifest and has no path or revision of its own. The job is **blocking**: a red compatibility job is a red build.

The release runs the suite **again** against the published image, not the source: the `compatibility` job of `.github/workflows/release.yml` starts the image by digest and points the suite at it with `ACCESS_EXTERNAL_URL`. The gateway talks to exactly the bytes that ship.
