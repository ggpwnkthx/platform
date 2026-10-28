# Compatibility

Proof that the three services still talk to each other over HTTP the way their specs say, tested against a pinned baseline revision.

## Baseline

The baseline is a pinned **revision** of this repository. The gateway and access service at that revision are the **references**: the harness clones them. The access and data services in the working tree are the **candidates** tested against them.

The manifest is [`compatibility.json`](../../compatibility.json) at the repository root. Its shape (commit shown as a placeholder):

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

A workspace with a `source` is a reference; one without is a candidate.

The manifest is the single owner of the baseline. The harness, the docs and the drift check all read it, so the pin is never written twice.

The pin moves every release: a release's baseline is the revision it was released at, and the next release tests its candidates against it.

**Why a revision, not the tree?** Comparing the tree with itself proves nothing. Testing against a revision a deployment may still run answers the question a release must answer.

## Suites

| Suite | Proves | Command |
| --- | --- | --- |
| Access service contract | The pinned gateway works with the tree's access service | `bun run --cwd packages/access test:compatibility` |
| Platform acceptance | The tree's data service works with the pinned gateway and access service | `bun run --cwd packages/data test:compatibility` |

Run both with:

```bash
bun run compatibility
```

## References and candidates

The harness clones each reference at the pinned revision, installs the clone's dependencies, and checks that its tracked files match the revision. It clones from the local repository when it has the revision (no network needed), and from the manifest URL otherwise.

A candidate is the working tree and may carry uncommitted changes; those changes are what is under test. The harness checks that the suites did not alter it: the candidate's tracked changes at the end of the run must match those at the start.

Overrides:

| Variable | Sets |
| --- | --- |
| `GATEWAY_REPOSITORY`, `GATEWAY_COMMIT` | Gateway revision |
| `ACCESS_REPOSITORY`, `ACCESS_COMMIT` | Access service revision |
| `DATA_REPOSITORY`, `DATA_COMMIT` | Data service revision |
| `ACCESS_GATEWAY_PATH` | A gateway that is already prepared |
| `COMPAT_MIRROR` | Directory of bare repository mirrors |
| `COMPAT_WORKSPACE` | Directory where checkouts are created |
| `COMPAT_KEEP` | If set, keep checkouts after the run |

A run with an override tests a **candidate**, not the manifest's baseline, and the harness says so.

## Running against a live service

The access and data service suites can target a service that is **already running**; releases use this to prove the published image:

| Variable | Sets |
| --- | --- |
| `ACCESS_EXTERNAL_URL` | URL callers use to reach the access service |
| `ACCESS_EXTERNAL_ADMIN_TOKEN` | Its administration token |
| `ACCESS_EXTERNAL_ACCESS_TOKEN` | Its decision token |

The suite never creates what these variables name: a suite meant to prove a release image must talk to that image.

## Databases

The access and data service suites use the process's embedded PostgreSQL by default, or a real server when configured:

| Variable | Sets |
| --- | --- |
| `ACCESS_TEST_DATABASE_URL` | PostgreSQL for access service tests |
| `ACCESS_TEST_REDIS_URL` | Redis for access service tests |
| `GATEWAY_TEST_REDIS_URL` | Redis for gateway tests |
| `GATEWAY_TEST_POSTGRES_URL` | PostgreSQL for gateway tests |

The data service harness starts its own PostgreSQL server in a temporary directory, because it needs several databases and roles isolated from the development server.
