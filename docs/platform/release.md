# The release of the platform

A release of the platform is a tag, and the tag names the version of the
package of the root. The tag publishes the three images and the three
binaries of the three workspaces.

## The line of the release

The version of the platform is one number, and it is written in every
place that names a release:

| Where | What it holds |
| --- | --- |
| `package.json` of the root | The version of the platform. It is the reference. |
| `package.json` of a workspace | The version of the platform. |
| `Dockerfile` of a workspace | The default of `ARG VERSION`. |
| `src/runtime/version.ts` of a workspace | The version that the probe of the health reports. |
| `docs/gateway/spec.md`, `docs/access/spec.md`, `docs/data/specification.md` | The status of the specification: the release it describes. |
| `CHANGELOG.md` of the root | The latest release. |

The check of the versions proves that they agree, and it runs in the
continuous integration and in the test suite:

```bash
bun run versions
```

There is one line. The three services were three repositories, and each
of them carried a version of its own; the repositories are retired, and
the lines they carried are not continued here. A specification that
describes another release describes a behaviour the code does not have,
and the check refuses it.

## The steps of a release

1. **The version goes up.** The package of the root and the packages of
   the three workspaces name the new version, the Dockerfiles carry it,
   the constants of the runtimes carry it, and the changelog of the
   platform describes it.

   ```bash
   bun run versions   # it proves that the files agree
   ```

2. **The continuous integration is green.** The tag is cut only after
   the proof: a release of a commit that did not pass the tests is a
   release that has to be withdrawn.

3. **The tag is cut.** The tagger refuses a version that is not newer
   than every tag of the repository, and it refuses a version that went
   down.

   ```bash
   bun run release:tag:dry-run   # what it would do
   bun run release:tag            # it does it
   ```

4. **The release is dispatched.** The tag is pushed with the token of
   the workflow, and GitHub does not start a workflow on a push that
   carries it: the workflow of the tag dispatches the workflow of the
   images and the workflow of the binaries on the tag it published.

5. **The images are published.** The workflow of the images builds the
   three images, publishes them with their provenance and their SBOM,
   and runs every gate against the **digest** of what it published. A
   gate that fails withdraws the images from the registry.

6. **The binaries are published.** The workflow of the binaries compiles
   the three services for the seven supported platforms, proves that
   the binary of the runner starts and serves, and publishes the
   archives on the release of the tag.

## What a release carries

| Artifact | Where |
| --- | --- |
| The image of the gateway | `ghcr.io/ggpwnkthx/gateway:<version>` |
| The image of the access service | `ghcr.io/ggpwnkthx/access:<version>` |
| The image of the data service | `ghcr.io/ggpwnkthx/data:<version>` |
| The binaries | The assets of the release of the tag. |
| The typed client of the data service | `data-backend-client-<version>.tgz`, and the registry of the packages. |

A binary carries the runtime of the release inside it: nothing else has
to be installed. The archive of the access service carries the
migrations of its schema next to the executable, and the archive of the
data service carries its manifests and its migrations.

## The gates of a release

The gates are the ones of the continuous integration, run against the
published bytes:

- the image starts with the configuration of a deployment and answers
  its probes;
- the image refuses to start when the environment of a production is
  not complete, and it names the secret that misses;
- the image is scanned, and a finding of a severity above high fails
  the release;
- the binary of the runner starts, serves the probes and stops;
- the compatibility suite runs the three services of the release
  together.

## The rollback

A release that failed its gates publishes nothing: its images are
withdrawn from the registry, and the tag of the release points at
nothing.

A release that failed **after** it was published is rolled back by the
deployment: the image of the previous release is deployed. The schema of
the data service is not rolled back with its image.
