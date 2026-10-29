# Access

Access is an OpenID Connect broker and access decision service: it authenticates callers against each tenant's identity provider, maps them to principals, and answers the gateway's existing decision contract.

## How it fits

The gateway (`packages/gateway/`, read-only here) logs callers in through this service and asks it for a decision on every request; the gateway itself is unchanged, and the compatibility suite proves it against the repository's revision of the gateway. Data reads a principal's capabilities through the access context contract. Shared concerns are in [Platform](../platform/README.md).

Concepts:

- **Tenant**: a customer with its own provider and one gateway client.
- **Principal**: a tenant's user, keyed by `(tenant, subject)` from the provider.
- **Grant**: a permission or role on a workspace and route; grants alone decide access.
- **Administration**: twelve `curl` endpoints plus one that reads the change audit, with platform or per-tenant credentials.

The domain model is eight tables: `tenants`, `users`, `permissions`, `grants`, `groups`, `roles`, `role_permissions`, `role_roles`.

## Start here

| Page | Use it for |
| --- | --- |
| [Operations](operations.md) | Deploy, monitor, run books, secrets, backups, tenant cutover. |
| [API](api.md) | Every endpoint with `curl` examples, including a tenant's session in twelve calls. |
| [Specification](spec.md) | The normative contract; change it first when behavior changes. |
| [Internals](internals.md) | Code layout, compatibility suite, capacity, security review, release readiness. |
| [Decisions](decisions.md) | Design decisions and their evidence. |

`§N` in code, tests and these pages means a section of the spec. A behavior change updates the spec in the same commit as the code; see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Run it locally

```bash
bun install
ACCESS_SECRET_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) bun run src/main.ts
bun run test          # units, contracts, boundaries
bun run test:compat   # the unchanged gateway against this service
```

Without `ACCESS_DATABASE_URL` the process runs embedded PostgreSQL (`pglite`) in `./.access/pglite` with the production migrations. The variable takes `postgres://…` or `pglite://<path>`; production must name a server. The root `bun run dev` uses one PostgreSQL 18 server with a database per service (§4). `bun run test:integration` runs the integration tests, on a server when `ACCESS_TEST_DATABASE_URL` is set.

## Release state

Version `1.0.0` of the platform. Milestones M0 to M9 are closed: the process starts, validates its environment, answers probes, drains, brokers logins, issues tokens, answers gateway decisions, and passes the unchanged reference gateway's suite. This release adds per-tenant administration credentials, denial reason codes, groups, administration batches and audit export. See [Known limits](internals.md#known-limits) for what it does not do.
