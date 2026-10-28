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
| [overview.md](overview.md) | Start here: what the gateway does and how the pieces fit, in one page. |
| [spec.md](spec.md) | **The normative contract.** The behaviour of the service. A change of behaviour is a change of this document first. |
| [architecture.md](architecture.md) | How the code is laid out, which import is allowed where, and which file owns what. |
| [decisions.md](decisions.md) | The decisions behind the contract, with their evidence. |
| [operations.md](operations.md) | How to deploy, configure, run and review it. |
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
| Change the code | [architecture.md](architecture.md), then the spec section for the behaviour you are changing |
| Know why something is the way it is | [decisions.md](decisions.md) |
| Write an upstream that trusts the gateway | [upstream-identity.md](upstream-identity.md) |
| Size a deployment | [capacity.md](capacity.md) |

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
