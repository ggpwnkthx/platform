# Access

Access is the platform's OpenID Connect broker and access decision service: it authenticates callers against each tenant's identity provider, maps them to principals, and answers the gateway's existing decision contract. Start here to learn what it does and where to find each task.

## What it does

- **Brokers logins.** Access is a client of every tenant's OpenID Connect provider and, at the same time, the single provider the gateway knows.
- **Maps identities.** A provider's `(tenant, subject)` pair becomes exactly one principal, the platform identity.
- **Answers decisions.** The gateway asks `POST /v1/decisions` on every request; grants alone decide.
- **Serves the access context.** Data reads a principal's permissions for a workspace and route through `POST /v1/access-context`.
- **Is administered over HTTP.** The twelve administrative endpoints, plus one that reads the change audit, are the whole administration: `curl`, with platform or per-tenant credentials.

It does not proxy traffic, does not have a policy language of its own, and does not manage routes, upstreams or workspaces; the gateway owns those. SAML, SCIM, directory sync, account linking and a console are deferred features (§14).

## Where it sits

```text
  browser ──login──▶ gateway ──OIDC──▶ Access ──OIDC──▶ tenant identity provider
                        │                 ▲
                        └── decisions ────┘
  Data ───────── access context ─────────▶ Access ──▶ PostgreSQL (eight tables), Redis (codes)
```

The gateway (`packages/gateway/`, read-only here) logs callers in through Access and asks it for a decision on every request. The gateway itself is unchanged, and the compatibility suite proves it against the repository's revision of the gateway. Shared concerns are in [Platform](../platform/README.md).

## Key concepts

| Concept | Meaning |
| --- | --- |
| Tenant | A customer with its own identity provider and one gateway client. |
| Principal | A tenant's user, keyed by `(tenant, subject)` from the provider. Its id is the `sub` of every token Access issues. |
| Permission | A named capability such as `workspace.read`; it travels in the `roles` claim. |
| Grant | A permission or role a principal or group holds on a workspace and route, until revoked or expired. Grants alone decide access. |
| Group | A set of a tenant's principals; a grant to the group holds for every member. |
| Role | A named set of permissions and other roles that a grant can name. |
| Decision | The allow or deny answer the gateway receives, with a reason only the operator sees. |
| Administration | Twelve `curl` endpoints plus one that reads the change audit. |

The domain model is eight tables: `tenants`, `users`, `permissions`, `grants`, `groups`, `roles`, `role_permissions`, `role_roles` (§3).

## Find your way

| You want to | Read |
| --- | --- |
| Call an endpoint, with `curl` examples, or walk a tenant through its whole session | [API](api.md) |
| Know exactly how a login, a decision or an administration call behaves | [Specification](spec.md) |
| Set an environment variable or a secret file | [Configuration](configuration.md) |
| Deploy, monitor, rotate secrets, back up, or cut a tenant over | [Operations](operations.md) |
| Find why a login, a decision or a call failed | [Troubleshooting](troubleshooting.md) |
| Change the code: layout, tests, compatibility suite, capacity, security review, release | [Internals](internals.md) |
| Learn why the design is what it is | [Decisions](decisions.md) |

`§N` in code, tests and these pages means a section of the specification. A behavior change updates the specification in the same commit as the code; see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Run it locally

```bash
bun install
ACCESS_SECRET_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) bun run src/main.ts
bun run test          # units, contracts, boundaries
bun run test:compat   # the unchanged gateway against this service
```

Without `ACCESS_DATABASE_URL` the process runs embedded PostgreSQL (`pglite`) in `./.access/pglite` with the production migrations. The variable takes `postgres://…` or `pglite://<path>`; production must name a server. The root `bun run dev` uses one PostgreSQL 18 server with a database per service (§3.9). `bun run test:integration` runs the integration tests, on a server when `ACCESS_TEST_DATABASE_URL` is set.

## Release state

Version `1.0.3` of the platform. Milestones M0 to M9 are closed: the process starts, validates its environment, answers probes, drains, brokers logins, issues tokens, answers gateway decisions, and passes the unchanged reference gateway's suite. This release adds per-tenant administration credentials, denial reason codes, groups, administration batches and audit export. [Known limits](internals.md#known-limits) lists what it does not do.
