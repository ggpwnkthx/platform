# Gateway

The platform's application gateway, workspace `packages/gateway/` of [the platform](../../README.md). It
authenticates each caller, asks Access what the caller may do, and forwards the request to the
matched route's upstream with a signed identity.

The gateway has no domain model: workspaces, roles and quotas live in Access. It enforces
"authenticated, authorized for this workspace, forwarded safely" and nothing else. Documentation lives in
[docs/gateway](../../docs/gateway/README.md); the contract is the
[specification](../../docs/gateway/spec.md).

It is a service, not a library: there is no published package or exported API. You build it, deploy it and
reach it over HTTP. An upstream that wants to trust the forwarded identity copies the standalone
[reference verifier](examples/upstream-identity/verify.ts) (it imports nothing from the gateway) or writes
its own, and tests it against the gateway revision it pins; see
[Upstream identity](../../docs/gateway/upstream-identity.md).

## Quick start

From the repository root:

```bash
bun install
bun run dev          # the whole platform: the three services and the development server
bun run dev:gateway  # the gateway alone, with local fixtures
```

`dev:gateway` starts a fixture identity provider, Access and two upstreams, writes a configuration
file for them, and serves the gateway on `http://localhost:8080`:

```bash
curl -s http://localhost:8080/healthz
curl -s http://localhost:8080/readyz | jq
```

The control plane runs as a separate process and needs a shared state and a token map:

```bash
export GATEWAY_CONTROL_STATE_URL=redis://127.0.0.1:6379/0
export GATEWAY_CONTROL_TOKENS='{"a-token-of-at-least-16-characters":{"operator":"me","scope":"config"}}'
bun run control        # http://127.0.0.1:9090
```

Configuration: the route table format is in [spec §3](../../docs/gateway/spec.md#3-configuration-file),
every environment variable is in [Configuration](../../docs/gateway/configuration.md) (and
[.env.example](.env.example)), and deployment is in [Operations](../../docs/gateway/operations.md).

## Checks

The platform checks run from the repository root, as listed in the
[contribution guide](../../CONTRIBUTING.md):

```bash
bun run typecheck      # types
bun run lint           # linter
bun run format:check   # formatting
bun run dead           # unused code
bun run versions       # release version is the same everywhere
bun run test           # every test of the three workspaces
```

Gateway tests only:

```bash
bun test --cwd packages/gateway src              # domain unit tests
bun test --cwd packages/gateway test/contract    # pipeline contract tests
bun test --cwd packages/gateway test/network     # tests against a real socket
bun test --cwd packages/gateway test/browser     # tests in a real browser
bun test --cwd packages/gateway test/integration # tests against real Redis and Postgres
```

Tests that need a Redis or Postgres server are skipped without one. To run them locally:

```bash
scripts/dev/redis-dev.sh start 6399
GATEWAY_TEST_REDIS_URL=redis://127.0.0.1:6399/0 bun test test/integration
scripts/dev/redis-dev.sh stop 6399

scripts/dev/postgres-dev.sh start 5432
GATEWAY_TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/gateway bun test test/integration
scripts/dev/postgres-dev.sh stop 5432
```

`postgres-dev.sh` downloads and extracts **PostgreSQL 18** (nothing is installed), the version CI tests
against. The full check list is in [Internals](../../docs/gateway/internals.md#verification).
