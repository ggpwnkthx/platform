# The platform

This directory holds the documentation that is **common** to the three
services: the shape of the repository, the machine of a developer, the
deployment, the release, the security model and the baseline of the
compatibility.

The documentation of a **contract** is in the directory of its service,
and it is the normative one. A behaviour that the documentation of the
platform and the specification of a service describe differently is a
defect of the documentation of the platform.

## The documents

| Document | What it holds |
| --- | --- |
| [architecture.md](architecture.md) | The layout of the repository, the workspaces and the boundaries between them. |
| [atlas.html](atlas.html) | The atlas of the platform: the whole platform on one page, the stations and the contracts between them, and a request walked over the map. |
| [development.md](development.md) | The machine of a developer: the commands, the tests and the fixtures. |
| [operations.md](operations.md) | How to deploy, configure, run and review the platform. |
| [release.md](release.md) | How a release is cut, what it carries and how it is verified. |
| [security.md](security.md) | The security model of the platform and how to report a finding. |
| [compatibility.md](compatibility.md) | The baseline of the platform and the suites that prove it. |
| [decisions.md](decisions.md) | The decisions of the platform, with their evidence. |

## The contracts

| Service | The specification | The api | The operations |
| --- | --- | --- | --- |
| The gateway | [spec.md](../gateway/spec.md) | [README.md](../gateway/README.md) | [operations.md](../gateway/operations.md), [recovery.md](../gateway/recovery.md) |
| The console | [spec.md](../console/spec.md) | [README.md](../console/README.md) | [operations.md](../console/operations.md) |
| The access service | [spec.md](../access/spec.md) | [api.md](../access/api.md) | [operations.md](../access/operations.md) |
| The data service | [specification.md](../data/specification.md) | [api.md](../data/api.md) | [operations.md](../data/operations.md) |

## The gateway

It is the only service the callers reach. It has no domain model of
its own: the workspaces, the roles and the quotas live in the access
service.

It does three things, in this order:

1. **It authenticates the caller.** OpenID Connect with PKCE for the
   browser, bearer tokens for the api clients, in four modes that decide
   predictably which credential a route accepts.
2. **It asks the access service.** The access service decides who may
   use a workspace, and the gateway fails closed: an answer that does
   not come is a refusal.
3. **It forwards the request.** The identity of the caller is written by
   the gateway and signed with a JWS that the upstream verifies with a
   standard library.

Its own documentation is in [`docs/gateway/`](../gateway/), and its
normative contract is [its specification](../gateway/spec.md).

## The access service

It is an OpenID Connect broker and an access decision service. It
authenticates a caller against the identity provider of a tenant, maps
the external identity to a principal, issues its own tokens to the
gateway, and answers the decisions the gateway asks.

It holds the identity of the platform: the tenants, the principals, the
groups, the grants and the audit of the administration.

Its own documentation is in [`docs/access/`](../access/), and its
normative contract is [its specification](../access/spec.md).

## The data service

It is a headless, permission aware data api. It owns the workspaces, the
registered collections, the data policies, the records, the audit
history, the history of the versions of the records and the committed
events.

It is a standalone deployment. It does not serve a studio, it does not
depend on a studio, and it does not know that a studio exists: a studio
is one of its clients, like any other client.

Its own documentation is in [`docs/data/`](../data/), and its
normative contract is [its specification](../data/specification.md).

## The three are one repository

They are three processes and three deployments, and they are three
workspaces of one repository:

- one `bun install` installs the three;
- one lockfile pins every dependency;
- one continuous integration proves the three;
- one release publishes the three images and the three binaries;
- one baseline of the compatibility proves that they still speak to each
  other.

The merge is of the **source**, not of the runtime. A workspace never
imports the source of another one: the services talk over HTTP, and the
merge keeps that.
