# Operations

How to deploy and run the whole platform: deployments, environment conventions, secrets, the first deployment, addresses, probes, metrics, artifacts, versions and rollback. It is for operators; each service's own environment, alerts and runbooks are on its pages, listed under [Service pages](#service-pages).

## Service pages

| Service | Operations | Environment variables |
| --- | --- | --- |
| Gateway | [Gateway operations](../gateway/operations.md) | [Gateway configuration](../gateway/configuration.md) |
| Access | [Access operations](../access/operations.md) | [Access spec: environment](../access/spec.md#4-environment) |
| Data | [Data operations](../data/operations.md) | [Data configuration](../data/configuration.md) |
| Console | [Console operations](../console/operations.md) | [Console configuration](../console/configuration.md) |
| CLI | [CLI usage](../cli/usage.md) | [CLI spec: profiles](../cli/spec.md#3-profiles) |

## Deployments

| Service | Image | Port | Env prefix | State it needs |
| --- | --- | --- | --- | --- |
| Gateway | `ghcr.io/ggpwnkthx/gateway` | `8080` | `GATEWAY_*` | Redis or PostgreSQL: sessions, limits, cached decisions |
| Access | `ghcr.io/ggpwnkthx/access` | `8081` | `ACCESS_*` | PostgreSQL for its eight tables; Redis for login codes |
| Data | `ghcr.io/ggpwnkthx/data` | `8082` | `DATA_*` | PostgreSQL for business data |

The gateway also runs a **control plane**, the deployment's administrative surface. It uses the same image with a different command, listens on port `9090`, and is never routed through the gateway.

The console has no published image; see [console operations](../console/operations.md). Compose stacks and Kubernetes manifests are described in [deploy/README.md](../../deploy/README.md).

## Environment conventions

Every service reads its environment once at startup and validates it as a whole. It reports every problem before it refuses to start, and any value it cannot parse stops it. The one exception is the log level, because a typo there must not keep a deployment down.

## Secrets as files

Access and Data accept a secret as a file named by a `*_FILE` variable (`ACCESS_SIGNING_KEY_FILE`, `DATA_CURSOR_KEY_FILE`, `DATA_ACCESS_CONTEXT_TOKEN_FILE`, …). Mount the files your secret manager provides and point those variables at them. The gateway reads its secrets from the environment, except the control plane's token map, which can come from `GATEWAY_CONTROL_TOKENS_FILE`; the production Compose files take those variables from the shell environment or the `--env-file` you pass. [Security: secrets](security.md#secrets) lists who holds which secret.

## First deployment

Run these steps in order. Each command's manual is in its service's docs, and deployments that run the images run the same commands in the same order.

1. **Secrets.** In production, mount your secret manager's files ([Secrets as files](#secrets-as-files)). `bun run scripts/dev-keys.ts` generates development keys. [`.env.min`](../../.env.min) lists the variables a stack refuses to start without.
2. **Database roles.** Create Data's separated roles once, with server-administrator credentials: `bun run --cwd packages/data provision`.
3. **Schema.** Apply migrations with the schema owner's credentials, never the API's: `bun run --cwd packages/data migrate`.
4. **Workspace.** Register the workspace, the unit of access control. Data reads it before a principal's context exists:

   ```bash
   bun run --cwd packages/data workspace create \
     --id 11111111-1111-4111-8111-111111111111 \
     --tenant 22222222-2222-4222-8222-222222222222 \
     --slug acme
   ```

5. **Tenant, principals and grants.** Create them only through Access's administration API; see [Access operations](../access/operations.md). The cutover suite rehearses these calls.
6. **Route table.** The gateway reads it from a file (`GATEWAY_CONFIG`) or from shared state, where the control plane writes revisions. The format is in the [gateway spec: configuration file](../gateway/spec.md#3-configuration-file); the deployment's table is `deploy/config/routes.json`.
7. **Stack.** Start the production stack:

   ```bash
   docker compose --env-file .env.min \
     -f deploy/compose/production/platform.compose.yaml up -d
   ```

8. **Verify.** Check each service's health, then send a request through the gateway that Data answers:

   ```bash
   curl -sS http://localhost:8080/healthz
   curl -sS http://localhost:8081/healthz
   curl -sS http://localhost:8082/healthz
   ```

   A successful answer proves three things at once: the caller is authenticated, Access allows the workspace, and Data returns the row.

## Addresses

| Address | Configured by |
| --- | --- |
| Access issuer | `GATEWAY_OIDC_ISSUER`, with the deployment's client and redirect |
| Access (from the gateway) | `GATEWAY_ACCESS_URL` |
| Data upstream | The route's `upstream` in the gateway route table |
| Access (from Data) | `DATA_ACCESS_URL` |
| Gateway bindings | `DATA_GATEWAY_BINDINGS_FILE` |

The bundled services are not the only options: the gateway works with **any** conforming identity provider, Access and upstream.

## Probes

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Always `200`: the process is alive. |
| `GET /readyz` | `200` when the service can serve requests, `503` otherwise. |

Readiness reports `ready`, `draining` or `not-ready`. What it depends on:

| Service | Ready when |
| --- | --- |
| Gateway | Shared state works (sessions must be storable) |
| Access | Its database and shared store work |
| Data | Its schema, its connection role and Access's access context work |

## Metrics

Every service exposes Prometheus metrics on `/metrics`. The gateway and Access require a bearer token, and without one configured the endpoint does not exist. Data reads its token from a file. Metric names are listed in each service's docs.

## Images and binaries

| Artifact | Where |
| --- | --- |
| Gateway image | `ghcr.io/ggpwnkthx/gateway:<version>` |
| Access image | `ghcr.io/ggpwnkthx/access:<version>` |
| Data image | `ghcr.io/ggpwnkthx/data:<version>` |
| Binaries | Assets of the tag's GitHub release |
| Data typed client | `data-backend-client-<version>.tgz`, and the package registry |
| CLI | `platformctl-<version>-<platform>.tar.gz`, an asset of the tag |

```bash
docker pull ghcr.io/ggpwnkthx/gateway:1.0.0
docker pull ghcr.io/ggpwnkthx/access:1.0.0
docker pull ghcr.io/ggpwnkthx/data:1.0.0
```

Each release builds its images once, publishes them with provenance and an SBOM, and runs every release gate against that build's **digest**. Pin the digest in your deployments.

Binaries embed the runtime, so nothing else needs installing. The Access archive includes its schema migrations next to the executable; the Data archive includes its manifests and migrations.

## Versions

A release carries all three images at the same version. A deployment may run them at different versions; the [compatibility baseline](internals.md#compatibility) shows which combinations are proven.

## Rollback

Images are tagged with both the release tag and the version. To roll back, deploy the previous release's image:

```bash
docker pull ghcr.io/ggpwnkthx/gateway:<previous version>
```

> [!WARNING]
> Rolling back the Data image does not roll back its schema. Migrations are applied by the operator command; see [Data operations](../data/operations.md).
