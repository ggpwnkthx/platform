# The compatibility with the platform

The data service does not own the contracts of the platform. The gateway
signs the identity of the caller, and the access service owns the
identity, the tenants and the grants. The data service proves that it
works with them: the compatibility harness runs the **real** gateway,
the **real** access service and the **real** data service of this
repository, against a real PostgreSQL server.

## The baseline of the integration

The manifest `compatibility.json`, at the root of the repository, is the
one place that owns the workspaces of the three services and the
revision that is tested against them.

<!-- compatibility-manifest:start -->

```json
{
  "version": 2,
  "repository": "https://github.com/ggpwnkthx/platform.git",
  "workspaces": {
    "gateway": {
      "path": "packages/gateway",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "d3cdb48b79c3962e66bf51d8f386132baff824b7"
      }
    },
    "access": {
      "path": "packages/access",
      "source": {
        "repository": "https://github.com/ggpwnkthx/platform.git",
        "commit": "d3cdb48b79c3962e66bf51d8f386132baff824b7"
      }
    },
    "data": {
      "path": "packages/data"
    }
  }
}
```

<!-- compatibility-manifest:end -->

The baseline is a revision of the repository, pinned in the manifest: it is
immutable, and a change of it is a change of the manifest and a new run of
the harness.

The references of the harness are the gateway of `packages/gateway/` and
the access service of `packages/access/`, at the revision the manifest
pins: the harness clones them at that revision, it installs their
dependencies, and it proves that the tracked files of the clones are the
ones of the revision. The data service of `packages/data/` is the
candidate: it is the tree of the working directory, and the harness
proves that the run did not change it.

A run may test a **published** revision of a service instead: the
environment names a repository and a revision, and the reference is
cloned at that revision. Such a run is a run of a candidate, and the
harness says that it is not the proof of the baseline.

The baseline is written in the [specification](specification.md) §1.1,
and the check of the drift proves that the two still agree:

```bash
bun run check:compatibility
```

The check also refuses a workflow of the continuous integration that
holds a revision of its own: a pin that is written twice is a pin that
drifts, and a harness that runs against another revision than the one
of the specification proves nothing.

## The release `1.0.0` of the platform

The release of the platform changes the contracts of the gateway and of
the access service: they are **MAJOR** ones for the two of them. The
contract of the API of the data service does not change: the path of
every route is still `v1`, the identity of the gateway is still the
version `v5`, and the access context of the access service is still the
version `1`. The data service reads the contracts of the platform and
never writes them, so the changes below are the ones a deployment of the
platform has to make, and the ones the data service has to follow.

### The gateway

The gateway closes five defects of the security of a deployment. One of
them changes the contract that the data service reads — the subject of
the identity — and the four others are the business of the deployment of
the gateway. The harness proves the data service against the real
gateway of the release:

| The change | What it means for the data service |
| --- | --- |
| The **subject** of the caller is written **as it is**: it is never rewritten, and a subject that cannot be written into a header is refused by the gateway with a `500`. | The subject of the identity of the access service is a uuid, and the backend requires it. The backend reads the header as it is and rebuilds the signed bytes from it: it MUST NOT trim it and MUST NOT normalize it. The unit suite proves that a subject that the gateway did not write is refused. |
| The **host** is decided before the method: a catch-all that names `GET` does not answer the `GET` of a host that has a route of its own. | The bindings of the backend are per host, and the backend derives the route from the binding that matches the signed host. A deployment that relies on a catch-all of the gateway has to move the hosts it names to the catch-all. |
| The **address of the caller** is the entry that is `GATEWAY_TRUSTED_PROXY_HOPS` positions from the right of the chain of `x-forwarded-for`. | The variable is new and it is the business of the deployment of the gateway. A deployment behind a single ingress has nothing to do: the default is one. |
| The **ranges of the trusted proxies** of the environment replace the ranges of the route table. | The variable is the business of the deployment of the gateway. A deployment that set `GATEWAY_TRUSTED_PROXIES` and relied on the ranges of its file has to name the ranges of the file in the variable. |
| The **users of the shared state in Redis** are described by a file that holds one rule per line, and the passwords are not in it. | The deployment writes the passwords of the two users after the server started. It is the business of the deployment of the gateway: the data service holds no shared state. |

The format of the route table, the protocol of the decisions, the
headers of the identity and the version of the signature are unchanged:
`v5` is still `v5`, and the legacy format `v4` is still refused by the
routes of the current format.

### The access service

The contract of the access service changed, and the access context
contract — the one the data service speaks — did not: the discovery, the
request, the answer and the rule of the access context are the ones of
the version `1`, and the extension that carries it is still the
extension of the data service.

| The change | What it means for the data service |
| --- | --- |
| The **credentials of a gateway** are always scoped to their tenant. The bearer token of the deployment is the only scheme that is not scoped, and it is deprecated. | The data service does not call the decision endpoint: it speaks the access context contract with its own credential, and that credential is scoped to the tenants it may ask about. The change is the business of the deployment of the gateway. |
| The **flags of a tenant** that belong to the platform (`shared_client`, `is_default`) are the work of the operator of the platform. | The data service holds no tenant of the access service and administers none. |
| The **budget of the limiter** of the administration is spent by the calls that fail, and the **call to a provider** is made to the address that was checked. | The data service calls no provider of the access service: the identity is the one the gateway forwards. |
| The **answers carry the headers of a browser**, and the answer of the token endpoint is never stored by a cache. | The data service reads the body of the access context and nothing else. |

The subject of the tokens of the access service is a **uuid**, and the
gateway of the release writes it into the headers of the identity as it
is: it is never rewritten, and it is always writable. The principal of
the backend is therefore the uuid of the principal of the access
service, and the two services never speak of two different callers.

## The harness

```bash
bun run --cwd packages/data test:compat
```

The harness clones the gateway and the access service at the revision
the manifest pins, it starts them with a PostgreSQL server and a
deployment of the data service, and it performs the acceptance scenario
of the specification through the gateway: a client discovers a
collection, it creates a record under its own identity, it reads the
fields it may read, it updates its own record with a current validator, it
observes the metadata of the audit, and it proves that another tenant
cannot reach the data.

The command of the platform runs the two suites of the platform — the
contract of the access service and the acceptance of the platform:

```bash
bun run compatibility
```

## The sources of the references

The harness takes the references from the revision the manifest pins, and
it takes them from another revision when the environment names one. The
order of the sources is the order of the list: an explicit repository
wins over a mirror, a mirror wins over the local repository, and the
local repository wins over the url of the manifest.

| Variable | What it is |
| --- | --- |
| `GATEWAY_REPOSITORY` | The repository of the gateway: a git url, or the path of a local repository. |
| `ACCESS_REPOSITORY` | The repository of the access service. |
| `GATEWAY_COMMIT` | The revision of the gateway. |
| `ACCESS_COMMIT` | The revision of the access service. |
| `COMPAT_MIRROR` | A directory that holds the bare mirrors `gateway.git` and `access.git`. |
| `COMPAT_KEEP` | When it is set, the temporary directory of the run is kept. |

```bash
GATEWAY_REPOSITORY=/srv/mirrors/gateway ACCESS_REPOSITORY=/srv/mirrors/access \
  bun run --cwd packages/data test:compat
```

A repository that is a path on the disk is cloned from that path, and
the clone of a local path does not use the network. A url with or
without the suffix `.git` names the same mirror.

`GATEWAY_COMMIT` and `ACCESS_COMMIT` name another revision: a run with
an override is a run of a candidate, and the harness says that it is
not the proof of the baseline. An override that is not a full revision
is an error, and the harness never falls back to another source.

## The extension of the access service

The access context contract is a **required integration and deployment
dependency**: an access service that does not answer
`/v1/access-context` cannot serve this data service, and the data
service fails closed without it.

The extension is **upstream**: the access service of the platform
carries it, and the baseline of the harness is a revision that carries
it. The data service holds no copy of the change. A contract of the
platform lives in the repository of the platform, and the harness proves
it against the real access service.

A change of the contract of the access service therefore has two steps:

1. the change lands in the workspace of the access service, and it
   preserves the existing contract of the decisions of the gateway,
2. the harness passes against the new revision.

## The fixtures of the signature

The fixture of the signature of the identity is produced by the gateway
itself: the canonical payload and the signature come from the code of
the gateway, and the test of the data service checks its own verification
against those bytes.

```bash
GATEWAY_CHECKOUT=/path/to/platform/gateway \
  bun run --cwd packages/data scripts/dev/generate-fixtures.ts
```

The workspace has to be the one of the revision of the repository: the
fixture is the evidence of the contract of that revision and not of
another one. The fixture carries the revision it comes from.

The fixture also carries the legacy format `v4`, because the backend
still reads it for the deployments whose gateway is older. The gateway
does not sign it any more — it was removed in the release `1.0.0` — so
the derivation of its key is the one part of the fixture that the
harness and the generator keep locally: the payload and the signature
are still the ones of the code of the gateway.
