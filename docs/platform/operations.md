# Operations

Deploying and running the three services together. Each service's environment, probes, alerts and runbooks are in its own operations page: [gateway](../gateway/operations.md) (and [recovery](../gateway/recovery.md)), [access service](../access/operations.md), [data service](../data/operations.md), [console](../console/operations.md).

## Deployments

| Service | Image | Port | Env prefix | State it needs |
| --- | --- | --- | --- | --- |
| Gateway | `ghcr.io/ggpwnkthx/gateway` | `8080` | `GATEWAY_*` | Redis or PostgreSQL: sessions, limits, cached decisions |
| Access service | `ghcr.io/ggpwnkthx/access` | `8081` | `ACCESS_*` | PostgreSQL for its eight tables; Redis for login codes |
| Data service | `ghcr.io/ggpwnkthx/data` | `8082` | `DATA_*` | PostgreSQL for business data |

The gateway also runs a **control plane**, the deployment's administrative surface: same image, different command, port `9090`, never routed through the gateway.

## Environment

Each service reads its environment once at startup and validates it as a whole: it collects every problem before refusing, and any value it cannot parse stops the service. The one exception is the log level: a typo there must not keep a deployment down.

## Secrets

All three services accept a secret as a file next to the variable that names it. Mount files from your secret manager and point the `*_FILE` variables at them (`ACCESS_SIGNING_KEY_FILE`, `DATA_CURSOR_KEY_FILE`, `DATA_ACCESS_CONTEXT_TOKEN_FILE`, …). The file-only rule and who holds which secret: [Security](security.md#secrets).

## First deployment

Steps for a deployment from nothing. Each command's manual is in its service's docs; deployments running the images run the same commands in the same order.

### 1. Secrets

Generate development keys with `bun run scripts/dev-keys.ts`; in production, mount your secret manager's files as described in [Secrets](#secrets). [`.env.min`](../../.env.min) lists the variables a stack refuses to start without.

### 2. Database roles

Create the data service's separated roles once, with server-administrator credentials:

```bash
bun run --cwd packages/data provision
```

### 3. Schema

The operator applies migrations with the schema owner's credentials, never the API:

```bash
bun run --cwd packages/data migrate
```

### 4. Workspace

The operator also writes the workspace registry. The workspace is the unit of access control, and the data service reads it before a principal's context exists.

```bash
bun run --cwd packages/data workspace create \
  --id 11111111-1111-4111-8111-111111111111 \
  --tenant 22222222-2222-4222-8222-222222222222 \
  --slug acme
```

### 5. Tenant, principals and grants

Create them only through the access service's administration API; see [access service operations](../access/operations.md) ("The first tenant"). The cutover suite rehearses these calls.

### 6. Route table

The gateway matches requests against a route table, from a file (`GATEWAY_CONFIG`) or from shared state where the control plane writes revisions. Format: [gateway spec](../gateway/spec.md) §3. Deployment config: `deploy/config/routes.json`.

### 7. Stack

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

### 8. Verify

```bash
curl -sS http://localhost:8080/healthz
curl -sS http://localhost:8081/healthz
curl -sS http://localhost:8082/healthz
```

Then send a request through the gateway that the data service answers. Success proves the three deployments work together: the caller is authenticated, the access service allows the workspace, and the data service returns the row.

## Addresses

Each deployment configures the others' URLs:

| Address | Configured by |
| --- | --- |
| Access service issuer | `GATEWAY_OIDC_ISSUER`, with the deployment's client and redirect |
| Access service (from the gateway) | `GATEWAY_ACCESS_URL` |
| Data service upstream | The route's `upstream` in the gateway route table |
| Access service (from the data service) | `DATA_ACCESS_URL` |
| Gateway bindings | `DATA_GATEWAY_BINDINGS_FILE` |

The gateway works with **any** conforming identity provider, access service and upstream; the bundled access and data services are not the only options.

## Probes

All three services expose the same probes:

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Always `200`: the process is alive. |
| `GET /readyz` | `200` when the service can serve requests, `503` otherwise. |

Readiness depends on:

- **gateway**: shared state (sessions must be storable);
- **access service**: its database and shared store;
- **data service**: its schema, its connection role, and the access service's access context.

## Metrics

Every service exposes Prometheus metrics on `/metrics`. The gateway and access service require a bearer token, and the endpoint is absent without one; the data service reads its token from a file. Metric names are in each service's docs.

## Images

```bash
docker pull ghcr.io/ggpwnkthx/gateway:1.0.0
docker pull ghcr.io/ggpwnkthx/access:1.0.0
docker pull ghcr.io/ggpwnkthx/data:1.0.0
```

Each release builds its images once and publishes them with provenance and an SBOM; every release gate runs against that build's **digest**. Pin the digest in deployments.

## Rollback

Images are tagged with the release tag and the version. To roll back, deploy the previous release's image:

```bash
docker pull ghcr.io/ggpwnkthx/gateway:<the version of the release to roll back to>
```

> [!WARNING]
> Rolling back the data service image does not roll back its schema. Migrations are applied by the operator command; see [data service operations](../data/operations.md).

## Versions

A release carries all three images at the same version. A deployment may run them at different versions; [Compatibility](compatibility.md) shows which combinations are proven.
