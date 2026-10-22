# The access service

The access service is an OpenID Connect **broker** and an **access
decision service**. It authenticates a caller against the identity
provider of a tenant, maps the external identity to a principal, issues
its own tokens to the gateway, and answers the decision contract that
gateway already speaks.

It is the workspace `packages/access/` of [the platform](../../README.md).

**The documentation is in [`docs/access/`](../../docs/access/), and its index is [docs/access/README.md](../../docs/access/README.md).**

| Document | What it holds |
| --- | --- |
| [docs/access/spec.md](../../docs/access/spec.md) | The normative behavior: the contract of the service. |
| [docs/access/api.md](../../docs/access/api.md) | The HTTP surface: every endpoint, its request, its answer. |
| [docs/access/architecture.md](../../docs/access/architecture.md) | How the code is laid out and what the build checks. |
| [docs/access/operations.md](../../docs/access/operations.md) | Deployment, configuration, probes, alerts, runbooks, capacity. |
| [docs/access/security.md](../../docs/access/security.md) | The security model and the review, with the open findings. |
| [docs/access/release.md](../../docs/access/release.md) | Readiness, the cutover of a tenant, the delivery, the known limits. |
| [docs/access/compatibility.md](../../docs/access/compatibility.md) | The reference of the compatibility suite and the runner of it. |
| [../CHANGELOG.md](../../CHANGELOG.md) | The releases, and the changes of the contract of each one. |
| [../CONTRIBUTING.md](../../CONTRIBUTING.md) | The order of a change, the commands and the style of the repository. |

## The platform it is part of

| Workspace | What it is |
| --- | --- |
| [`packages/access/`](../access/) | This workspace: the OpenID Connect broker and the access decision service. |
| [`packages/gateway/`](../gateway/) | The HTTP gateway. It is the client of the access service: it authenticates a caller at the access service, it asks it for a decision and it forwards the identity of the principal to the upstream. |
| [`packages/data/`](../data/) | The data service of the platform. It reads the access context of the access service at `/v1/access-context` to know what a caller may do. |

The three are separate processes and separate services, and they are
three workspaces of one repository. The access service talks to them over
HTTP and over OpenID Connect, and it depends on neither of them at
runtime: the compatibility suite runs the **real** gateway of the
platform, unchanged, against the access service.

The environment of the access service is described in
[.env.example](.env.example), and it is the `ACCESS_*` group of the
platform.

## The commands

```bash
bun install
ACCESS_SECRET_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) bun run src/main.ts

bun run --cwd packages/access test       # the tests of this workspace
bun run --cwd packages/access test:compat # the real gateway of the platform, unchanged, against the access service
bun run compatibility           # the two, and the acceptance of the platform
```

The checks of the platform are at the root of the repository:

```bash
bun run typecheck      # the types of the three workspaces
bun run lint           # the linter
bun run format:check   # the formatting
bun run dead           # the code that nothing uses
bun run versions       # the version of the platform is the same everywhere
bun run test           # the tests of the three workspaces
bun run compatibility  # the three services together
```

The compatibility of the access service is described in
[docs/access/compatibility.md](../../docs/access/compatibility.md).
