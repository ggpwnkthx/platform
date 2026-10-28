# The compatibility suite and the reference of the gateway

The compatibility suite runs the **real gateway of the platform**,
unchanged, against the access service. The gateway is a reference: it
is the workspace `packages/gateway/` of the revision that the manifest
pins, and it is never modified.

This document is the manual of the runner: where the reference comes
from, how to run the suite, how to test another revision, and what
happens when something is wrong.

The compatibility of the three services together is described in
[the compatibility of the platform](../platform/compatibility.md).

## The reference

The reference is the workspace `packages/gateway/` of the revision that
the manifest pins. The baseline is that revision, and the manifest
`compatibility.json` at the root of the repository is the one place
where the workspaces are named:

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

The format is checked by the runner, and it is deliberately strict:

- `version` is `2`. A manifest of another version is refused.
- `repository` is the repository of the platform.
- `workspaces` names the three workspaces of the platform, and a
  workspace it does not know is refused.
- a workspace may name a `source`: the repository and the revision it is
  pinned to. The revision is a commit of forty hexadecimal characters, and
  a branch is refused. A workspace with a source is a **reference**: it is
  cloned at that revision. A workspace without one is the **candidate** of
  the run: the tree of the working directory.

There is no second pin. The workflow of the continuous integration does
not carry a path and a revision of its own: it reads the manifest, like
the runner and like a developer do.

The reference is a **clone**: the runner clones the source of the
manifest at the pinned revision, it installs the dependencies of the
clone, and it uses the workspace `packages/gateway/` of the clone. The
local repository is the source of the clone when it holds the pinned
revision, so a runner that has the revision does not need the network to
test it.

The clone is checked: the tracked files of it have to be the ones of the
revision, and the tree of a developer is never written to.

## Running the suite

A fresh checkout of this repository runs the real compatibility suite
with one command:

```bash
bun install --frozen-lockfile
bun run --cwd packages/access test:compat
```

The command does everything:

1. it reads `compatibility.json` relatively to the root of the
   repository, whatever the directory the command runs in is;
2. it clones the gateway of the pinned revision, it installs the
   dependencies of the clone, and it checks that the tracked files of
   the clone are the ones of the revision;
3. it runs `bun test test/compatibility` with the path of the reference
   in `ACCESS_GATEWAY_PATH`: the gateway runs as a process, in its own
   directory, with its own configuration;
4. it checks that the reference is unchanged after the run.

The runner prints the revision it tested:

```
the reference is cloned from /srv/platform at 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c
the reference is unchanged: it is still 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c
the compatibility suite passed against the gateway at 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c (the baseline of the manifest (https://github.com/ggpwnkthx/platform.git at 0f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c))
```

The revision is a commit, not a branch: the
[baseline of the integration](https://github.com/ggpwnkthx/platform) is
the exact code that the access service is tested against.

## The tests of the workspace, and the compatibility suite

The two are separate, and the split is explicit:

| Command | What it runs |
| --- | --- |
| `bun run --cwd packages/access test` | The tests of **this** workspace: the units, the contracts, the integrations and the boundaries. It needs no gateway and no sibling directory. |
| `bun run --cwd packages/access test:compat` | The compatibility suite: the real gateway of the platform, unchanged, against the access service. |
| `bun run compatibility` | The two, and the acceptance of the platform. |

`bun test` alone, without an argument, also collects the compatibility
suite, and the suite then fails with a message that says how to prepare
the reference. It is `bun run test` that a developer runs every day.

## The sources of the reference

The runner reads its source from the environment. The order is the one
of the list below: **the first one that is set wins.**

| Variable | What it is |
| --- | --- |
| `ACCESS_GATEWAY_PATH` | The directory of the gateway that is already prepared. It is used as it is: the runner never resets it, never cleans it and never checks out over it. |
| `GATEWAY_REPOSITORY` | The repository of the gateway: a git url, or the path of a local repository. It has to hold the revision of `GATEWAY_COMMIT`. |
| `GATEWAY_COMMIT` | The revision of the gateway: forty hexadecimal characters. |
| `COMPAT_MIRROR` | A directory that holds a bare repository named `gateway.git`. It is the way to run the suite without the network. |
| — | The workspace of this repository: the canonical source. |

Two variables are about the run itself:

| Variable | What it is |
| --- | --- |
| `COMPAT_WORKSPACE` | The directory the checkout is created in. It is a temporary directory by default. |
| `COMPAT_KEEP` | When it is set, the checkout is kept after the run: the tree of the reference is then inspected by hand. |
| `COMPAT_TESTS` | The test files of the suite, separated by spaces. The whole of `test/compatibility` by default. It is the way to run one file of the suite. |

### The access service of the suite

The suite runs against an access service that it starts itself, in the
process of the test. It can also run against an access service that is
**already running** — the image of a release, for instance — when the
environment names it:

| Variable | What it is |
| --- | --- |
| `ACCESS_EXTERNAL_URL` | The url the callers reach that access service at. The suite then never starts one of its own. |
| `ACCESS_EXTERNAL_ADMIN_TOKEN` | The token of the administration of that access service. |
| `ACCESS_EXTERNAL_ACCESS_TOKEN` | The token of the decisions of that access service: the gateway asks it for the roles of the principal. |

```bash
# An access service that is already running, and the gateway of the
# platform against it.
ACCESS_EXTERNAL_URL=http://127.0.0.1:8081 \
ACCESS_EXTERNAL_ADMIN_TOKEN=the-admin-token \
ACCESS_EXTERNAL_ACCESS_TOKEN=the-access-token-of-the-development \
bun run --cwd packages/access test:compat
```

The suite never creates what the environment names: a suite that is
supposed to prove the image of a release has to talk to that image, and
a suite that talks to another access service proves nothing about it.

### A published revision of the gateway

```bash
GATEWAY_REPOSITORY=https://github.com/ggpwnkthx/platform.git \
GATEWAY_COMMIT=d3cdb48b79c3962e66bf51d8f386132baff824b7 \
bun run --cwd packages/access test:compat
```

The repository is cloned, not used as it is: the checkout of the runner
is a fresh one at the revision, and the tree of the source is never
touched. The source has to hold the revision — a repository whose
default branch moved away from the revision is refused with the name of
the commit it does not hold.

This is the way to test a **published** release of the platform against
the access service of the tree.

### A mirror, without the network

```bash
mkdir -p /srv/compat-mirror
git clone --bare https://github.com/ggpwnkthx/platform.git /srv/compat-mirror/gateway.git
COMPAT_MIRROR=/srv/compat-mirror bun run --cwd packages/access test:compat
```

The mirror is a bare repository named after the reference. The same
convention is used by the harness of the data service, so a mirror that
serves one serves the other.

## When it fails

An override that is set and that cannot be used is an **error**: the
runner never falls back to another source, because a suite that runs
against another revision is a suite that proves nothing.

| Situation | What the runner says |
| --- | --- |
| The reference carries changes | `the workspace … carries changes to its tracked files:` and the list of the changes |
| The source does not hold the revision | `the source … does not hold the pinned commit …` |
| The clone failed | `the clone of … failed:` and the output of git, with the ways to give another source |
| The mirror holds no `gateway.git` | `COMPAT_MIRROR names a directory that holds no bare repository named "gateway.git": …` |
| The suite failed | The output of the suite, and the status of the suite is the status of the runner. |
| The reference was modified during the run | `the reference carries changes to its tracked files:` and the list of the changes |

The temporary checkout is removed when the run fails and when the run is
interrupted. A checkout that a developer supplied is never removed.

## Testing another revision

The reference moves with the platform: a change of the gateway that
breaks the suite is a change of the contract, and it is fixed in the
gateway, in this repository.

A **published** revision of the gateway is tested with the two
variables of the environment:

```bash
GATEWAY_REPOSITORY=https://github.com/ggpwnkthx/platform.git \
GATEWAY_COMMIT=d3cdb48b79c3962e66bf51d8f386132baff824b7 \
bun run --cwd packages/access test:compat
```

The run prints the revision it tested. A run with an override is a run
of a **candidate**: it is not the proof of the baseline of the
repository.

## What the CI does

The job `compatibility` of `.github/workflows/ci.yml` runs
`bun run compatibility`, and it checks, in a second step, that the trees
of the three references are the ones of the revision that is tested. The
job reads the manifest: it carries no path and no revision of its own.

The job is **blocking**: a red compatibility job is a red build,
whatever the rest says.

The release runs the suite **again**, against the published image of the
release and not against the source: the job `compatibility` of
`.github/workflows/release.yml` starts the image by its digest and
points the suite at it with `ACCESS_EXTERNAL_URL`. The bytes that the
gateway of the platform talks to are the bytes that are published.
