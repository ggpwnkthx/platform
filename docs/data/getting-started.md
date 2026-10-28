# Getting started

Take a checkout to a running service on your development machine. This is the shortest path that
exercises the whole trust chain: a signed request, a real PostgreSQL, the real roles and the real
migrations.

## Requirements

| Tool | Version |
| --- | --- |
| [Bun](https://bun.sh) | 1.4.3 or later |
| PostgreSQL | 18, with the server binaries on the `PATH` |
| Docker or Podman | For the local stack, and for tests on a machine without PostgreSQL binaries |

Integration tests start their own PostgreSQL server in `.pg/tests/data` at the repository root, so
they don't need a local server. It is separate from your development server: the tests empty the
tables and create the separation roles with test passwords. Without PostgreSQL binaries, the tests
run that server in a container. The compatibility harness starts its own server in a temporary
directory.

The suites prove version 18. A deployment may run PostgreSQL 15 or later; that requirement is in
[the docs index](../README.md) and doesn't apply to local development.

## Steps

```bash
bun install
cp .env.example .env                      # and change the secrets
bun run scripts/cli/provision.ts               # the roles and the database
bun run migrate                            # the schema
bun run workspace -- create --id 22222222-2222-4222-8222-222222222222 \
  --tenant aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa --slug acme
bun run start
```

The service listens on `127.0.0.1:8082` by default:

```bash
curl -s http://127.0.0.1:8082/healthz
curl -s http://127.0.0.1:8082/readyz
```

`/healthz` answers while the process is alive; `/readyz` answers `200` only when configuration,
schema, role privileges and access service discovery are all in order (see
[Operations](operations.md#probes)).

Data paths need a signed request, so a plain `curl` of `/ws/…` answers `401 UNAUTHENTICATED`. The
gateway signs the identity and the backend verifies it; the API client goes through the gateway too.

## Environment

`.env.example` lists the variables; [Configuration](configuration.md) describes them. Its values are
for local development and are not secrets.

Secrets are files, read when the process starts. The committed local fixtures are in
`deploy/fixtures/secrets/`; the `./secrets/…` paths in `.env.example` are the ones a deployment
mounts:

| File | Contents |
| --- | --- |
| `access-context.token` | Credential for the access context at the access service. |
| `cursor.key` | Key that signs page cursors. At least 32 bytes; not a gateway key. |
| `identity.public.pem` | The local gateway's **public** key. |
| `identity.key` | The gateway's **legacy** derived key. |

The metrics token is not committed: without its file, the metrics endpoint is absent and answers
`404`.

The gateway's private key is **not** in the repository. The local gateway holds it; generate it with
the gateway's `bun run identity:key`.

## Gateway bindings

`DATA_GATEWAY_BINDINGS_FILE` lists the routes the deployment accepts and how each route verifies
identity: signature version, algorithm and key file.

```json
{
  "version": 2,
  "bindings": [
    {
      "id": "data-api",
      "host": "api.gateway.test",
      "upstreamPathPattern": "/ws/{workspaceId}/v1/*",
      "routeId": "data-api",
      "identity": {
        "version": "v5",
        "algorithm": "ES256",
        "publicKeyFile": "./secrets/identity.public.pem"
      }
    }
  ]
}
```

A route's key is the gateway's **public** P-256 key, in PEM. The gateway signs with the private key;
the backend verifies with the public one, so a backend that can verify an identity cannot mint one.

A binding may also set `expectedTenantId` to restrict the route to one access service tenant.

## Migrating from the shared key

The previous format, `v4`, is symmetric: the backend held a key derived from the gateway's session
secret (`HMAC-SHA256(GATEWAY_SESSION_SECRET, "gateway-identity-signature-v1")`), so any upstream that
could verify an identity could also mint one.

Migrate the gateway and backend deployments in this order:

1. Give the gateway the private key of a new pair and have it sign with it. The old derived key
   still works for upstreams that haven't changed yet.
2. Give the backend the pair's public key in a version 2 binding. From then on it refuses `v4`: a
   route verifies exactly one version and never falls back.
3. Deployments that still share the derived key stay on a version 1 bindings file, which is read as
   legacy mode. When a deployment leaves legacy mode, delete the derived key from its secret store.

A legacy binding names the version, algorithm and key file explicitly:

```json
{
  "version": 2,
  "bindings": [
    {
      "id": "data-api",
      "host": "api.gateway.test",
      "upstreamPathPattern": "/ws/{workspaceId}/v1/*",
      "routeId": "data-api",
      "identity": {
        "version": "v4",
        "algorithm": "HS256",
        "identityKeyFile": "./secrets/identity.key"
      }
    }
  ]
}
```

## Local stack

```bash
docker compose -f deploy/compose/platform.compose.yaml up --build
```

The compose file starts the database, provisions the roles, applies the migrations and runs the API.
It doesn't include the gateway or the access service; the compatibility harness runs all three
services together at pinned revisions (see [Compatibility](compatibility.md)).

The compose file runs only the API. The worker needs a principal the access service knows:

```
DATA_PROCESS_ROLE=all
DATA_WORKER_PRINCIPAL_ID=<the uuid of the principal of the worker>
DATA_WORKER_ROUTE_ID=data-worker
```

## Files in `deploy/`

These are local development fixtures, committed on purpose:

| File | Contents |
| --- | --- |
| `fixtures/bindings.json` | Local routes and how their identities are verified. |
| `fixtures/secrets/identity.public.pem` | The local gateway's public key. |
| `fixtures/secrets/identity.key` | The gateway's **legacy** derived key. It can sign, so it belongs inside the gateway's trust boundary. |
| `fixtures/secrets/access-context.token` | The deployment's credential for the access context contract. |
| `fixtures/secrets/cursor.key` | Key that signs page cursors. |

> [!WARNING]
> These values are not secrets: anyone who reads the repository knows them. A deployment mounts
> credentials from its secret manager and never writes them into an image.

## First record

With the service running and a workspace created, register the collections the workspace serves and
publish a policy bundle:

```bash
export DATA_OWNER_DATABASE_URL=postgres://data_owner:...@127.0.0.1:5432/data

bun run collection -- register \
  --workspace 22222222-2222-4222-8222-222222222222 --collection articles

bun run policy -- publish \
  --workspace 22222222-2222-4222-8222-222222222222 \
  --file manifests/policies.json
```

Operator commands run with the schema owner's credentials, never inside the API.

Both commands are optional if you only want the service to answer: a workspace that registered
nothing serves every collection of the deployment ([Specification](spec.md) §7.5).
