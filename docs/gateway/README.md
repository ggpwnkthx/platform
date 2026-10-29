# Gateway

The gateway is the platform's application gateway: for every request it identifies the caller, asks Access what the caller may do, and forwards the request to the route's upstream with a signed identity. This page is the overview for everyone; it links to the page for each task.

## What it does

It holds no users, roles or permissions: the identity provider knows who people are, Access decides what
they may do, and the gateway enforces both answers. It does not terminate TLS, cache responses or decide
access on its own ([spec §13](spec.md#13-what-the-gateway-does-not-do)).

```text
caller (browser or API client)
  │
  ▼
ingress (terminates TLS)
  │
  ▼
gateway ───► identity provider (OIDC login, JWKS)
  │     ───► Access (POST /v1/decisions)
  │     ◄──► shared state (Redis or Postgres) ◄─── gateway-control (internal)
  ▼
upstream (verifies x-gateway-signature)
```

A request passes these steps in order, and the first refusal stops it: match a route (`404`), admission
(`503`), rate limits (`429`), authentication (`401` or login redirect), cross-site guard (`403`), access
decision (`403` or `503`), forward (`502` or `504`). Details: [spec §2.3](spec.md#23-dispatcher).

## Concepts

| Concept | In short | Spec |
| --- | --- | --- |
| Route | An entry of the route table: host, path and optional method pick one or more upstreams and the request policy. An invalid table is rejected whole. | [§3](spec.md#3-configuration-file) |
| Authentication | Each route accepts `none`, `session` (browser cookie after an OIDC login), `jwt` (bearer token) or `any`. An invalid credential is refused, never replaced. | [§5](spec.md#5-authentication) |
| Access decision | `POST /v1/decisions` to Access; anything but an explicit answer is an outage (`503`), never a pass. | [§6](spec.md#6-workspace-access) |
| Signed identity | `x-gateway-*` headers signed with the gateway's private key; upstreams verify with the public key. | [§7.4](spec.md#74-identity-signature), [Upstream identity](upstream-identity.md) |
| Shared state | Sessions, rate-limit windows and cached decisions in Redis or Postgres, shared by replicas. | [§12.5](spec.md#125-shared-state) |
| Control plane | `gateway-control`, a separate internal process that manages sessions and the route table. | [§12.7](spec.md#127-control-plane) |

## Find your way

| Task | Page |
| --- | --- |
| Run it locally | [Workspace README](../../packages/gateway/README.md#quick-start): `bun install && bun run dev:gateway` |
| Deploy, monitor, rotate secrets, roll back | [Operations](operations.md) |
| Look up a variable or a route-table override | [Configuration](configuration.md) |
| Diagnose a status code or a login loop | [Troubleshooting](troubleshooting.md) |
| Write an upstream that trusts the identity | [Upstream identity](upstream-identity.md) |
| Know the exact behavior | [Specification](spec.md); `§N` in code refers to it, and it wins any disagreement |
| Change the code | [Internals](internals.md), [Decisions](decisions.md) |
| Report a vulnerability | [Gateway security](../../packages/gateway/SECURITY.md) |

## Platform

The gateway owns routing, the access-decision contract and the forwarded identity format.
[Access](../access/README.md) is the OIDC broker and decision service; [Data](../data/README.md) sits
behind the gateway and verifies the identity. The gateway works with any conforming provider, Access and
upstream. Shared material: [Platform](../platform/README.md).

## Status

Release `1.0.0`, on Bun ≥ 1.4.3. The `1.0` contracts are frozen
([spec §14](spec.md#14-release-compatibility)).
