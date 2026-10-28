# The platform in one page

The platform answers one call of a client: it authenticates the caller,
it asks what the caller may do, and it forwards the request to the data
of a workspace.

```
                       ┌──────────────────────┐
   browser  ──────────▶│  gateway             │
   api      ──────────▶│  authenticate        │
                       │  ask the access      │
                       │  service             │
                       │  forward the request │
                       └───────┬──────────────┘
                               │ the identity of the caller, signed
                               ▼
                       ┌──────────────────────┐
                       │  data service        │
                       │  verify the identity │
                       │  ask the access      │
                       │  service for the     │
                       │  access context      │
                       │  enforce the policies│
                       └───────┬──────────────┘
                               ▼
                          PostgreSQL

   the gateway ───────────▶ access service
   the data service ──────▶ access service
```

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
