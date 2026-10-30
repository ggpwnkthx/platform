# The changelog of the platform

The releases of the platform, the newest first. A release is a tag, and
the tag names the version of the package of the root: the workflow of
the release refuses a tag that does not.

The **contract** of a release is the specification of the workspace it
changes: a change of behaviour is a change of the specification first,
in the same commit as the code.

## Unreleased

## 1.0.4

The versions 1.0.1 to 1.0.3 were attempted and never shipped: the
images of a release that failed its gates were not withdrawn, and a
release that leaves an image behind is not a release. The entries of
this release are the entries of the release that ships.





## 1.0.0

The **first release of the platform**: the merge of the three
repositories into one repository with three workspaces.

The three services are the same services, with the same behaviour and
the same contracts. What changed is the shape of the source, the shape
of the continuous integration and the shape of the documentation.

### One repository, three workspaces

The three services were published from three repositories of their own,
and each of them is a workspace of this repository now:

| The service | The workspace |
| --- | --- |
| The gateway | `packages/gateway/` |
| The access service | `packages/access/` |
| The data service | `packages/data/` |

One `bun install` installs the three workspaces, one lockfile pins every
dependency, and the root of the repository is the only place a
dependency is declared.

The three services stay separate processes. A workspace never imports
the source of another one: the services talk over HTTP, and the merge
keeps that.

### One continuous integration

There were three workflows of the continuous integration, three
workflows of the release and three taggers. They were close to each
other and they drifted.

There is one workflow of the continuous integration, one tagger, one
workflow of the images and one workflow of the binaries. The jobs of the
three services are the jobs that existed, and they are the same jobs.

### One version line

The tag of a release is `v1.0.0` of this repository, and it publishes
the three images and the three binaries at the same version. The status
of a specification is the release that carries it.

The images carry the name of the role of the service:
`ghcr.io/ggpwnkthx/gateway`, `ghcr.io/ggpwnkthx/access` and
`ghcr.io/ggpwnkthx/data`. A deployment that pinned the name of an image
has to name the new one.

The **environment** of the services is renamed with them: the prefixes
`GATEWAY_`, `ACCESS_` and `DATA_` are the contract of a deployment, and
they are what a deployment of the platform reads.

The published client of the data service keeps its name:
`@data-backend/client` is a package that consumers install, and renaming
it would break them.

### One baseline of the compatibility

The baseline of the compatibility suite named two repositories and two
commits: the gateway and the access service had a source of their own.

The baseline is the revision of this repository now, and the references
of the suite are the workspaces of it. A run may still test a published
revision of a service: the environment names a repository and a commit,
and the suite clones them.

### One version

The three services were three repositories, and each of them carried a
version of its own. The platform has one version, and every file that
names a release names the same one:

| Workspace | The version of the platform |
| --- | --- |
| `packages/gateway/` | `1.0.0` |
| `packages/access/` | `1.0.0` |
| `packages/data/` | `1.0.0` |
