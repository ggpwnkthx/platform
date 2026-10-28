# The deployment of the platform

Every file of a deployment is in this directory. The three services of
the platform — the **gateway**, the **access** service and the **data**
service — are deployed here, and each of them is deployed **on its own**
and as part of the **composition** of the three.

```
deploy/
  compose/                 the stacks of a machine
    platform.compose.yaml    the composition of the three services and the console
    gateway.compose.yaml     the gateway alone
    access.compose.yaml      the access service alone
    data.compose.yaml        the data service alone
    console.compose.yaml     the console alone
    production/              the same four stacks, with the secrets of a deployment
  kubernetes/              the manifests of a cluster
    base/gateway/            the gateway alone
    base/access/             the access service alone
    base/data/               the data service alone
    overlays/platform/       the composition of the three
  config/                  the configuration of the deployment
  dex/                     the identity provider of a development machine
  fixtures/                the fixtures of a development machine
  redis/                   the access control list of the shared state
  secrets/                 the keys of a development machine (generated, ignored)
```

## The two ways to deploy

**One service.** A deployment that runs one of the three services runs
the stack of that service alone:

```bash
docker compose -f deploy/compose/gateway.compose.yaml up --build
docker compose -f deploy/compose/access.compose.yaml up --build
docker compose -f deploy/compose/data.compose.yaml up --build

kubectl apply -k deploy/kubernetes/base/gateway
kubectl apply -k deploy/kubernetes/base/access
kubectl apply -k deploy/kubernetes/base/data
```

**The console.** The console is a **client** of the platform: it is
deployed behind the gateway, and it is not one of the three services. It
is not published as an image: a deployment that wants it builds it from
`packages/console/Dockerfile`, and the stack of the console is in
`deploy/compose/console.compose.yaml`.

**The composition.** A deployment that runs the three runs the
composition, and the three services talk to each other over the network
of the deployment:

```bash
docker compose -f deploy/compose/platform.compose.yaml up --build

kubectl apply -k deploy/kubernetes/overlays/platform
```

The two ways hold the same services, the same ports and the same names
of the variables of the environment. A service that is deployed alone
names the others with the variables of the environment
(`GATEWAY_ACCESS_URL`, `DATA_ACCESS_URL`), and the composition names them
with the names of the services of the network.

## The stacks of a machine

The four files of `deploy/compose/` are the stacks of a **development
machine**: they build the images of the repository, they use the
passwords of the development, and they bring the fixtures of the
repository (the identity provider, the sample upstreams, the
credentials of the data service).

The four files of `deploy/compose/production/` are the stacks of a
**deployment**: they use the images of the registry, they take their
secrets from the environment of the shell — a secret store, a vault
agent, the secrets of the orchestrator — and they refuse to start when a
secret is missing.

```bash
docker compose -f deploy/compose/production/platform.compose.yaml up -d
```

The variables that the stacks of a deployment require are listed in
[the minimum environment of the platform](../.env.min), with the example
values of a development machine:

```bash
docker compose --env-file .env.min \
  -f deploy/compose/production/platform.compose.yaml up -d
```

## The manifests of a cluster

Every base of `deploy/kubernetes/base/` is applied on its own, and the
overlay of `deploy/kubernetes/overlays/platform/` composes the three.

The secrets are **not** in the manifests: each base holds a
`secret.example.yaml` that names the keys of the secret of the
deployment, and the secret itself is applied from the secret store of the
platform (sealed secrets, the external secrets operator or the
equivalent of the platform).

The migration of the data service is an operator command and it is not
part of the resources of the base: it is applied by hand, once per
deployment, with `deploy/kubernetes/base/data/migrate-job.yaml`.

## The configuration

`deploy/config/` holds the configuration of the deployment: the route
table of the gateway, the bindings of the data service, the map of the
tokens of the control plane and the policy of the reference access
service.

| File | What it holds |
| --- | --- |
| `routes.json` | The route table of the composition: the gateway forwards to the data service. |
| `routes.gateway.json` | The route table of the gateway alone: it forwards to the sample upstreams of the development. |
| `routes.local.json` | The route table for a run from the source: the upstreams are on the loopback. It is generated. |
| `bindings.json` | The bindings of the data service: the routes of the gateway and the key that verifies the identity of the requests. |
| `bindings.local.json` | The bindings for a run from the source: the key is at its path on the disk. It is generated. |
| `control-tokens.example.json` | The map of the tokens of the control plane. It is an example, and the map of the tokens is a secret. |
| `access-policy.json` | The policy of the reference access service of the development. |

## The keys of a development machine

The pair of the identity signature is **generated**, and it is not
committed:

```bash
bun run scripts/dev-keys.ts
export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"
```

The script writes the private half and the public half of the pair into
`deploy/secrets/`, and the two configuration files of a run from the
source into `deploy/config/`.

The credentials of the data service are **fixtures**, and they are
committed on purpose: they are in `deploy/fixtures/secrets/`, and anyone
who reads the repository knows their values. A deployment mounts the
credentials of its own secret manager.

## The rules of the directory

- A file of a deployment is in `deploy/` and nowhere else.
- A service that is deployed alone and a service that is deployed in the
  composition have the same name, the same port and the same names of
  the variables of the environment.
- The secrets of a deployment are never in this directory: they are
  files of the secret manager of the deployment, or the variables of the
  environment of the orchestrator.
- The version of the images of a deployment is the version of the
  platform. The check of the directory (`bun run deploy:check`) fails
  when the two drift.
