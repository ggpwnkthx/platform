# Platform

What the platform is, how its processes connect, and where to read next. Start here if you are new to the repository, whatever your role.

## What it is

The platform is three HTTP services and a web console, kept as workspaces of one Bun repository: one install, one lockfile, one CI run and one release line. A command line client, the CLI (`platformctl`), ships from the same repository. Each service's spec is normative. When a platform page and a spec disagree, the spec wins.

| Process | Job |
| --- | --- |
| [Gateway](../gateway/README.md) | The only service an API caller reaches. It authenticates the caller (OIDC with PKCE for browsers, bearer tokens for API clients), asks Access, and forwards the request with the caller's identity signed as a JWS. It has no domain model. |
| [Access](../access/README.md) | An OIDC broker and access decision service. It signs callers in at each tenant's identity provider, maps them to principals, issues its own tokens to the gateway, and answers its decisions. It holds tenants, principals, groups, grants and the administration audit. |
| [Data](../data/README.md) | A headless, permission-aware data API. It owns workspaces, collections, data policies, records, audit and version history, and committed events. |
| [Console](../console/README.md) | The web interface. It is a client of the three services and decides nothing itself. |

The [CLI](../cli/README.md) is a client of the same contracts, run from an operator's or developer's machine. The two of them read those contracts in one place, the client workspace (`packages/client`), and each of them keeps the way it shows an answer and the way it speaks to a service.

## How the processes talk

```text
browser ──▶ Console ──▶ Gateway ──▶ Data ──▶ PostgreSQL
                │           │            │
                │           │            └──▶ Access (access context)
                │           └───────────────▶ Access (login and decisions)
                └──────────────────────────▶ Access (login and administration)
```

The four processes are separate deployments that talk only over HTTP. No workspace imports another's source.

- The gateway fails closed: when Access gives no answer, the request is refused.
- Data verifies the gateway's signature, then asks Access for the caller's access context.
- The browser reaches the console on its own address. The console signs the caller in against Access directly and reads workspace data through the gateway.

## A request, end to end

Follow one browser request for `/ws/{workspaceId}/v1/me`, the request the [quickstart](quickstart.md#send-a-request-through-the-gateway) sends:

1. The gateway matches the request to a route. The caller has no session yet, so the gateway redirects the browser to Access to log in.
2. Access sends the browser on to the tenant's identity provider. After the provider signs the caller in, Access maps the external identity to a principal and issues its own token to the gateway, which keeps a server-side session.
3. The gateway asks Access for a decision: may this principal use this workspace on this route? Anything but an explicit answer is treated as an outage, never a pass.
4. The gateway forwards the request to Data with signed `x-gateway-*` identity headers.
5. Data verifies the signature with the gateway's public key from its bindings, asks Access for the principal's access context, and answers with the principal, tenant and workspace as JSON.

The [atlas](atlas.html) draws the whole platform on one page and walks several requests across it.

## Services at a glance

| | Gateway | Access | Data | Console |
| --- | --- | --- | --- | --- |
| Env prefix | `GATEWAY_*` | `ACCESS_*` | `DATA_*` | `CONSOLE_*` |
| Port | `8080` | `8081` | `8082` | `8083` |
| State | Sessions, limits, cached decisions (Redis or PostgreSQL) | Eight tables (PostgreSQL); login codes (Redis) | Business data (PostgreSQL) | Sessions and pending logins, in process memory |
| Probes | `/healthz`, `/readyz` | `/healthz`, `/readyz` | `/healthz`, `/readyz` | `/healthz`, `/readyz` |
| API description | `/openapi.json`, plus the control plane's | `/openapi.json` | `/ws/{workspaceId}/v1/openapi.json` | — |
| Version | `1.0.0` | `1.0.0` | `1.0.0` | `1.0.0` |

## Find your way

| To | Read |
| --- | --- |
| Find pages for your role or task | [Documentation home](../README.md) |
| Learn the shared vocabulary | [Concepts](concepts.md) |
| Run it locally | [Quickstart](quickstart.md), then [Development](development.md) |
| See the whole platform on one page | [Atlas](atlas.html) |
| Deploy it | [Operations](operations.md) |
| Review trust boundaries and secrets | [Security](security.md) |
| Work on the repository itself | [Internals](internals.md), [Decisions](decisions.md) |
| Go deep on one service | [Gateway](../gateway/README.md), [Access](../access/README.md), [Data](../data/README.md), [Console](../console/README.md), [CLI](../cli/README.md) |
