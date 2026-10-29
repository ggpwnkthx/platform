# Deployment

Every deployment file lives here. Each service (Gateway, Access, Data) can be deployed alone or as part of the full platform composition. The first-deployment procedure is in [Operations](../docs/platform/operations.md).

```
deploy/
  compose/                 Compose stacks
    platform.compose.yaml    all three services and the console
    gateway.compose.yaml     Gateway only
    access.compose.yaml      Access only
    data.compose.yaml        Data only
    console.compose.yaml     Console only
    production/              the same stacks, with deployment secrets
  kubernetes/              cluster manifests
    base/gateway/            Gateway only
    base/access/             Access only
    base/data/               Data only
    overlays/platform/       all three
  config/                  deployment configuration
  dex/                     identity provider for development
  fixtures/                development fixtures
  redis/                   shared-state access control list
  secrets/                 development keys (generated, git-ignored)
```

## Deploying

**One service:**

```bash
docker compose -f deploy/compose/gateway.compose.yaml up --build
docker compose -f deploy/compose/access.compose.yaml up --build
docker compose -f deploy/compose/data.compose.yaml up --build

kubectl apply -k deploy/kubernetes/base/gateway
kubectl apply -k deploy/kubernetes/base/access
kubectl apply -k deploy/kubernetes/base/data
```

**All three**, talking over the deployment network:

```bash
docker compose -f deploy/compose/platform.compose.yaml up --build

kubectl apply -k deploy/kubernetes/overlays/platform
```

**The console** is a client deployed behind the gateway, not one of the three services. It has no published image: build it from `packages/console/Dockerfile`. Its stack is `deploy/compose/console.compose.yaml`.

Both approaches use the same services, ports and environment variable names. A standalone service finds the others through environment variables (`GATEWAY_ACCESS_URL`, `DATA_ACCESS_URL`); the composition uses network service names.

## Compose stacks

The stacks in `deploy/compose/` are for **development**: they build local images, use development passwords, and include repository fixtures (identity provider, sample upstreams, Data credentials).

The stacks in `deploy/compose/production/` are for **deployments**: they use registry images, read secrets from the shell environment (a secret store, vault agent or orchestrator secrets), and refuse to start if a secret is missing.

```bash
docker compose -f deploy/compose/production/platform.compose.yaml up -d
```

[`.env.min`](../.env.min) lists the variables the production stacks require, with example development values:

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

## Kubernetes manifests

Each base in `deploy/kubernetes/base/` applies on its own; the `deploy/kubernetes/overlays/platform/` overlay composes all three.

Secrets are **not** in the manifests. Each base has a `secret.example.yaml` naming the secret's keys; apply the real secret from your secret store (sealed secrets, the external secrets operator, or equivalent).

Data migration is an operator command, not a base resource. Apply it by hand, once per deployment, with `deploy/kubernetes/base/data/migrate-job.yaml`.

## Configuration

| File in `deploy/config/` | Contents |
| --- | --- |
| `routes.json` | Composition route table: the gateway forwards to Data. |
| `routes.gateway.json` | Gateway-only route table: forwards to the development sample upstreams. |
| `routes.local.json` | Route table for running from source, with upstreams on loopback. Generated. |
| `bindings.json` | Data bindings: gateway routes and the key that verifies request identities. |
| `bindings.local.json` | Bindings for running from source, with the key at its on-disk path. Generated. |
| `control-tokens.example.json` | Example control plane token map. The real map is a secret. |
| `access-policy.json` | Policy of the reference Access used in development. |

## Development keys

The identity-signing key pair is **generated**, never committed:

```bash
bun run scripts/dev-keys.ts
export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"
```

The script writes both halves of the pair to `deploy/secrets/`, and the two source-run config files (`routes.local.json`, `bindings.local.json`) to `deploy/config/`.

Data's development credentials are deliberately committed fixtures in [`deploy/fixtures/secrets/`](fixtures/secrets/README.md).

## Rules

- Every deployment file is in `deploy/` and nowhere else.
- A service has the same name, port and environment variable names whether deployed alone or in the composition.
- Deployment secrets are never in this directory: they come from the secret manager or the orchestrator's environment.
- Image versions match the platform version; `bun run deploy:check` fails when they drift.
