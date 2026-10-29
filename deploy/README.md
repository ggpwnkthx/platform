# Deployment

Every deployment file of the platform lives in this directory: Compose stacks, Kubernetes manifests, configuration and development fixtures. Each service (the gateway, Access, Data) can be deployed alone or as part of the full platform; the first-deployment procedure is in [platform operations](../docs/platform/operations.md#first-deployment).

## Contents

```text
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

Deploy **one service**:

```bash
docker compose -f deploy/compose/gateway.compose.yaml up --build
docker compose -f deploy/compose/access.compose.yaml up --build
docker compose -f deploy/compose/data.compose.yaml up --build

kubectl apply -k deploy/kubernetes/base/gateway
kubectl apply -k deploy/kubernetes/base/access
kubectl apply -k deploy/kubernetes/base/data
```

Deploy **all three**, talking to each other over the deployment network:

```bash
docker compose -f deploy/compose/platform.compose.yaml up --build

kubectl apply -k deploy/kubernetes/overlays/platform
```

Both approaches use the same services, ports and environment variable names. A standalone service finds the others through environment variables (`GATEWAY_ACCESS_URL`, `DATA_ACCESS_URL`); the full composition uses network service names.

### The console

The console is a client of the platform, not one of the three services, and it is not an upstream of the gateway. The browser reaches the console directly, and the console reaches Data through the gateway like any other client. The console has no published image: build it from `packages/console/Dockerfile`. Its stack is `deploy/compose/console.compose.yaml`.

## Compose stacks

| Directory | For | Behavior |
| --- | --- | --- |
| `deploy/compose/` | **Development** | Builds local images, uses development passwords, and includes repository fixtures (identity provider, sample upstreams, Data credentials). |
| `deploy/compose/production/` | **Deployments** | Uses registry images, reads secrets from the shell environment (a secret store, vault agent or orchestrator secrets), and refuses to start if a secret is missing. |

Start the production stack:

```bash
docker compose -f deploy/compose/production/platform.compose.yaml up -d
```

[`.env.min`](../.env.min) lists the variables the production stacks require, with example development values. To try the production stack with it:

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

## Kubernetes manifests

Each base in `deploy/kubernetes/base/` applies on its own. The `deploy/kubernetes/overlays/platform/` overlay composes all three.

Secrets are **not** in the manifests. Each base has a `secret.example.yaml` that names the secret's keys. Apply the real secret from your secret store (sealed secrets, the external secrets operator, or an equivalent).

Data migration is an operator command, not a base resource. Run it by hand, once per deployment, with `deploy/kubernetes/base/data/migrate-job.yaml`.

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

The script writes both halves of the pair to `deploy/secrets/`, and writes the two source-run config files (`routes.local.json`, `bindings.local.json`) to `deploy/config/`.

Data's development credentials, by contrast, are committed on purpose as fixtures in [`deploy/fixtures/secrets/`](fixtures/secrets/README.md).

## Rules

- Every deployment file is in `deploy/` and nowhere else.
- A service has the same name, port and environment variable names whether it is deployed alone or in the composition.
- Deployment secrets are never in this directory: they come from the secret manager or the orchestrator's environment.
- Image versions match the platform version; `bun run deploy:check` fails when they drift.
