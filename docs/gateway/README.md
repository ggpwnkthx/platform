# Gateway

The gateway is the platform's application gateway. For every request it identifies the caller, asks the
access service what the caller may do, and forwards the request to the matched route's upstream with the
caller's identity attached and signed.

The gateway holds no users, roles or permissions. The identity provider knows who people are, the access
service decides what they may do, and the gateway enforces both answers. It does not terminate TLS, cache
responses or decide access on its own; see [spec §13](spec.md#13-what-the-gateway-does-not-do) for the full list.

## Pages

| Page | Use it to |
| --- | --- |
| [Specification](spec.md) | Read the normative contract. A behaviour change starts here. |
| [Architecture](architecture.md) | Change the code: layout, allowed imports, which file owns what. |
| [Decisions](decisions.md) | Learn why something is the way it is, with evidence. |
| [Operations](operations.md) | Deploy, configure, run and review a deployment. |
| [Recovery](recovery.md) | Handle a failing dependency, a rollback, session revocation or secret rotation. |
| [Capacity](capacity.md) | Size a deployment from the measurements. |
| [Runtime](runtime.md) | See which Bun capabilities the gateway relies on and how they were proved. |
| [Upstream identity](upstream-identity.md) | Write an upstream that verifies the gateway's signed identity. |

To run it locally, see the [workspace README](../../packages/gateway/README.md#quick-start):
`bun install && bun run dev:gateway`.

`§N` in code, tests and docs refers to a section of [spec.md](spec.md). If a page and the spec disagree,
the spec wins.

## Request lifecycle

Every request except the gateway's own endpoints (`/healthz`, `/readyz`, `/metrics`, `/auth/*`) goes
through these steps in order. A step that refuses the request stops it.

| Step | What happens | On failure |
| --- | --- | --- |
| Match a route | Host, path and method pick a route from the configuration file. | `404`, after the rate limits count the request |
| Admit | The number of requests inside the gateway is bounded, so a hanging dependency cannot pile them up. | `503`, immediately |
| Rate limits | The deployment total, the caller's budget across all routes, and the caller's budget on this route. | `429` |
| Authenticate | The route's mode picks the accepted credential; then the signed-in caller's own budget on the route is checked. | `401` (or a login redirect for a browser); `429` |
| Cross-site guard | A request from another site that carries the session cookie is refused. | `403` |
| Ask the access service | Only when the route names a workspace or asks for a check. | `403` if denied, `503` if the service is down |
| Forward | Headers are cleaned, the identity is written and signed, and the request is streamed upstream. | `502` or `504` |

The exact order and every answer are in [spec §2.3](spec.md#23-dispatcher); the code is `src/app/dispatcher.ts`.

## Features

| Feature | Summary | Spec |
| --- | --- | --- |
| Routes | One entry of `config/routes.json`: matches host, path and optionally method (fixed precedence, ambiguity check at load), names one upstream or an ordered list, may rewrite the upstream path, and carries the request policy. An invalid file is rejected whole; a failed reload keeps the previous configuration. | [§3](spec.md#3-configuration-file) |
| Authentication | OpenID Connect with PKCE for browsers, bearer tokens for API clients. Each route accepts one mode (table below). A credential that is present but invalid is refused; the gateway never falls back to another one. | [§5](spec.md#5-authentication) |
| Access service | A small HTTP service you run. The gateway sends `POST /v1/decisions` with the caller and workspace; it answers `{"allow": true}` or `{"allow": false}`. Any other answer, or none, is an outage: `503`, never let through. A route may ask about itself instead of a workspace, or opt into a short grace that serves the last decision during an outage. A breaker stops the gateway waiting on a service that is down. The protocol is published, and `services/access-service.ts` is a reference implementation. | [§6](spec.md#6-workspace-access) |
| Signed identity | The gateway strips caller-sent `x-gateway-*` headers, writes its own (`x-gateway-user`, `x-gateway-workspace`, …) and signs them in `x-gateway-signature` as a JWS. Upstreams verify it with the gateway's public key, so they trust the identity without trusting the network. It also writes the request's trace context. | [Upstream identity](upstream-identity.md) |
| Proxying | Streamed bodies, server-sent events and uploads, a budget per exchange phase and a body limit. With several upstreams, a request that is safe to send twice moves to the next upstream when one fails; a request that could change data (a `POST`, for example) is sent once. A passive breaker moves recently failed upstreams to the end of the list. | [§11](spec.md#11-proxying) |
| Sessions | Server-side, with an idle lifetime and a maximum age. All sessions of one caller can be revoked at once. | [§5.3](spec.md#53-sessions) |
| Limits | Four scopes of sliding windows shared by the replicas, which bound a flood without a boundary burst. | [§9](spec.md#9-limits) |
| WebSockets | Upstream handshake first, bounded buffers, keepalive, and revalidation that closes a connection whose access was revoked. | [§10](spec.md#10-websockets) |
| Shared state | Sessions, rate-limit windows and cached decisions live in Redis or Postgres when you run more than one replica; both backends pass the same tests. A single node may keep them in memory if it sets `GATEWAY_ALLOW_MEMORY_STATE=true`. | [Operations](operations.md#shared-state) |
| Control plane | A separate process, `gateway-control`, on its own internal socket, acts on the shared state directly. The gateway itself has no admin endpoint or admin token. The route table may also live in the shared state as immutable revisions that the control plane writes and every replica watches. | [Operations](operations.md#control-plane) |
| Operations | Health and readiness probes, Prometheus metrics, structured logs with redaction, a log of the running policy, hot reload and graceful drain. | [§12](spec.md#12-operations) |

Authentication modes:

| Mode | Accepts |
| --- | --- |
| `none` | Anyone. |
| `session` | The browser session cookie, set after an OpenID Connect login. |
| `jwt` | A bearer token in the `Authorization` header. |
| `any` | A bearer token if present, otherwise the session cookie. |

## Platform

The gateway is one of three services, each a separate process that owns a contract:

| Service | Owns |
| --- | --- |
| Gateway | Routing, the access-decision contract, and the format of the forwarded identity. |
| [Access service](../access/README.md) | The OpenID Connect broker and the access service the gateway asks. |
| [Data service](../data/README.md) | The data service behind the gateway; it verifies the forwarded identity and asks the access service for the access context. |

The repository holds source code, not service endpoints: a deployment names the issuer, access service
and upstream addresses in its environment and route table. The gateway works with any conforming identity
provider, access service and upstream; the access and data services are the ones that ship with it. Shared
platform material is in [Platform](../platform/README.md).
