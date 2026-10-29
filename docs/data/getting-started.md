# Getting started

Go from an empty checkout to a record created through the gateway, then run Data on its
own. Tools, run modes and test commands for the whole repository are in
[Platform development](../platform/development.md).

## Requirements

| Tool | Version |
| --- | --- |
| [Bun](https://bun.sh) | 1.4.3 or later |
| PostgreSQL | 18, server binaries on the `PATH` |
| Docker or Podman | For the compose stack, or when PostgreSQL binaries are missing |

Local development and the test suites use PostgreSQL 18; deployments may run 15 or later.

## 1. Run the platform

```bash
bun install
bun run dev
```

This starts PostgreSQL, the identity provider, all three services and the console, applies the Data's migrations, registers workspace `11111111-1111-4111-8111-111111111111`, and seeds a tenant
where `alice@gateway.test` (password `alice-password`) is an editor. Details:
[Platform development](../platform/development.md#platform).

## 2. Sign in

Open the printed sign-in URL in a browser:

```
http://localhost:8080/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me
```

After the login you land on `/me`, which shows your principal, tenant, workspace and route. Copy the
`gateway_session` cookie from the browser's developer tools.

## 3. Create a record

The gateway signs your identity and forwards the request; Data asks Access
for your capabilities and applies the workspace's policies.

```bash
WS=http://localhost:8080/ws/11111111-1111-4111-8111-111111111111/v1
SESSION='gateway_session=<value from the browser>'

curl -s -X POST "$WS/items/articles" \
  -H "cookie: $SESSION" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: first-article' \
  -d '{"title":"Hello"}'
```

The answer is `201` with a receipt, `{ "data": { "id": "…", "version": 1 } }`. Read the record back:

```bash
curl -s -i "$WS/items/articles/<id>" -H "cookie: $SESSION"
```

The `etag` header is the validator a later `PATCH` or `DELETE` must send. From code, use the
[typed client](client.md). Paths, envelopes and error codes: [API](api.md).

## Run the service alone

To work on Data against your own PostgreSQL, from `packages/data`:

```bash
cp .env.example .env                       # then change the secrets
bun run scripts/cli/provision.ts           # roles and database
bun run migrate                            # schema
bun run workspace -- create --id 22222222-2222-4222-8222-222222222222 \
  --tenant aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa --slug acme
bun run start
```

It listens on `127.0.0.1:8082`:

```bash
curl -s http://127.0.0.1:8082/healthz   # alive
curl -s http://127.0.0.1:8082/readyz    # 200 once schema, roles and Access are in order
```

A plain `curl` of a `/ws/…` path answers `401 UNAUTHENTICATED`: data paths accept only requests the
gateway signed. The probes are described in [Operations](operations.md#probes); every variable in
`.env.example` is in [Configuration](configuration.md).

A workspace that registered no collections serves every collection in the deployment. To restrict it
and publish policies, see [Operations](operations.md#workspace-catalog).

## Run with a worker

`deploy/compose/data.compose.yaml` builds the image, starts PostgreSQL, provisions roles, migrates and
runs the API on port `8082`. The gateway and Access are not in it; point it at an Access with `DATA_ACCESS_URL` (default `http://host.docker.internal:8081`).

```bash
docker compose -f deploy/compose/data.compose.yaml up --build
```

The compose file runs only the API. A worker claims event deliveries and needs a principal the Access knows:

```
DATA_PROCESS_ROLE=all
DATA_WORKER_PRINCIPAL_ID=<the worker principal's uuid>
DATA_WORKER_ROUTE_ID=data-worker
```

## Local secrets

Secrets are files read at startup. The committed fixtures in `deploy/fixtures/` are local values,
not secrets; `.env.example` points at the `./secrets/…` paths a deployment mounts instead.

| File | Contents |
| --- | --- |
| `bindings.json` | Local routes and how each verifies identity. |
| `secrets/identity.public.pem` | The local gateway's **public** key. |
| `secrets/identity.key` | The gateway's **legacy** derived key. It can sign, so it belongs inside the gateway's trust boundary. |
| `secrets/access-context.token` | Credential for the access context contract. |
| `secrets/cursor.key` | Page cursor signing key, at least 32 bytes, not a gateway key. |

> [!WARNING]
> Anyone who reads the repository knows these values. A deployment mounts credentials from its
> secret manager and never bakes them into an image.

The metrics token is not committed, so `/metrics` answers `404` locally. The gateway's private key is
never in the repository; the gateway generates it with `bun run identity:key`.

## Gateway bindings

`DATA_GATEWAY_BINDINGS_FILE` lists accepted routes and how each verifies identity. Field reference:
[Configuration](configuration.md#bindings-file).

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

The key is the gateway's public P-256 key in PEM, so a backend that can verify an identity cannot
mint one.

## Migrating from the shared key

The legacy `v4` format is symmetric: the backend holds
`HMAC-SHA256(GATEWAY_SESSION_SECRET, "gateway-identity-signature-v1")` and could mint identities with
it. Move off it in this order:

1. Give the gateway a new key pair's private key and have it sign with it. The derived key keeps
   working for upstreams not yet moved.
2. Give the backend the public key in a version 2 binding. That route then refuses `v4`; a route
   verifies exactly one version, with no fallback.
3. Deployments still sharing the derived key stay on a version 1 bindings file (legacy mode). On
   leaving it, delete the derived key from the secret store.

A legacy binding names its format explicitly, and `DATA_LEGACY_IDENTITY` must permit it:

```json
"identity": {
  "version": "v4",
  "algorithm": "HS256",
  "identityKeyFile": "./secrets/identity.key"
}
```
