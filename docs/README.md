# The documentation of the platform

The platform is three services in one repository. **All** of the
documentation lives in this directory: the parts that are common to the
three services, and the documentation of the contract of each one.

```
docs/
├── platform/   the platform: the repository, the development, the deployment, the release
├── gateway/    the contract of the gateway
├── access/     the contract of the access service
├── data/       the contract of the data service
└── console/    the console: the web application of the platform
```

There is one documentation, and it is in one place. A reader who wants
to know what the platform does starts at
[the documentation of the platform](platform/README.md); a reader who
implements a service starts at the specification of that service.

## Where to start

| If you are | Read |
| --- | --- |
| new to the platform | [the overview](platform/README.md), then the [architecture](platform/architecture.md) |
| someone who wants to see the whole platform at once | [the atlas](platform/atlas.html) — the map of the platform, and a request walked over it |
| a developer of the platform | the [development](platform/development.md) |
| an operator of a deployment | the [operations of the platform](platform/operations.md), then the operations of the service you run |
| a reviewer of a service | the [security of the platform](platform/security.md), then the security of the service |
| cutting a release | the [release](platform/release.md) |
| implementing an upstream of the gateway | the [identity of a request](gateway/upstream-identity.md) |
| using the console of the platform | the [console](console/README.md) |

## The platform

The documentation that is common to the three services: the shape of the
repository, the machine of a developer, the deployment, the release, the
security model and the baseline of the compatibility.

| Document | What it holds |
| --- | --- |
| [platform/README.md](platform/README.md) | What the platform does and how the pieces fit, in one page. |
| [platform/architecture.md](platform/architecture.md) | The layout of the repository, the workspaces and the boundaries between them. |
| [platform/development.md](platform/development.md) | The machine of a developer: the commands, the tests and the fixtures. |
| [platform/operations.md](platform/operations.md) | How to deploy, configure, run and review the platform. |
| [platform/release.md](platform/release.md) | How a release is cut, what it carries and how it is verified. |
| [platform/security.md](platform/security.md) | The security model of the platform and how to report a finding. |
| [platform/compatibility.md](platform/compatibility.md) | The baseline of the platform and the suites that prove it. |
| [platform/decisions.md](platform/decisions.md) | The decisions of the platform, with their evidence. |

## The contracts

The documentation of each service is **normative**: a behaviour that
the documentation of the platform and the specification of a service
describe differently is a defect of the documentation of the platform.

| Service | The specification | The api | The operations | The rest |
| --- | --- | --- | --- | --- |
| The gateway | [spec.md](gateway/spec.md) | [README.md](gateway/README.md) | [operations.md](gateway/operations.md), [recovery](gateway/recovery.md) | [architecture](gateway/architecture.md), [capacity](gateway/capacity.md), [runtime](gateway/runtime.md), [decisions](gateway/decisions.md), [the identity of a request](gateway/upstream-identity.md) |
| The access service | [spec.md](access/spec.md) | [api.md](access/api.md) | [operations.md](access/operations.md) | [architecture](access/architecture.md), [security](access/security.md), [release](access/release.md), [compatibility](access/compatibility.md), [decisions](access/decisions.md) |
| The data service | [specification.md](data/specification.md) | [api.md](data/api.md) | [operations.md](data/operations.md) | [architecture](data/architecture.md), [configuration](data/configuration.md), [client](data/client.md), [migrations](data/migrations.md), [backup and restore](data/backup-restore.md), [decisions](data/decisions.md) |

Each service has an index of its own, and it names the audience of
every document: [gateway](gateway/README.md), [access](access/README.md),
[data](data/README.md).

## The console

The console is the web application of the platform: it shows the data of
a workspace and the administration of the access service. It is a
**client** of the platform, and it is documented apart from the
contracts of the services it calls.

| Document | What it holds |
| --- | --- |
| [console/README.md](console/README.md) | What the console is and where to start. |
| [console/spec.md](console/spec.md) | The normative contract of the console. |
| [console/security.md](console/security.md) | What the console holds, what it never holds and where the trust stops. |
| [console/operations.md](console/operations.md) | The environment, the deployment, the probes and the rotation of the secrets. |

## The three services in one page

| | The gateway | The access service | The data service |
| --- | --- | --- | --- |
| The role | It authenticates a caller, asks the access service and forwards the request to an upstream of the route it matched. | It authenticates a caller against the provider of a tenant, maps the identity to a principal and answers the decisions of the gateway. | It verifies the identity the gateway forwards, asks the access service for the access context and enforces the policies of the deployment. |
| The environment | `GATEWAY_*` | `ACCESS_*` | `DATA_*` |
| The listener | `8080` | `8081` | `8082` |
| The state it holds | The sessions, the limits and the cached decisions, in a Redis server or a PostgreSQL server. | The five tables of the platform, in a PostgreSQL server, and the codes of the logins, in a Redis server. | The rows of the business data, in a PostgreSQL server. |
| The probes | `/healthz` and `/readyz`, with the vocabulary of the platform: `ready`, `draining` and `not-ready`. | `/healthz` and `/readyz`, with the vocabulary of the platform: `ready`, `draining` and `not-ready`. | `/healthz` and `/readyz`, with the vocabulary of the platform: `ready`, `draining` and `not-ready`. |
| The description of its API | `/openapi.json`, and the description of its control plane. | `/openapi.json`. | `/ws/{workspaceId}/v1/openapi.json`. |
| The version | `1.0.0` | `1.0.0` | `1.0.0` |
