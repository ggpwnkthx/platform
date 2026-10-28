# Development

Run, test and release the platform on your development machine. This page is the reference for root commands and run modes.

## Prerequisites

- **Bun 1.4.3 or later.** The specs rely on boundaries only observable on this line; see [gateway runtime](../gateway/runtime.md).
- **Docker or Podman**, for the PostgreSQL and Redis servers that integration tests need, and for the dev runner's PostgreSQL when the machine has no PostgreSQL binaries.
- **Git**, for the tagger and the compatibility suite's references.

## Install

```bash
bun install
```

One install covers every workspace, against the root lockfile. Where each dependency is declared: [Architecture](architecture.md#dependencies).

## Run modes

| Mode | Command | Starts | Use it for |
| --- | --- | --- | --- |
| [Platform](#platform) | `bun run dev` | Three services, console, PostgreSQL, identity provider (Bun processes, seeded) | Cross-service contracts, migrations, the login flow |
| [Gateway with fixtures](#gateway-with-fixtures) | `bun run dev:gateway` | Gateway, identity provider, access fixture, two upstreams in **one process** | Gateway-only work; fastest loop, needs only Bun |
| [Stack](#stack) | `docker compose … up` | Three services, PostgreSQL, Redis in **containers** | Cross-service contracts, migrations, images |
| [Services from source](#services-from-source) | `bun run --cwd …` | Each service run by Bun, against your own PostgreSQL | Debugging a service in your editor against a database you control |

### Platform

```bash
bun run dev
bun run dev --fresh   # wipe the PostgreSQL data first
```

Starts:

- PostgreSQL, data in `.pg/`
- identity provider (gateway fixture) on `:5556`
- access service on `:8081`
- data service on `:8082`
- gateway on `:8080`
- console on `:8083`

There is **one** PostgreSQL server; each service has its own database (`data`, `access`). The runner creates the access service's role and database; the access service applies its own migrations. The runner applies the data service's migrations, registers the dev workspace, and seeds the access service with a tenant, principal, group, permission roles, and grants for the dev route and the console. The seed is idempotent: a rerun updates the existing dev tenant.

It then prints addresses and credentials, for example:

```
  gateway         http://localhost:8080
  access service  http://127.0.0.1:8081
  data service    http://127.0.0.1:8082
  console         http://localhost:8083
  identity        http://127.0.0.1:5556
  postgres        postgres://data:data@127.0.0.1:41693/postgres
  databases       data, access

  sign in with    alice@gateway.test / alice-password
  sign in at      http://localhost:8080/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me
  workspace       11111111-1111-4111-8111-111111111111
  workspace API   http://localhost:8080/ws/11111111-1111-4111-8111-111111111111/v1/
  the console     http://localhost:8083/
```

A login crosses all three services: the gateway redirects to the access service, which redirects to the identity provider; the access service's decision lets the gateway forward to the data service.

Ctrl-C stops everything. Without local PostgreSQL binaries, the runner starts the official PostgreSQL 18 image instead, keeps its data in a runtime volume, and stops it with everything else. It uses the first of `docker` or `podman` it finds; to choose:

```bash
PLATFORM_CONTAINER_RUNTIME=podman bun run dev
```

### Local state

Development state lives in two root directories only:

| Directory | Contents |
| --- | --- |
| `.pg/` | Dev PostgreSQL data (`.pg/data`) and the test server's data (`.pg/tests/`). With a containerized server, data is in a runtime volume instead. |
| `.tmp/` | Files regenerated on every run: gateway route table, data service bindings, run keys, UI screenshots (`.tmp/dev/`, `.tmp/ui/`). |

Packages hold no state. The access service run alone uses the process's embedded PostgreSQL (`packages/access/.access/`); test scratch files go to the system temp directory.

### Gateway with fixtures

```bash
bun run dev:gateway
```

Runs everything in one process and prints:

```
  gateway        http://localhost:8080
  identity       http://localhost:5556

  sign in with   alice@gateway.test / alice-password
  workspace      11111111-1111-4111-8111-111111111111
  public route   http://localhost:8080/
  workspace API  http://localhost:8080/ws/11111111-1111-4111-8111-111111111111/
```

Code changes restart the process; the gateway picks up route-table changes itself.

### Stack

```bash
bun run scripts/dev-keys.ts
export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"
docker compose -f deploy/compose/platform.compose.yaml up --build
```

Services answer on `8080`, `8081` and `8082`. The stack provisions database roles, applies migrations and starts the services, alongside PostgreSQL and Redis. Use it to prove the images and for any platform contract change. Its passwords are development values, not deployment secrets. Per-service stacks and Kubernetes manifests: [deploy/README.md](../../deploy/README.md).

Production stacks read variables from the shell. [`.env.min`](../../.env.min) lists the minimum set a stack refuses to start without, with example development values:

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

Those values are examples, not secrets; a deployment replaces every one. Its two private keys are placeholders; `bun run scripts/dev-keys.ts` writes the gateway's key pair.

### Services from source

Each service reads its own environment; each `.env.example` lists development values. The access and data services need PostgreSQL. Start one with:

```bash
bun run tooling/postgres.ts --fresh
# postgres://data:data@127.0.0.1:35663/postgres
```

Without PostgreSQL binaries it uses a container and leaves it running; stop it by hand.

Provision roles and migrate the data service:

```bash
export DATA_ADMIN_DATABASE_URL="postgres://data@localhost/postgres?host=<the socket of the server>&port=<the port>"
export DATA_OWNER_DATABASE_URL="$DATA_ADMIN_DATABASE_URL"
export DATA_OWNER_PASSWORD=dev-owner-password-0001
export DATA_RUNTIME_PASSWORD=dev-runtime-password-0001
export DATA_REGISTRY_PASSWORD=dev-registry-password-0001
export DATA_DELIVERY_PASSWORD=dev-delivery-password-0001
export DATA_MAINTENANCE_PASSWORD=dev-maintenance-password-001

bun run --cwd packages/data provision
bun run --cwd packages/data migrate
```

Then start each service in its own terminal:

```bash
# access service
ACCESS_ENVIRONMENT=development ACCESS_HOST=127.0.0.1 ACCESS_PORT=8081 \
ACCESS_ISSUER=http://localhost:8081 ACCESS_PUBLIC_URL=http://localhost:8081 \
ACCESS_ADMIN_TOKEN=dev-admin-token-0000000 ACCESS_DECISION_TOKEN=dev-access-token-0000000 \
ACCESS_STATE_SECRET=0000000000000000000000000000000000000000000000000000000000000000 \
ACCESS_SECRET_ENCRYPTION_KEY=1111111111111111111111111111111111111111111111111111111111111111 \
ACCESS_SIGNING_KEY="$(cat access-signing-key.pem)" ACCESS_SIGNING_KID=dev \
ACCESS_CONTEXT_TOKENS='{"development-access-context-token-0001":null}' \
bun run --cwd packages/access start

# data service
DATA_ENVIRONMENT=development DATA_HOST=127.0.0.1 DATA_PORT=8082 DATA_PROCESS_ROLE=api \
DATA_DATABASE_URL="postgres://data_runtime:dev-runtime-password-0001@localhost/data?host=<the socket>&port=<the port>" \
DATA_REGISTRY_DATABASE_URL="postgres://data_registry:dev-registry-password-0001@localhost/data?host=<the socket>&port=<the port>" \
DATA_SCHEMA_BUNDLE_FILE=./manifests/schema.json DATA_POLICY_BUNDLE_FILE=./manifests/policies.json \
DATA_GATEWAY_BINDINGS_FILE=../deploy/config/bindings.local.json DATA_ACCESS_URL=http://127.0.0.1:8081 \
DATA_ACCESS_CONTEXT_TOKEN_FILE=./deploy/fixtures/secrets/access-context.token \
DATA_CURSOR_KEY_FILE=./deploy/fixtures/secrets/cursor.key \
bun run --cwd packages/data start

# gateway
GATEWAY_CONFIG=../deploy/config/routes.local.json GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=8080 \
GATEWAY_OIDC_ISSUER=http://127.0.0.1:8081 GATEWAY_OIDC_CLIENT_ID=platform \
GATEWAY_OIDC_CLIENT_SECRET=dev-client-secret \
GATEWAY_OIDC_REDIRECT_URI=http://localhost:8080/auth/callback GATEWAY_OIDC_ALLOW_INSECURE=true \
GATEWAY_ACCESS_URL=http://127.0.0.1:8081 GATEWAY_ACCESS_TOKEN=dev-access-token-0000000 \
GATEWAY_SESSION_SECRET=dev-session-secret-0001 GATEWAY_SESSION_URL=memory://local \
GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)" \
GATEWAY_RATE_LIMIT_TOTAL_MAX=1000 \
bun run --cwd packages/gateway start

# console
CONSOLE_ENVIRONMENT=development CONSOLE_HOST=127.0.0.1 CONSOLE_PORT=8083 \
CONSOLE_PUBLIC_URL=http://localhost:8083 CONSOLE_ACCESS_URL=http://127.0.0.1:8081 \
CONSOLE_CLIENT_ID=platform CONSOLE_CLIENT_SECRET=dev-client-secret \
CONSOLE_GATEWAY_URL=http://localhost:8080 CONSOLE_ADMIN_TOKEN=dev-admin-token-0000000 \
CONSOLE_ACCESS_CONTEXT_TOKEN=development-access-context-token-0001 \
CONSOLE_SESSION_SECRET=dev-console-session-secret-of-the-dev-01 \
bun run --cwd packages/console start
```

> [!NOTE]
> The data service's bindings name the file holding the **public identity-signing key**. `scripts/dev-keys.ts` writes the key pair and the bindings for a source run (`deploy/config/bindings.local.json`).
>
> The data service connects to the development database through the server's **socket**, not its port: the dev server authenticates local socket connections without a password.

## Commands

Root commands cover every workspace:

| Command | What it does |
| --- | --- |
| `bun run typecheck` | Type-check every workspace |
| `bun run lint` | Lint (`biome lint .`) |
| `bun run format:check` | Check formatting (`bun run format` fixes it) |
| `bun run architecture` | Check every workspace's import boundaries |
| `bun run dead` | Find unused code (knip) |
| `bun run versions` | Check the platform version matches everywhere |
| `bun run repositories:check` | Check the platform names only its own repository and three images |
| `bun run deploy:check` | Check `deploy/` is consistent |
| `bun run test` | Platform tests, then every workspace's tests |
| `bun run compatibility` | Run the three services together ([Compatibility](compatibility.md)) |
| `bun run dev` | Platform: three services, console, dev PostgreSQL and identity provider |
| `bun run dev:gateway` | Gateway with local fixtures |
| `bun run atlas` | Open the [atlas](atlas.html) |

`bun run dead --fix` removes exports nothing imports. Run `bun run typecheck` afterwards: a removal can leave behind an import that existed only for that export.

Run a single workspace's command with `--cwd`:

```bash
bun run --cwd packages/gateway start
bun run --cwd packages/access start
bun run --cwd packages/data start
bun run --cwd packages/data migrate
bun run --cwd packages/console build   # writes dist/
```

## Tests

```bash
bun test --cwd packages/gateway src test/contract   # gateway units and contracts
bun test --cwd packages/access src test/contract    # access service units and contracts
bun test --cwd packages/data test/unit test/contract # data service units and contracts
bun test --cwd packages/console test                # console core, and its build against the contracts
```

Integration tests run on the process's embedded PostgreSQL by default; tests that need a real PostgreSQL or Redis server are skipped without one. To run them:

```bash
docker compose -f deploy/compose/platform.compose.yaml up -d postgres redis

bun run --cwd packages/gateway test:integration
bun run --cwd packages/access test:integration
bun run --cwd packages/data test:integration
```

Suites with extra needs:

| Suite | Needs |
| --- | --- |
| `bun run --cwd packages/gateway test:browser` | `bunx playwright install --with-deps chromium` |
| `bun run --cwd packages/gateway test:interop` | A real identity provider; CI starts [dex](../../deploy/dex/config.ci.yaml) |
| `bun run --cwd packages/gateway test:load` | Nothing; measures the gateway against the fixtures |
| `bun run --cwd packages/data test:mutation` | Nothing; breaks code on purpose and checks the suites notice |

`bun run compatibility` starts the gateway, access and data services from `packages/` against a real PostgreSQL server and runs the acceptance scenario through the gateway. Details: [Compatibility](compatibility.md).

## Releasing

```bash
bun run release:tag:dry-run   # show what the tagger would do
bun run release:tag           # cut and push the tag
```

The tagger refuses when versions disagree or a version goes down. See [Release](release.md).
