# Platform

Three HTTP services and a web console, kept as workspaces of one repository: one install, one lockfile, one CI run, one release line. Each service's spec is normative; where a platform page and a spec disagree, the spec wins.

## How it fits

```
browser ──▶ Console ──▶ Gateway ──▶ Data ──▶ PostgreSQL
                │           │            │
                │           │            └──▶ Access (access context)
                │           └───────────────▶ Access (login and decisions)
                └──────────────────────────▶ Access (login and administration)
```

- **Gateway**: the only service an API caller reaches. It authenticates the caller (OIDC with PKCE for browsers, bearer tokens for API clients), asks Access, and forwards the request with the caller's identity signed as a JWS. It fails closed: no answer means refusal. It has no domain model.
- **Access**: an OIDC broker and access decision service. It signs callers in at each tenant's identity provider, maps them to principals, issues its own tokens to the gateway, and answers its decisions. It holds tenants, principals, groups, grants and the administration audit.
- **Data**: a headless, permission-aware data API. It owns workspaces, collections, data policies, records, audit and version history, and committed events. It verifies the gateway's signature and asks Access for the caller's access context.
- **Console**: the web interface, a client of the three that decides nothing itself. The browser reaches it on its own address; it signs the caller in against Access itself and reads the data through the gateway.

The services are separate processes and deployments that talk only over HTTP; no workspace imports another's source.

## Services at a glance

| | Gateway | Access | Data |
| --- | --- | --- | --- |
| Env prefix | `GATEWAY_*` | `ACCESS_*` | `DATA_*` |
| Port | `8080` | `8081` | `8082` |
| State | Sessions, limits, cached decisions (Redis or PostgreSQL) | Eight tables (PostgreSQL); login codes (Redis) | Business data (PostgreSQL) |
| Probes | `/healthz`, `/readyz` | `/healthz`, `/readyz` | `/healthz`, `/readyz` |
| API description | `/openapi.json`, plus the control plane's | `/openapi.json` | `/ws/{workspaceId}/v1/openapi.json` |
| Version | `1.0.0` | `1.0.0` | `1.0.0` |

## Next

| To | Read |
| --- | --- |
| Run it locally | [Quickstart](quickstart.md), then [Development](development.md) |
| See the whole platform on one page | [Atlas](atlas.html) |
| Deploy it | [Operations](operations.md) |
| Review trust boundaries and secrets | [Security](security.md) |
| Work on the repository itself | [Internals](internals.md), [Decisions](decisions.md) |

Service areas: [Gateway](../gateway/README.md), [Access](../access/README.md), [Data](../data/README.md), [Console](../console/README.md).
