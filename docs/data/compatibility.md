# Compatibility

How the data service proves it works with the platform contracts it does not own: the compatibility
harness runs the **real** gateway, access service and data service of this repository against a real
PostgreSQL server.

The gateway signs the caller's identity; the access service owns identities, tenants and grants.

## Integration baseline

`compatibility.json` at the repository root is the single owner of the three service workspaces and
of the revision tested against them.

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

- The baseline is a pinned, immutable repository revision. Changing it means changing the manifest
  and running the harness again.
- References: the gateway (`packages/gateway/`) and access service (`packages/access/`) at the pinned
  revision. The harness clones them at that revision, installs their dependencies and proves the
  clones' tracked files match the revision.
- Candidate: the data service (`packages/data/`) from the working tree. The harness proves the run
  did not change it.
- A run may instead test a **published** revision named in the environment; the reference is cloned
  at that revision. That is a candidate run, and the harness reports it is not proof of the baseline.

The baseline is also stated in [spec](spec.md) §1.1. Check that the two agree:

```bash
bun run check:compatibility
```

The check also refuses a CI workflow that pins its own revision: a pin written twice drifts, and a
harness run against a revision other than the specification's proves nothing.

## Platform release `1.0.0`

The platform release is a **MAJOR** change to the gateway and access-service contracts. The data
service API contract is unchanged: every route is still `v1`, the gateway identity is still `v5`, and
the access context is still version `1`. The data service only reads platform contracts, so the
changes below are what a platform deployment must do and what the data service must follow.

### Gateway

The gateway closes five deployment security defects. One changes a contract the data service reads
(the identity subject); the other four concern only the gateway's deployment. The harness proves the
data service against the real release gateway.

| Change | Effect on the data service |
| --- | --- |
| The caller **subject** is written **as is**: never rewritten; a subject that cannot be written into a header is refused by the gateway with a `500`. | The access-service subject is a UUID and the backend requires it. The backend reads the header as is and rebuilds the signed bytes from it: it MUST NOT trim or normalize it. The unit suite proves a subject the gateway did not write is refused. |
| The **host** is decided before the method: a catch-all naming `GET` does not answer a `GET` for a host that has its own route. | Backend bindings are per host, and the route comes from the binding matching the signed host. A deployment relying on a gateway catch-all must move the hosts it names into the catch-all. |
| The **caller address** is the `x-forwarded-for` entry `GATEWAY_TRUSTED_PROXY_HOPS` positions from the right. | New gateway deployment variable. Behind a single ingress there is nothing to do: the default is one. |
| **Trusted proxy ranges** from the environment replace those from the route table. | Gateway deployment concern. A deployment that set `GATEWAY_TRUSTED_PROXIES` and relied on the file's ranges must name those ranges in the variable. |
| **Redis shared-state users** are described in a file with one rule per line and no passwords. | The deployment sets the two users' passwords after the server starts. Gateway deployment concern; the data service holds no shared state. |

Unchanged: the route table format, the decision protocol, the identity headers and the signature
version (`v5` is still `v5`; legacy `v4` is still refused by current-format routes).

### Access service

The access-service contract changed; the access context contract the data service speaks did not.
Discovery, request, answer and rules are still version `1`, and the extension carrying it is still
the data service's extension.

| Change | Effect on the data service |
| --- | --- |
| **Gateway credentials** are always scoped to their tenant. The deployment bearer token is the only unscoped scheme, and it is deprecated. | None: the data service does not call the decision endpoint. It speaks the access context contract with its own credential, scoped to the tenants it may ask about. Gateway deployment concern. |
| Platform-owned **tenant flags** (`shared_client`, `is_default`) are set by the platform operator. | None: the data service holds and administers no access-service tenant. |
| The administration **limiter budget** is spent by failing calls, and **provider calls** go to the checked address. | None: the data service calls no provider; it uses the identity the gateway forwards. |
| **Answers carry browser headers**, and token endpoint answers are never cached. | None: the data service reads only the access context body. |

Access-service token subjects are **UUIDs**, and the release gateway writes them into the identity
headers as is (never rewritten, always writable). So the backend principal is the access-service
principal's UUID, and the two services never disagree about the caller.

## Harness

```bash
bun run --cwd packages/data test:compat
```

The harness clones the gateway and access service at the pinned revision, starts them with PostgreSQL
and a data service deployment, and runs the specification's acceptance scenario through the gateway:
a client discovers a collection, creates a record under its own identity, reads the fields it may
read, updates its record with a current validator, observes the audit metadata, and proves another
tenant cannot reach the data.

The platform command runs both platform suites (access-service contract and platform acceptance):

```bash
bun run compatibility
```

## Reference sources

References come from the pinned revision unless the environment names another. Source precedence:
explicit repository, then mirror, then local repository, then the manifest URL.

| Variable | Meaning |
| --- | --- |
| `GATEWAY_REPOSITORY` | Gateway repository: a git URL or a local repository path. |
| `ACCESS_REPOSITORY` | Access service repository. |
| `GATEWAY_COMMIT` | Gateway revision. |
| `ACCESS_COMMIT` | Access service revision. |
| `COMPAT_MIRROR` | Directory holding the bare mirrors `gateway.git` and `access.git`. |
| `COMPAT_KEEP` | If set, keep the run's temporary directory. |

```bash
GATEWAY_REPOSITORY=/srv/mirrors/gateway ACCESS_REPOSITORY=/srv/mirrors/access \
  bun run --cwd packages/data test:compat
```

- A path repository is cloned from that path without network access. A URL with or without `.git`
  names the same mirror.
- `GATEWAY_COMMIT` and `ACCESS_COMMIT` override the revision; such a run is a candidate run, not proof
  of the baseline. An override that is not a full revision is an error, and the harness never falls
  back to another source.

## Access service extension

The access context contract is a **required integration and deployment dependency**: an access
service that does not answer `/v1/access-context` cannot serve this data service, which fails closed
without it.

The extension is **upstream**: the platform's access service carries it, and the harness baseline is
a revision that includes it. The data service holds no copy; platform contracts live in the platform
repository and the harness proves them against the real access service. An access-service contract
change takes two steps:

1. Land the change in the access service workspace, preserving the existing gateway decision
   contract.
2. Pass the harness against the new revision.

## Signature fixtures

The gateway itself produces the identity signature fixture: the canonical payload and signature come
from gateway code, and data service tests check their own verification against those bytes.

```bash
GATEWAY_CHECKOUT=/path/to/platform/gateway \
  bun run --cwd packages/data scripts/dev/generate-fixtures.ts
```

- The checkout must be at the repository revision: the fixture is evidence of that revision's
  contract, and it records the revision it comes from.
- The fixture also carries legacy `v4`, which the backend still reads for older gateways. The gateway
  stopped signing `v4` in release `1.0.0`, so the `v4` key derivation is the one part the harness and
  generator keep locally; payload and signature still come from gateway code.
