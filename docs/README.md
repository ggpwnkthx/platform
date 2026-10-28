# Documentation

Documentation for the platform's three services and its console, in one tree. Each service's spec is normative: where platform docs and a spec disagree, the spec wins and the platform doc is the bug.

## Start here

| You are | Read |
| --- | --- |
| New to the platform | [Platform](platform/README.md), then [Architecture](platform/architecture.md) |
| Looking for the big picture | [Atlas](platform/atlas.html): the whole platform on one page, with a request walked across it |
| Developing | [Development](platform/development.md) |
| Operating a deployment | [Platform operations](platform/operations.md), then the service's operations page |
| Reviewing security | [Platform security](platform/security.md), then the service's security page |
| Cutting a release | [Release](platform/release.md) |
| Writing an upstream of the gateway | [Upstream identity](gateway/upstream-identity.md) |
| Using the console | [Console](console/README.md) |

## Areas

| Directory | Contents | Spec |
| --- | --- | --- |
| [platform/](platform/README.md) | Repository layout, development, operations, release, security, compatibility, decisions | — |
| [gateway/](gateway/README.md) | Gateway contract, operations, recovery, capacity, runtime | [spec.md](gateway/spec.md) |
| [access/](access/README.md) | Access service contract, API, operations, security | [spec.md](access/spec.md) |
| [data/](data/README.md) | Data service contract, API, client, configuration, operations | [spec.md](data/spec.md) |
| [console/](console/README.md) | Console contract, security, operations | [spec.md](console/spec.md) |

Each area's README lists its pages and who they are for.

## The three services at a glance

| | Gateway | Access service | Data service |
| --- | --- | --- | --- |
| Role | Authenticates callers, asks the access service, forwards to the matched route's upstream | Authenticates callers against each tenant's provider, maps identities to principals, answers the gateway's decisions | Verifies the identity the gateway forwards, fetches the access context, enforces data policies |
| Env prefix | `GATEWAY_*` | `ACCESS_*` | `DATA_*` |
| Port | `8080` | `8081` | `8082` |
| State | Sessions, limits, cached decisions (Redis or PostgreSQL) | Eight tables (PostgreSQL); login codes (Redis) | Business data (PostgreSQL) |
| Probes | `/healthz`, `/readyz` | `/healthz`, `/readyz` | `/healthz`, `/readyz` |
| API description | `/openapi.json`, plus the control plane's | `/openapi.json` | `/ws/{workspaceId}/v1/openapi.json` |
| Version | `1.0.0` | `1.0.0` | `1.0.0` |

All three report readiness as `ready`, `draining` or `not-ready`.
