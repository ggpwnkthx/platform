# Access

This workspace holds Access, the platform's OpenID Connect broker and access decision service. It authenticates callers against each tenant's identity provider, maps them to principals, issues its own tokens to the gateway, and answers the gateway's decision contract.

Documentation: [docs/access/](../../docs/access/README.md). Environment variables: [configuration](../../docs/access/configuration.md), with development values in [.env.example](.env.example). Contribution workflow: [CONTRIBUTING.md](../../CONTRIBUTING.md). Releases: [CHANGELOG.md](../../CHANGELOG.md).

## Place in the platform

| Workspace | Relationship |
| --- | --- |
| [`packages/gateway/`](../gateway/) | Client of Access: authenticates callers here, asks for decisions, and forwards the principal's identity upstream. |
| [`packages/data/`](../data/) | Reads `/v1/access-context` to learn what a caller may do. |

The services are separate processes in one repository. Access talks to them over HTTP and OpenID Connect and depends on neither at runtime. It reads only the `ACCESS_*` variables.

## Commands

```bash
bun install
ACCESS_SECRET_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) bun run src/main.ts

bun run --cwd packages/access test        # this workspace's tests
bun run --cwd packages/access test:compat # the real gateway, unchanged, against this service
bun run compatibility                     # both, plus platform acceptance
```

Platform-wide checks, from the repository root:

```bash
bun run typecheck      # types of all three workspaces
bun run lint           # linter
bun run format:check   # formatting
bun run dead           # unused code
bun run versions       # one platform version everywhere
bun run test           # tests of all three workspaces
bun run compatibility  # the three services together
```
