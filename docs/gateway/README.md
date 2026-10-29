# Gateway

The gateway is the platform's application gateway. For every request it identifies the caller, asks the
Access what the caller may do, and forwards the request to the route's upstream with a signed
identity.

It holds no users, roles or permissions: the identity provider knows who people are, Access
decides what they may do, and the gateway enforces both answers. It does not terminate TLS, cache responses
or decide access on its own ([spec §13](spec.md#13-what-the-gateway-does-not-do)).

## Concepts

| Concept | In short | Spec |
| --- | --- | --- |
| Route | An entry of the route table: host, path and optional method pick one or more upstreams and the request policy. An invalid table is rejected whole. | [§3](spec.md#3-configuration-file) |
| Authentication | Each route accepts `none`, `session` (browser cookie after an OIDC login), `jwt` (bearer token) or `any`. An invalid credential is refused, never replaced. | [§5](spec.md#5-authentication) |
| Access decision | `POST /v1/decisions` to Access; anything but an explicit answer is an outage (`503`), never a pass. | [§6](spec.md#6-workspace-access) |
| Signed identity | `x-gateway-*` headers signed with the gateway's private key; upstreams verify with the public key. | [Upstream identity](upstream-identity.md) |
| Shared state | Sessions, rate-limit windows and cached decisions in Redis or Postgres, shared by replicas. | [§12.5](spec.md#125-shared-state) |
| Control plane | `gateway-control`, a separate internal process that manages sessions and the route table. | [§12.7](spec.md#127-control-plane) |

A request passes these steps in order, and the first refusal stops it: match a route (`404`), admission
(`503`), rate limits (`429`), authentication (`401` or login redirect), cross-site guard (`403`), access
decision (`403` or `503`), forward (`502` or `504`). Details: [spec §2.3](spec.md#23-dispatcher).

## Start here

| Goal | Page |
| --- | --- |
| Run it locally | [Workspace README](../../packages/gateway/README.md#quick-start): `bun install && bun run dev:gateway` |
| Deploy and operate it | [Operations](operations.md) |
| Look up a variable | [Configuration](configuration.md) |
| Write an upstream that trusts the identity | [Upstream identity](upstream-identity.md) |
| Know the exact behaviour | [Specification](spec.md); `§N` in code refers to it, and it wins any disagreement |
| Change the code | [Internals](internals.md), [Decisions](decisions.md) |

## Platform

The gateway owns routing, the access-decision contract and the forwarded identity format. The
[Access](../access/README.md) is the OIDC broker and decision service; the
[Data](../data/README.md) sits behind the gateway and verifies the identity. The gateway works with
any conforming provider, Access and upstream. Shared material: [Platform](../platform/README.md).
