# The compatibility of the platform

The platform is three services, and they speak to each other over HTTP.
The compatibility of the platform is the proof that the three still
speak to each other the way their specifications say.

## The baseline

The baseline is a **revision** of this repository, and it is pinned in
the manifest. The gateway and the access service are the **references**
of the suites: the harness clones them at the pinned revision. The
access service and the data service of the tree are the **candidates**,
and they are the services that are tested against the references.

The manifest of the baseline is [`compatibility.json`](../../compatibility.json),
at the root of the repository:

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

A workspace with a `source` is a reference, and a workspace without one
is a candidate.

It is the one place that owns the workspaces of the baseline, and the
harness, the documentation and the check of the drift read it: a pin
that is written twice is a pin that will drift.

The pin moves at every release: the baseline of a release is the
revision it was released at, and the release that follows tests its
candidates against it.

**Why the baseline is a revision and not the tree.** A suite that
compares the tree with itself proves that the tree agrees with the tree.
The candidates are tested against a revision that a deployment can still
be running, which is the question a release has to answer.

## The suites

There are two, and they prove two different things.

| Suite | What it proves | The command |
| --- | --- | --- |
| The contract of the access service | The gateway of the pinned revision, against the access service of the tree. | `bun run --cwd packages/access test:compatibility` |
| The acceptance of the platform | The data service of the tree, against the gateway and the access service of the pinned revision. | `bun run --cwd packages/data test:compatibility` |

The command of the platform runs the two:

```bash
bun run compatibility
```

## The references

A reference is a **clone**: the harness clones the source of the
manifest at the pinned revision, it installs the dependencies of the
clone, and it checks that the tracked files of the clone are the ones of
the revision.

The local repository is the source of the clone when it holds the pinned
revision: a runner that has the revision does not need the network to
test it. The url of the manifest is the source when no local repository
holds the revision.

A candidate is the tree of the working directory, and it may carry
changes: those changes are the code that is under test. The harness
proves that the suites did not change it — the tracked changes of the
candidate are the ones of the beginning of the run when the run ends.

| Variable | What it names |
| --- | --- |
| `GATEWAY_REPOSITORY` and `GATEWAY_COMMIT` | The revision of the gateway. |
| `ACCESS_REPOSITORY` and `ACCESS_COMMIT` | The revision of the access service. |
| `DATA_REPOSITORY` and `DATA_COMMIT` | The revision of the data service. |
| `ACCESS_GATEWAY_PATH` | A gateway that is already prepared. |
| `COMPAT_MIRROR` | A directory that holds the bare mirrors of the repositories. |
| `COMPAT_WORKSPACE` | The directory the checkouts are created in. |
| `COMPAT_KEEP` | When it is set, the checkouts are kept after the run. |

A run with an override is a run of a **candidate**: it is not the proof
of the baseline of the manifest, and the harness says so.

## The environments of the suites

The suites of the access service and of the data service can run against
a service that is **already running**, and that is how the release
proves the published image:

| Variable | What it names |
| --- | --- |
| `ACCESS_EXTERNAL_URL` | The url the callers reach the access service at. |
| `ACCESS_EXTERNAL_ADMIN_TOKEN` | The token of its administration. |
| `ACCESS_EXTERNAL_ACCESS_TOKEN` | The token of its decisions. |

The suite never creates what the environment names: a suite that is
supposed to prove the image of a release has to talk to that image, and
a suite that talks to another service proves nothing about it.

## The databases

The suites of the access service and of the data service run on the
embedded PostgreSQL of the process by default, and on a real server when
the environment names one:

| Variable | What it names |
| --- | --- |
| `ACCESS_TEST_DATABASE_URL` | The PostgreSQL server of the tests of the access service. |
| `ACCESS_TEST_REDIS_URL` | The Redis server of the tests of the access service. |
| `GATEWAY_TEST_REDIS_URL` | The Redis server of the tests of the gateway. |
| `GATEWAY_TEST_POSTGRES_URL` | The PostgreSQL server of the tests of the gateway. |

The harness of the data service starts a PostgreSQL server of its own,
in a temporary directory: it needs several databases with several roles,
and it needs them isolated from the server of the development machine.
