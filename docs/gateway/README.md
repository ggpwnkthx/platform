# The gateway

The gateway is the **application gateway** of the platform. It sits
between the callers and the applications behind it: for every request it
works out who the caller is, asks the access service what the caller
may do, and forwards the request to the upstream of the route it matched,
with the identity of the caller attached and signed.

The gateway holds no users, no roles and no permissions of its own. The
identity provider knows who people are, the access service decides what
they may do, and the gateway enforces both answers.

## The documents

| Document | What it holds |
| --- | --- |
| [spec.md](spec.md) | **The normative contract.** The behaviour of the service. A change of behaviour is a change of this document first. |
| [architecture.md](architecture.md) | How the code is laid out, which import is allowed where, and which file owns what. |
| [decisions.md](decisions.md) | The decisions behind the contract, with their evidence. |
| [operations.md](operations.md) | How to deploy, configure, run and review it. |
| [recovery.md](recovery.md) | How to recover it when a dependency fails, a rollback is needed, a session has to end or a secret has to rotate. |
| [capacity.md](capacity.md) | The measurements of the capacity. |
| [runtime.md](runtime.md) | The capabilities of the runtime the gateway is written against. |
| [upstream-identity.md](upstream-identity.md) | How an upstream verifies the identity of a request, with the code. |

A reference to `§N` in the code, in the tests or in these documents is a
reference to a section of [spec.md](spec.md). Where a document and the
specification describe the same thing differently, the specification
wins.

## Where to start

| You want to… | Read |
| --- | --- |
| Run it locally | [the README of the workspace](../../packages/gateway/README.md#quick-start): `bun install && bun run dev:gateway` |
| Deploy and operate it | [operations.md](operations.md) |
| Recover it when it is not behaving | [recovery.md](recovery.md) |
| Change the code | [architecture.md](architecture.md), then the spec section for the behaviour you are changing |
| Know why something is the way it is | [decisions.md](decisions.md) |
| Write an upstream that trusts the gateway | [upstream-identity.md](upstream-identity.md) |
| Size a deployment | [capacity.md](capacity.md) |

## What it is

The gateway sits between callers and your applications. For every
request it:

1. **works out who the caller is**, from a browser session or a bearer token;
2. **asks your access service** whether that caller may use the workspace
   named in the URL;
3. **forwards the request** to the application behind the route, with the
   caller's identity attached and signed.

It does not terminate TLS, cache responses, or decide access on its own.
The full list is in [spec.md §13](spec.md#13-what-the-gateway-does-not-do).

## The life of a request

Every request that is not one of the gateway's own endpoints (`/healthz`,
`/readyz`, `/metrics`, `/auth/*`) goes through the same steps, in this
order. A step that refuses the request stops it there.

| Step | What happens | If it fails |
| --- | --- | --- |
| Match a route | The host, path and method pick a route from the configuration file. | `404`, once the rate limits have counted the request |
| Admit the request | The number of requests inside the gateway is bounded, so a dependency that hangs cannot pile them up. | `503`, at once |
| Rate limits | The deployment's total, the caller's budget across all routes, and the caller's budget on this route. | `429` |
| Authenticate | The route's mode says which credential to accept (see below). Then the signed-in caller's own budget on the route is checked. | `401`, or a redirect to the login page for a browser; `429` |
| Cross-site guard | A request from another site that carries the session cookie is refused. | `403` |
| Ask the access service | Only when the route names a workspace, or asks for a check. | `403` when denied, `503` when the service is down |
| Forward | Headers are cleaned, the identity is written and signed, and the request is streamed to the upstream. | `502` or `504` |

The exact order, with every answer, is in [spec.md §2.3](spec.md#23-the-dispatcher), and the
code follows it in `src/app/dispatcher.ts`.

## The ideas you need

**Route.** One entry of the configuration file (`config/routes.json`). It
matches a host and a path, names one upstream or an ordered list of them,
and carries the policy for those requests. An invalid file is rejected
whole, and a reload that fails keeps the previous configuration running.
→ [spec.md §3](spec.md#3-the-configuration-file)

**Authentication mode.** Each route accepts one of four:

| Mode | Accepts |
| --- | --- |
| `none` | Anyone. |
| `session` | The browser session cookie, set after an OpenID Connect login. |
| `jwt` | A bearer token in the `Authorization` header. |
| `any` | A bearer token if there is one, otherwise the session cookie. |
A credential that is present but invalid is refused. The gateway never
falls back to another one. → [spec.md §5](spec.md#5-authentication)

**Access service.** A small HTTP service you run. The gateway sends it
`POST /v1/decisions` with the caller and the workspace, and it answers
`{"allow": true}` or `{"allow": false}`. Any other answer, or no answer,
is treated as an outage: the request is refused with `503`, never let
through. A route may opt into a short grace period that keeps serving
the last decision while the service is down. A reference implementation
is in `services/access-service.ts`. → [spec.md
§6](spec.md#6-workspace-access)

**Signed identity.** The gateway removes any `x-gateway-*` headers the
caller sent, writes its own (`x-gateway-user`, `x-gateway-workspace`, …),
and signs them in `x-gateway-signature`. An upstream checks the signature
with the gateway's public key, so it can trust the identity without
trusting the network. → [upstream-identity.md](upstream-identity.md)

**Shared state.** Sessions, rate-limit windows and cached access decisions
live in Redis or Postgres when you run more than one replica, so every
replica sees the same state. Both backends pass the same tests. A single
node may keep them in memory instead, if it opts in with
`GATEWAY_ALLOW_MEMORY_STATE=true`. →
[operations.md](operations.md#the-shape-of-the-shared-state)

**The control plane.** The administrative surface of a deployment is a
separate process, `gateway-control`. It listens on its own socket, on the
internal network, and it acts on the shared state directly: the gateway
exposes no administrative endpoint and accepts no administrative token.
The route table may live in the shared state too, as a list of immutable
revisions that the control plane writes and that every replica watches. →
[operations.md](operations.md#the-control-plane)

**Several upstreams.** When a route lists more than one upstream, a request
that is safe to send twice moves on to the next upstream if the first one
fails. A request that could change data (a `POST`, for example) is only ever
sent once. Upstreams that failed recently are moved to the end of the list
for a while. → [spec.md §11.4](spec.md#114-the-upstreams-of-a-route)

## The platform around it

The gateway is one of the three services of the platform. They are
separate processes and separate services, and each one of them owns a
contract:

| Service | What it owns |
| --- | --- |
| The gateway | The routing, the contract of the access decision, and the format of the identity it forwards. |
| The access service | The OpenID Connect broker and the access service the gateway asks. |
| The data service | The data service behind the gateway: it verifies the forwarded identity and asks the access service for the access context. |

A deployment names the **addresses** of the services — the issuer, the
access service and the upstream — in its environment and in its route
table. The repository holds the source of the services; it is not a
service endpoint. The gateway works with any conforming identity
provider, access service and upstream, and the access service and the
data service are the ones that ship with it.

The parts of the platform that are common to the three services are in
[the documentation of the platform](../platform/).
