# Operations

Deploy and run the three services together: images, secrets, first deployment, probes and rollback. Each service's environment, alerts and runbooks are on its own page: [gateway](../gateway/operations.md), [access service](../access/operations.md), [data service](../data/operations.md), [console](../console/operations.md).

## Deployments

| Service | Image | Port | Env prefix | State it needs |
| --- | --- | --- | --- | --- |
| Gateway | `ghcr.io/ggpwnkthx/gateway` | `8080` | `GATEWAY_*` | Redis or PostgreSQL: sessions, limits, cached decisions |
| Access service | `ghcr.io/ggpwnkthx/access` | `8081` | `ACCESS_*` | PostgreSQL for its eight tables; Redis for login codes |
| Data service | `ghcr.io/ggpwnkthx/data` | `8082` | `DATA_*` | PostgreSQL for business data |

The gateway also runs a **control plane**, the deployment's administrative surface: same image, different command, port `9090`, never routed through the gateway. The console has no published image; see [console operations](../console/operations.md). Compose stacks and Kubernetes manifests: [deploy/README.md](../../deploy/README.md).

## Environment

Each service reads its environment once at startup and validates it as a whole: it reports every problem before refusing, and any value it cannot parse stops the service. The one exception is the log level: a typo there must not keep a deployment down.

## Secrets

Every service accepts a secret as a file named by a `*_FILE` variable (`ACCESS_SIGNING_KEY_FILE`, `DATA_CURSOR_KEY_FILE`, `DATA_ACCESS_CONTEXT_TOKEN_FILE`, …). Mount your secret manager's files and point those variables at them. Who holds which secret: [Security](security.md#secrets).

## First deployment

Each command's manual is in its service's docs. Deployments that run the images run the same commands in the same order.

1. **Secrets.** In production, mount your secret manager's files ([Secrets](#secrets)). `bun run scripts/dev-keys.ts` generates development keys. [`.env.min`](../../.env.min) lists the variables a stack refuses to start without.
2. **Database roles.** Create the data service's separated roles once, with server-administrator credentials: `bun run --cwd packages/data provision`.
3. **Schema.** Apply migrations with the schema owner's credentials, never the API's: `bun run --cwd packages/data migrate`.
4. **Workspace.** Register the workspace, the unit of access control. The data service reads it before a principal's context exists:

   ```bash
   bun run --cwd packages/data workspace create \
     --id 11111111-1111-4111-8111-111111111111 \
     --tenant 22222222-2222-4222-8222-222222222222 \
     --slug acme
   ```

5. **Tenant, principals and grants.** Create them only through the access service's administration API; see [access service operations](../access/operations.md). The cutover suite rehearses these calls.
6. **Route table.** The gateway reads it from a file (`GATEWAY_CONFIG`) or from shared state where the control plane writes revisions. Format: [gateway spec](../gateway/spec.md) §3. Deployment config: `deploy/config/routes.json`.
7. **Stack.**

   ```bash
   docker compose --env-file .env.min \
     -f deploy/compose/production/platform.compose.yaml up -d
   ```

8. **Verify.** Check each service's health, then send a request through the gateway that the data service answers:

   ```bash
   curl -sS http://localhost:8080/healthz
   curl -sS http://localhost:8081/healthz
   curl -sS http://localhost:8082/healthz
   ```

   An answer proves the caller is authenticated, the access service allows the workspace, and the data service returns the row.

## Addresses

| Address | Configured by |
| --- | --- |
| Access service issuer | `GATEWAY_OIDC_ISSUER`, with the deployment's client and redirect |
| Access service (from the gateway) | `GATEWAY_ACCESS_URL` |
| Data service upstream | The route's `upstream` in the gateway route table |
| Access service (from the data service) | `DATA_ACCESS_URL` |
| Gateway bindings | `DATA_GATEWAY_BINDINGS_FILE` |

The gateway works with **any** conforming identity provider, access service and upstream; the bundled services are not the only options.

## Probes

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Always `200`: the process is alive. |
| `GET /readyz` | `200` when the service can serve requests, `503` otherwise. |

Readiness reports `ready`, `draining` or `not-ready`, and depends on:

| Service | Ready when |
| --- | --- |
| Gateway | Shared state works (sessions must be storable) |
| Access service | Its database and shared store work |
| Data service | Its schema, its connection role and the access service's access context work |

## Metrics

Every service exposes Prometheus metrics on `/metrics`. The gateway and access service require a bearer token, and the endpoint is absent without one; the data service reads its token from a file. Metric names are in each service's docs.

## Images and binaries

| Artifact | Where |
| --- | --- |
| Gateway image | `ghcr.io/ggpwnkthx/gateway:<version>` |
| Access service image | `ghcr.io/ggpwnkthx/access:<version>` |
| Data service image | `ghcr.io/ggpwnkthx/data:<version>` |
| Binaries | Assets of the tag's GitHub release |
| Data service typed client | `data-backend-client-<version>.tgz`, and the package registry |

```bash
docker pull ghcr.io/ggpwnkthx/gateway:1.0.0
docker pull ghcr.io/ggpwnkthx/access:1.0.0
docker pull ghcr.io/ggpwnkthx/data:1.0.0
```

Each release builds its images once, publishes them with provenance and an SBOM, and runs every release gate against that build's **digest**. Pin the digest in deployments.

Binaries embed the runtime; nothing else needs installing. The access service archive includes its schema migrations next to the executable; the data service archive includes its manifests and migrations.

## Rollback

Images are tagged with the release tag and the version. To roll back, deploy the previous release's image:

```bash
docker pull ghcr.io/ggpwnkthx/gateway:<previous version>
```

> [!WARNING]
> Rolling back the data service image does not roll back its schema. Migrations are applied by the operator command; see [data service operations](../data/operations.md).

## Versions

A release carries all three images at the same version. A deployment may run them at different versions; the [compatibility baseline](internals.md#compatibility) shows which combinations are proven.
