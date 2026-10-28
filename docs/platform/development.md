# The machine of a developer

## The prerequisites

- **Bun 1.4.3 or later.** The boundaries the specifications rely on are
  only observable on this line: see
  [the runtime of the gateway](../gateway/runtime.md).
- **Docker or Podman**, for the PostgreSQL server and the Redis server
  of the tests that need a real one, and for the PostgreSQL server of
  the runner of the development machine when the machine has no binaries
  of PostgreSQL.
- **Git**, for the tagger and for the reference of the compatibility
  suite.

## The installation

```bash
bun install
```

One installation for the three workspaces. The root of the repository is
the only place a dependency is declared, and the lockfile is the one of
the root.

## The modes of the development machine

There are four ways to run the platform, and they answer four
different questions.

| Mode | What it starts | What it is for |
| --- | --- | --- |
| **The platform** | The three services, a PostgreSQL server and an identity provider, run by bun, with the seed of the development. | Working on the platform: the contracts between the three, the migrations, the flow of a login. |
| **The gateway and its fixtures** | The gateway, an identity provider, an access fixture and two upstreams, in **one process**. | Working on the gateway alone. It is the fastest loop, and it needs nothing but bun. |
| **The stack** | The three services, a PostgreSQL server and a Redis server, in **containers**. | Working on the platform: the contracts between the three, the migrations, the images. |
| **The services from the source** | The three services, run by bun, against a PostgreSQL server of your own. | Working on a service with the debugger of your editor, against a database you control. |

### The platform

```bash
bun run dev
```

The runner of the root starts the three services of the platform and the
infrastructure they share:

- the PostgreSQL server of the development machine, in `.pg/`;
- the identity provider of the gateway, on `:5556`;
- the access service, on `:8081`;
- the data service, on `:8082`;
- the gateway, on `:8080`.

The machine has **one** PostgreSQL server, and every service has its
own database on it: `data` for the data service, `access` for the
access service. The runner creates the role and the database of the
access service before it starts it, the service applies its own
migrations, and the state of the machine is the data directory of the
server alone. The files the run generates — the route table, the
bindings, the keys — are in `.tmp/dev/`, and they are written again at
every start.

It applies the migrations of the data service, it registers the
workspace of the development in the registry of the service, and it
seeds the access service with a tenant, a principal, a group and the
grants of the route. The seed is idempotent: a run that finds the
tenant of the development changes it.

### The state of the machine

The state of a development machine is two directories of the root of the
repository, and nothing else:

| Directory | What it holds |
| --- | --- |
| `.pg/` | The data directory of the PostgreSQL server of the machine (`.pg/data`), and the data directory of the server of the tests (`.pg/tests/`). A machine that runs the server in a container keeps the data in a volume of the runtime instead. |
| `.tmp/` | The files a run generates: the route table of the gateway, the bindings of the data service, the keys of the run and the screenshots of the interface (`.tmp/dev/`, `.tmp/ui/`). They are written again at every run. |

A package holds no state of its own: the access service that is run
alone uses the embedded PostgreSQL of the process
(`packages/access/.access/`), and the scratch files of the tests live in
the temporary directory of the machine.

It prints the addresses and the credentials of the machine:

```
  gateway         http://localhost:8080
  access service  http://127.0.0.1:8081
  data service    http://127.0.0.1:8082
  identity        http://127.0.0.1:5556
  postgres        postgres://data:data@127.0.0.1:41693/postgres

  sign in with    alice@gateway.test / alice-password
  sign in at      http://localhost:8080/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me
  workspace       11111111-1111-4111-8111-111111111111
  workspace API   http://localhost:8080/ws/11111111-1111-4111-8111-111111111111/v1/
```

The login goes through the three services: the gateway sends the browser
to the access service, the access service sends it to the identity
provider, and the decision of the access service is what lets the
gateway forward the request to the data service.

```bash
bun run dev --fresh   # the data of the PostgreSQL server is removed first
```

The runner needs the binaries of PostgreSQL on the machine, and it stops
everything when it is interrupted.

A machine without the binaries of PostgreSQL starts the server of the
development machine in a container instead: the image is the official
one of PostgreSQL 18, the data of the server is in a volume of the
runtime, and the container is stopped with the rest of the machine when
the runner is interrupted. The runtime of the containers is the first of
`docker` and `podman` that the machine has, and the environment names
the runtime when the machine has both:

```bash
PLATFORM_CONTAINER_RUNTIME=podman bun run dev
```

### The gateway and its fixtures

```bash
bun run dev:gateway
```

It starts everything in one process and prints the addresses:

```
  gateway        http://localhost:8080
  identity       http://localhost:5556

  sign in with   alice@gateway.test / alice-password
  workspace      11111111-1111-4111-8111-111111111111
  public route   http://localhost:8080/
  workspace API  http://localhost:8080/ws/11111111-1111-4111-8111-111111111111/
```

A change of the code restarts the process, and a change of the route
table is picked up by the gateway itself.

### The stack

```bash
bun run scripts/dev-keys.ts
export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"
docker compose -f deploy/compose/platform.compose.yaml up --build
```

The three services answer on `8080`, `8081` and `8082`. The stack
provisions the roles of the database, applies the migrations and starts
the three services. It is the mode that proves the images, and the mode
that a change of a contract of the platform needs.

The stacks of a deployment read their variables from the environment of
the shell, and the file `.env.min` of the root holds the shortest list
of them: the variables that a stack refuses to start without, with the
example values of a development machine. It is the answer to the question
"what does the platform need to come up":

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

The values of that file are examples, and they are not secrets: a
deployment replaces every one of them with a secret of its own. The two
private keys of it are placeholders, and the script of the keys of the
root writes the pair of the gateway:

```bash
bun run scripts/dev-keys.ts
```

### The services from the source

Each service reads its own environment, and each file `.env.example`
holds the variables of a development machine. The access service and the
data service need a PostgreSQL server.

The data service starts one of its own, with the script of the
platform:

```bash
bun run tooling/postgres.ts --fresh
# postgres://data:data@127.0.0.1:35663/postgres
```

The script starts the server in a container when the machine has no
binaries of PostgreSQL, and the container of the server is then left
running: it is stopped by hand.

The provisioning and the migrations of the deployment:

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

The three services, one terminal each:

```bash
# the access service
ACCESS_ENVIRONMENT=development ACCESS_HOST=127.0.0.1 ACCESS_PORT=8081 \
ACCESS_ISSUER=http://localhost:8081 ACCESS_PUBLIC_URL=http://localhost:8081 \
ACCESS_ADMIN_TOKEN=dev-admin-token-0000000 ACCESS_DECISION_TOKEN=dev-access-token-0000000 \
ACCESS_STATE_SECRET=0000000000000000000000000000000000000000000000000000000000000000 \
ACCESS_SECRET_ENCRYPTION_KEY=1111111111111111111111111111111111111111111111111111111111111111 \
ACCESS_SIGNING_KEY="$(cat access-signing-key.pem)" ACCESS_SIGNING_KID=dev \
ACCESS_CONTEXT_TOKENS='{"development-access-context-token-0001":null}' \
bun run --cwd packages/access start

# the data service
DATA_ENVIRONMENT=development DATA_HOST=127.0.0.1 DATA_PORT=8082 DATA_PROCESS_ROLE=api \
DATA_DATABASE_URL="postgres://data_runtime:dev-runtime-password-0001@localhost/data?host=<the socket>&port=<the port>" \
DATA_REGISTRY_DATABASE_URL="postgres://data_registry:dev-registry-password-0001@localhost/data?host=<the socket>&port=<the port>" \
DATA_SCHEMA_BUNDLE_FILE=./manifests/schema.json DATA_POLICY_BUNDLE_FILE=./manifests/policies.json \
DATA_GATEWAY_BINDINGS_FILE=../deploy/config/bindings.local.json DATA_ACCESS_URL=http://127.0.0.1:8081 \
DATA_ACCESS_CONTEXT_TOKEN_FILE=./deploy/fixtures/secrets/access-context.token \
DATA_CURSOR_KEY_FILE=./deploy/fixtures/secrets/cursor.key \
bun run --cwd packages/data start

# the gateway
GATEWAY_CONFIG=../deploy/config/routes.local.json GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=8080 \
GATEWAY_OIDC_ISSUER=http://127.0.0.1:8081 GATEWAY_OIDC_CLIENT_ID=platform \
GATEWAY_OIDC_CLIENT_SECRET=dev-client-secret \
GATEWAY_OIDC_REDIRECT_URI=http://localhost:8080/auth/callback GATEWAY_OIDC_ALLOW_INSECURE=true \
GATEWAY_ACCESS_URL=http://127.0.0.1:8081 GATEWAY_ACCESS_TOKEN=dev-access-token-0000000 \
GATEWAY_SESSION_SECRET=dev-session-secret-0001 GATEWAY_SESSION_URL=memory://local \
GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)" \
GATEWAY_RATE_LIMIT_TOTAL_MAX=1000 \
bun run --cwd packages/gateway start

# the console
CONSOLE_ENVIRONMENT=development CONSOLE_HOST=127.0.0.1 CONSOLE_PORT=8083 \
CONSOLE_PUBLIC_URL=http://localhost:8083 CONSOLE_ACCESS_URL=http://127.0.0.1:8081 \
CONSOLE_CLIENT_ID=platform CONSOLE_CLIENT_SECRET=dev-client-secret \
CONSOLE_GATEWAY_URL=http://localhost:8080 CONSOLE_ADMIN_TOKEN=dev-admin-token-0000000 \
CONSOLE_ACCESS_CONTEXT_TOKEN=development-access-context-token-0001 \
CONSOLE_SESSION_SECRET=dev-console-session-secret-of-the-dev-01 \
bun run --cwd packages/console start
```

Two details are easy to miss:

- The **public key of the identity signature** is the file that the
  bindings of the data service name. The script of the keys writes the
  pair, and the bindings of a run from the source
  (`deploy/config/bindings.local.json`) with it.
- The connection of the data service to the database of the development
  goes through the **socket** of the server, and not through its port:
  the server of the development authenticates the local connections
  without a password.

## The commands

Every command of the platform is a command of the root, and it reaches
the three workspaces:

| Command | What it does |
| --- | --- |
| `bun run typecheck` | The types of the five workspaces. |
| `bun run lint` | The linter of the five workspaces. |
| `bun run format:check` | The formatting of the five workspaces. |
| `bun run architecture` | The boundaries of the five workspaces. |
| `bun run dead` | The code that nothing uses. |
| `bun run versions` | The version of the platform is the same everywhere. |
| `bun run test` | The tests of the five workspaces. |
| `bun run compatibility` | The three services together. |
| `bun run dev` | The platform: the three services, the console, the server of the development and the identity provider. |
| `bun run dev:gateway` | The gateway with the local fixtures. |

A command of a single workspace is run with `--cwd`:

```bash
bun run --cwd packages/gateway start
bun run --cwd packages/access start
bun run --cwd packages/data start
bun run --cwd packages/data migrate
bun run --cwd packages/console build   # the build of the console: dist/
```

## The tests

```bash
bun test --cwd packages/gateway src test/contract   # the units and the contracts of the gateway
bun test --cwd packages/access src test/contract     # the units and the contracts of the access service
bun test --cwd packages/data test/unit test/contract # the units and the contracts of the data service
bun test --cwd packages/console test               # the console: its core, and its build against the contracts
```

The tests that need a real server are skipped without one. To run them
locally:

```bash
docker compose -f deploy/compose/platform.compose.yaml up -d postgres redis

bun run --cwd packages/gateway test:integration
bun run --cwd packages/access test:integration
bun run --cwd packages/data test:integration
```

The suites of the gateway that need more than that:

| Suite | What it needs |
| --- | --- |
| `bun run --cwd packages/gateway test:browser` | `bunx playwright install --with-deps chromium` |
| `bun run --cwd packages/gateway test:interop` | a real identity provider: the job of the continuous integration starts [dex](../../deploy/dex/config.ci.yaml) |
| `bun run --cwd packages/gateway test:load` | nothing: it measures the gateway against the fixtures |
| `bun run --cwd packages/data test:mutation` | nothing: it breaks the code on purpose and checks that the suites notice |

## The compatibility of the platform

```bash
bun run compatibility
```

The harness starts the three services of this repository — the gateway
of `packages/gateway/`, the access service of `packages/access/` and the data
service of `packages/data/` — against a real PostgreSQL server, and it performs the
acceptance scenario through the gateway. It is described in
[the compatibility of the platform](compatibility.md).

## The stack of a development machine

```bash
docker compose -f deploy/compose/platform.compose.yaml up --build
```

It starts the three services, a PostgreSQL server and a Redis server.
The passwords of the file are the passwords of a development machine:
they are not secrets, and they are not the passwords of a deployment.

Every service of the platform is also deployed on its own, with its own
stack and its own manifests. The map of the directory of the deployment
is in [the deployment](../../deploy/README.md).

## The release of the platform

```bash
bun run release:tag:dry-run   # what the tagger would do
bun run release:tag            # the tag is cut and pushed
```

The tagger refuses to cut a tag when the versions of the platform do not
agree, and it refuses a version that went down. It is described in
[the release of the platform](release.md).
