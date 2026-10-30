# Specification

The normative contract of Access: login brokering, identity mapping, tokens, decisions, the access context and the administration, with their invariants, limits and error codes. It is written for implementers and reviewers; change it first when behavior changes.

Access is a Bun service that brokers logins against each tenant's OpenID Connect (OIDC) provider, maps external identities to principals, answers gateway decision requests from a table of grants, and is administered through the twelve administrative endpoints plus one endpoint that reads the audit.

Access is a separate deployable, not a gateway feature. It sits between browsers, tenant identity providers and gateways. The gateway keeps its single provider, its single Access deployment and its whole configuration, and gains **zero** new features: a gateway deployment simply points at Access.

Request and response bodies are in [API](api.md), every environment variable is in [Configuration](configuration.md), the design is in [Internals](internals.md), and the code is in `src/`. A behavior change updates this document in the same commit as the code.

Status: 1.0.1. Runtime: Bun ≥ 1.4.3. Listener: HTTP on `ACCESS_HOST:ACCESS_PORT` (default `0.0.0.0:8081`).

## 1. Scope

### 1.1 What it does

| | |
| --- | --- |
| **Brokers the login** | It is an OIDC client of each tenant's provider *and* the OIDC provider of the gateway. The browser logs in at the tenant's provider; the gateway sees a provider it already knows how to talk to. |
| **Maps the identity** | The provider's `(tenant, subject)` pair maps to exactly one **principal row**. The row is the platform identity; the external identity is only the way in. |
| **Answers decisions** | It implements the decision contract the gateway already speaks, `POST /v1/decisions`, computed over a table of **grants**. |
| **Is administered with twelve endpoints** | Tenants, principals, grants, groups and roles are created, revoked and **listed** with twelve `curl` calls; a thirteenth reads the audit. No console, portal or wizard. |

### 1.2 What it does not do

- Proxy traffic. Only logins and decisions pass through Access, never an already authenticated request.
- Use a policy language of its own. The policy is the grants table and nothing else.
- Manage routes, upstreams or workspaces. The gateway owns those.

### 1.3 Relationship with the gateway

```text
   browser                     Access                    tenant IdP          Gateway
      │                         │                             │                  │
      │  GET /auth/login ──────▶│                             │                  │
      │                         │◀──── /oauth/authorize ──────│                  │
      │◀── 302 to Access ───────│                             │                  │
      │                         │───── 302 to the IdP ───────▶│                  │
      │◀── 302 to the IdP ──────│◀────────────────────────────│                  │
      │                         │◀── /oauth/tenant/callback ──│                  │
      │                         │  map (tenant, sub) → row    │                  │
      │                         │─── 302 to Gateway ───────────────────────────▶│
      │                         │                             │                  │
      │                         │◀── POST /oauth/token ──────────────────────────│
      │                         │    id_token, access_token   │                  │
      │                         │                             │                  │
      │                         │◀── POST /v1/decisions ─────────────────────────│
      │                         │    {"allow":true}           │                  │
```

The gateway sees **one** provider and **one** Access, and they are the same service. It cannot tell that Access brokers several identity providers, and it must not need to.

### 1.4 One gateway client per tenant

A gateway is configured with **one** client id and **one** redirect URI. The login's tenant is resolved from the authorization request's client id (§5.2), and `tenants.client_id` is unique (§3.1), so a client id belongs to exactly one tenant. Supported topology:

- **One gateway deployment per tenant**, each registered as that tenant's client.
- **One gateway deployment for several tenants** under one client id is not allowed by the schema: two tenants cannot hold the same `client_id`.

Access is multi-tenant; the gateway is not. That is the price of "the gateway gains zero new features", paid on the Access side, where tenancy belongs.

**Escape hatch (§5.2).** A tenant with `shared_client = true` lets its gateway log in principals of **other** tenants, named by the request or by the e-mail hint. The gateway still presents its own, unique client id; only the login's tenant differs. This deliberately weakens isolation (a hint the caller controls can move a login to another tenant) and is off by default.

## 2. Terms

| Term | Meaning |
| --- | --- |
| **tenant** | A customer of the platform. Owns one identity provider, one principal population and one set of grants. |
| **provider (of a tenant)** | The tenant's OIDC provider. Exactly one per tenant. |
| **principal** | The `users` row that carries a caller's platform identity. It is the `subject` of every token Access issues and of every decision request. |
| **permission** | A named capability, e.g. `workspace.read`. It is a platform *role*: it travels in the `roles` claim and is what a grant gives. |
| **grant** | A permission a principal holds on a workspace and route, until revoked or expired. |
| **group** | A set of a tenant's principals; a grant to a group holds for every member (§3.5). |
| **role (Access)** | A named set of a tenant's permissions and other roles; a grant may name one (§3.6). |
| **decision** | The answer of `POST /v1/decisions`: may this principal use this workspace on this route? |
| **access context** | The answer of `POST /v1/access-context`: which permissions does this principal hold for this workspace and route (§9)? |
| **gateway** | A gateway deployment: a client of Access and a consumer of its decisions. |
| **operator** | The person who runs Access and calls the twelve administrative endpoints. |

### 2.1 Invariants

None is configurable. Each is enforced in code and has a test.

1. **A caller is only authenticated against its tenant's provider.** The provider token's issuer, audience, nonce and algorithm are checked before the identity is read.
2. **An external identity is never mapped by e-mail.** The key is `(tenant, subject)`; an e-mail is mutable and is not an identity.
3. **A principal with no grant is refused.** Existing is not access.
4. **A decision that cannot be computed is denied.** An unreachable database produces a denial, never an allowance.
5. **The administrative endpoints are the whole administration surface.** There is no second way to change a tenant, principal or grant. Seven change something, five read a list and one reads the audit; nothing else writes.
6. **Every change is audited, durably.** The change and its audit row are written by **one statement**, so both commit or neither does: an unaudited change does not exist. The row names the operator, never the credential (§10.1). A log line is not the audit; the audit is a table.
7. **A secret is never returned, logged or sent through a browser.** Provider client secrets, gateway client secrets and tokens are write-only.
8. **A gateway never learns a reason.** A decision's reason is for the operator; neither the gateway nor Access forwards it to a caller.
9. **The gateway contract does not change.** Access answers the decision request the gateway already sends, with the body it already sends (§8).

## 3. Tables

The domain model is eight tables, and only these. Protocol state that is not a domain concept (the authorization codes) lives in the shared store (§5.5), not in the database.

Two infrastructure tables share the database but are not part of the model: the migration ledger `access_schema_migrations` (§3.8) and the administration audit `admin_audit` (§10.1). The audit holds no tenant, principal or grant: only what changed, when, and who changed it.

Schema: `src/platform/postgres/migrations/`.

### 3.1 `tenants`

One row per customer, with the registration of the tenant's provider and of its gateway.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `slug` | `text` | Stable tenant name, `[a-z0-9-]{2,63}`. Unique; the row's key. |
| `display_name` | `text` | Name shown to a human. |
| `enabled` | `boolean` | Default `true`. A disabled tenant denies every decision and refuses every login. |
| `is_default` | `boolean` | Default `false`. At most one tenant is the default (§5.2). |
| `auto_provision` | `boolean` | Default `false`. Whether an unknown external identity gets a principal row on its first login (§6.4). |
| `email_domain` | `text` | The tenant's domain, or `null`. Unique when set. A **hint**, never an authorization (§5.2, §6.3). |
| `idp_issuer` | `text` | The provider's issuer. A token whose `iss` does not match it exactly is refused. |
| `idp_client_id` | `text` | The client id of Access at the provider. |
| `idp_client_secret` | `bytea` | The client secret of Access at the provider, encrypted at rest (§4.3). |
| `idp_redirect_uri` | `text` | The Access callback URL registered at the provider. Must be the URL of §5.1. |
| `idp_scopes` | `text[]` | Scopes requested from the provider. Default `['openid','email','profile']`. |
| `idp_algorithms` | `text[]` | Algorithms a provider token may be signed with. Default `['RS256']`. |
| `client_id` | `text` | The client id of the tenant's **gateway** at Access. Unique across tenants. |
| `client_redirect_uris` | `text[]` | The URLs the tenant's gateway is registered with. The browser returns to one of them with the login code; an unlisted URL never receives a code (§5.2). Default `[]`: a tenant with no URL refuses every login. |
| `client_secret` | `bytea` | The tenant gateway's secret, encrypted at rest (§4.3). |
| `previous_client_secret` | `bytea` | The secret the current one replaced, encrypted at rest. `null` without a rotation. |
| `previous_client_secret_until` | `timestamptz` | When the previous secret stops being accepted. `null` without a rotation. |
| `shared_client` | `boolean` | Default `false`. Whether this tenant's gateway may log in principals of other tenants (§5.2). |
| `created_at`, `updated_at` | `timestamptz` | |

### 3.2 `users`

One row per principal: the platform identity.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key. The `sub` of every token Access issues and the `subject` of every decision request. |
| `tenant_id` | `uuid` | The principal's tenant. Foreign key to `tenants`. |
| `external_subject` | `text` | The provider's `sub`. |
| `email` | `text` | Last e-mail seen at the provider; `null` when the provider publishes none. A display value, never a key. |
| `display_name` | `text` | Last name seen at the provider. |
| `status` | `text` | `active` or `disabled`. Default `active`. A disabled principal is refused at login and denied at every decision. |
| `last_login_at` | `timestamptz` | Last successful login; `null` before the first. |
| `created_at`, `updated_at` | `timestamptz` | |

Unique: `(tenant_id, external_subject)`. `(id, tenant_id)` is also unique, so a grant can carry its tenant in a foreign key (§3.4).

### 3.3 `permissions`

A named capability: it travels in a token's `roles` claim and is what a grant gives.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `tenant_id` | `uuid` | The owning tenant, or `null` for the platform catalogue. Foreign key to `tenants`. |
| `key` | `text` | Permission name, `[a-z0-9][a-z0-9._-]{0,63}`. |
| `description` | `text` | `null` when there is none. |
| `enabled` | `boolean` | Default `true`. A disabled permission is never given by a grant. |

Unique: `(coalesce(tenant_id, '000…0'::uuid), key)`. The `coalesce` is needed because a PostgreSQL unique index treats `null`s as distinct; without it the catalogue could hold two rows with the same key.

A catalogue permission (`tenant_id is null`) may be granted in every tenant; a tenant's permission only inside that tenant.

**A key is a name inside a tenant.** Two tenants may each hold a permission with the same key, as separate rows. A grant never names another tenant's permission: the tenant's own row is created on demand (§10.6).

### 3.4 `grants`

The platform policy. A grant says: this principal (or this group) holds this permission on this workspace, on this route, until this date. A grant may hold a **role** instead of a permission (§3.6); the subject then holds the role's permissions.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `tenant_id` | `uuid` | The grant's tenant. Foreign key to `tenants`. |
| `user_id` | `uuid` | The principal, or `null` when the grant names a group. Foreign key to `(id, tenant_id)` of `users`: **a grant can never name a principal of another tenant**. |
| `group_id` | `uuid` | The group, or `null` when the grant names a principal. Foreign key to `(id, tenant_id)` of `groups`: **a grant can never name a group of another tenant**. |
| `permission_id` | `uuid` | The permission, or `null` when the grant names a role. Foreign key to `permissions`. |
| `role_id` | `uuid` | The role, or `null` when the grant names a permission. Foreign key to `(id, tenant_id)` of `roles`: **a grant can never name a role of another tenant**. |
| `workspace_id` | `text` | The workspace, or `null` for every workspace of the tenant. Stored as given: a workspace that is not a UUID matches no workspace-scoped grant. |
| `route_id` | `text` | The route, or `null` for every route. |
| `expires_at` | `timestamptz` | `null` when the grant does not expire. |
| `revoked_at` | `timestamptz` | `null` while the grant is alive. A revoked grant is kept, not deleted. |
| `granted_by` | `text` | Who granted it, for the audit log. `null` when unknown. |
| `created_at` | `timestamptz` | |

Two schema checks, so neither is an application rule that can be forgotten:

- Exactly one subject, a principal or a group: `(user_id is null) <> (group_id is null)`.
- Exactly one kind, a permission or a role: `(permission_id is not null)::int + (role_id is not null)::int = 1`.

Unique among live grants: `(tenant_id, user_id, coalesce(permission_id, zero), coalesce(role_id, zero), coalesce(workspace_id,''), coalesce(route_id,''))` for grants that name a principal, and the same tuple on `group_id` for grants that name a group. The `coalesce` has the same purpose as in §3.3. A permission grant and a role grant are two different grants and two different rows.

### 3.5 `groups`

A set of principals of one tenant. A grant that names a group holds for every member.

An Access group is **not** the provider's `groups` scope (§7.4): that scope asks the provider for the caller's groups, while an Access group is a set of the tenant's principals that policy is written on.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `tenant_id` | `uuid` | The group's tenant. Foreign key to `tenants`. |
| `key` | `text` | Group name, `[a-z0-9][a-z0-9._-]{0,63}`. |
| `display_name` | `text` | `null` when there is none. |
| `members` | `uuid[]` | Member principal ids, each a principal of the group's tenant when written (checked by a trigger, below). The administration speaks in external subjects (§10.9); the adapter translates them. |
| `created_at`, `updated_at` | `timestamptz` | |

Unique: `(tenant_id, key)`. `(id, tenant_id)` is also unique, so a grant can carry its group's tenant in a foreign key (§3.4).

The administration call **replaces** the membership (§10.9): the listed principals are the members, and anyone not listed is removed.

The **database** checks membership, not only the application. An id array has no foreign key, so a constraint trigger checks every member when the group is written and refuses one that is not a principal of the group's tenant. The trigger is deferred to the end of the transaction, so a principal created in the same transaction is seen. Its refusal is the same `404` the administration returns when it finds the member before the write (§10.9): a backstop, not a replacement.

Membership has a **GIN index**. A decision asks "which groups hold this principal", answered by the containment `groups.members @> array[principal]`. Without the index, every decision that reads a group grant walks all the tenant's groups and their member lists (§8.5).

### 3.6 `roles`

A named set of a tenant's permissions. A grant may name a role instead of a permission (§3.4); the subject then holds the role's permissions.

A role may name other roles, transitively: a named role's permissions are the naming role's. A role that names itself, directly or through others, would make a decision never answer, so the schema refuses the cycle and the administration refuses it before the write (§10.11).

Roles are three tables: the role, the permissions it names and the roles it names. The decision reads them in one statement, expanding the nesting recursively within that query.

#### 3.6.1 `roles`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `tenant_id` | `uuid` | The role's tenant. Foreign key to `tenants`. |
| `key` | `text` | Role name, `[a-z0-9][a-z0-9._-]{0,63}`. |
| `display_name` | `text` | `null` when there is none. |
| `description` | `text` | What the role is for. `null` when there is none. |
| `created_at`, `updated_at` | `timestamptz` | |

Unique: `(tenant_id, key)`. `(id, tenant_id)` is also unique, so a grant can carry its role's tenant in a foreign key (§3.4).

#### 3.6.2 `role_permissions`

| Column | Type | Rule |
| --- | --- | --- |
| `tenant_id` | `uuid` | The membership's tenant. Foreign key to `tenants`. |
| `role_id` | `uuid` | The role that holds the permission. Foreign key to `(id, tenant_id)` of `roles`. |
| `permission_id` | `uuid` | The permission the role holds. Foreign key to `permissions`. |

Primary key: `(role_id, permission_id)`.

#### 3.6.3 `role_roles`

| Column | Type | Rule |
| --- | --- | --- |
| `tenant_id` | `uuid` | The membership's tenant. Foreign key to `tenants`. |
| `role_id` | `uuid` | The naming role. Foreign key to `(id, tenant_id)` of `roles`. |
| `child_role_id` | `uuid` | The named role; its permissions belong to the naming role. Foreign key to `(id, tenant_id)` of `roles`. |

Primary key: `(role_id, child_role_id)`. The schema check `role_id <> child_role_id` stops a role naming itself, and a constraint trigger, deferred to the end of the transaction, refuses longer cycles. The database refusal is the same `409` the administration returns when it finds the cycle before the write (§10.11).

The administration call **replaces** the memberships (§10.11): the listed permissions and roles are the role's memberships, and anything not listed is removed.

### 3.7 Diagram

```text
  tenants ────< users ────< grants >──── permissions
     │              │          (tenant_id may be null)
     │              │          (a grant holds a permission or a role)
     │              │
     │              ├──< groups (the principals of the group)
     │              │
     │              └──< roles >──── permissions
     │                    (the roles a role names)
     │
     └── the registration of the provider and of the gateway
```

### 3.8 Migrations

The schema is plain SQL files applied in name order by one runner that takes an advisory lock, so two replicas starting together never apply a migration twice. A failed migration stops the process: the service never starts against a schema it does not understand.

No table exists "for later": a feature that needs one is deferred until a customer pays for it (§14).

`access_schema_migrations` records the names of applied migrations and nothing else. A database holding a migration this version does not know is a schema the service does not understand, and the process refuses to start.

The runner reads `src/platform/postgres/migrations/` and, when that directory is absent, `migrations/` next to the executable: a compiled binary carries no directory, so the release ships the schema beside it. A service that finds no schema refuses to start and names the directory it looked in.

### 3.9 Development database

`ACCESS_DATABASE_URL` selects the PostgreSQL database:

| Value | Database |
| --- | --- |
| `postgres://…` or `postgresql://…` | A PostgreSQL server. |
| `pglite://<path>` | The process's embedded PostgreSQL, in `<path>`. |
| Unset, in a development environment | The process's embedded PostgreSQL, in `./.access/pglite`. |

The embedded PostgreSQL is `pglite`: PostgreSQL compiled to WebAssembly, running inside the Access process. It is the same PostgreSQL as a deployment's, so development applies the production migrations with nothing to translate.

Local development (`bun run dev`) uses the machine's PostgreSQL **server**, with one database per service. The embedded database is the fallback for a service run alone.

The service does not read the server version; a deployment's PostgreSQL version is the operator's choice. The versions the repository is tested against are in [Internals](internals.md#tests).

A **production** environment must name a PostgreSQL server, because the embedded database lives in one process and a deployment's replicas share their tables. Production naming the embedded database is refused at start.

### 3.10 Tenant isolation

The application isolates tenants: the keys of the eight tables carry the tenant, a grant's foreign key refuses another tenant's principal, and every statement reads a tenant by its id.

The database is the **backstop**. The eight tables have PostgreSQL row level security, and the scope of a statement is written in two settings, local to the transaction:

- `access.scope` names the kind of the scope and `access.tenant_id` names the tenant of it.
- A statement in the scope of a **tenant** (`access.scope` is `tenant`) sees that tenant's rows and nothing else.
- A statement in the scope of the **platform** (`access.scope` is `platform`) sees the whole platform. The scope of the platform is the scope of the registry of the tenants and of the operations of the operator of the platform; it is asked for by name.
- A statement with **no scope** sees **nothing**. The scope of a statement is never the default: a statement that forgot its scope reads no row of a tenant, and the database refuses to let it write one.

The scope of a statement is the scope of the credential that caused it: a credential of a tenant may only act for that tenant, and the statements it causes are confined to that tenant by the database itself. A pooled connection never carries another request's scope, because the settings are local to the transaction; PostgreSQL reverts them when the transaction ends and leaves their placeholder on the session, and the placeholder is the absence of a scope.

A statement that forgets the tenant in its text is therefore refused by PostgreSQL itself, not only by code review.

Policies only bind a role that is **subject** to them; a superuser or a role with `BYPASSRLS` is not. A **production** deployment therefore refuses to start with such a role, since isolation would be a promise and not a rule. The deployment's role owns the platform tables and is not a superuser.

## 4. Environment

The environment is read once at start and validated as a whole: a value that cannot be understood stops the service. The variable list, defaults and formats are in [Configuration](configuration.md); log-level rules are in [platform operations](../platform/operations.md).

### 4.1 Secrets

Tokens are compared in constant time, read from the environment and never logged.

**A bearer token is at least 16 bytes.** `ACCESS_ADMIN_TOKEN`, `ACCESS_PREVIOUS_ADMIN_TOKEN`, `ACCESS_DECISION_TOKEN`, `ACCESS_PREVIOUS_DECISION_TOKEN` and `ACCESS_METRICS_TOKEN` are measured in the bytes they are compared in, since length is the first thing an attacker tries. Production refuses to start when a token is shorter (§4.4). Signing and encryption secrets are 32 bytes (§4.4).

**Example values are not secrets.** Production refuses to start when a secret is a value from `.env.example` or one repeated character (`000…0`, `111…1`, `aaaa…`), whatever its length. The example is published, so any deployment that copied it is exposed. The rule covers every credential of the deployment: the tokens, the two secrets, the key of the signing and the credentials of the access context (§9.2).

**A credential of the access context is a credential of the platform.** In production each credential of `ACCESS_CONTEXT_TOKENS` is at least 32 bytes, counted as decoded, and none of them is a published value. A credential whose scope is `null` acts for every tenant of the platform: the deployment says so out loud with `ACCESS_CONTEXT_ALLOW_PLATFORM_TOKEN=true`, and the service refuses to start without it.

### 4.2 Signing key

Issued tokens are signed with `RS256` and published at `/oauth/jwks`. The key is a deployment secret from the environment or a secret manager. It is never generated at start (a key that changes on restart invalidates every live token) and never written to the container's disk.

To rotate, publish a second key in the JWKS and change `ACCESS_SIGNING_KEY`. The old key stays published until the last token it signed has expired. The procedure is in [Operations](operations.md#rotating-secrets).

### 4.3 Secrets at rest

A tenant's two client secrets (provider and gateway) are encrypted with AES-256-GCM under `ACCESS_SECRET_ENCRYPTION_KEY` before they are written. Administrative endpoints accept them in clear over TLS and never return them; answers carry `null` in their place.

Changing `ACCESS_SECRET_ENCRYPTION_KEY` makes every stored secret unreadable. The operator re-encrypts both columns in one transaction with `scripts/cli/rotate-secrets.ts`.

The encryption key is derived from the configured secret with HKDF-SHA256, so the secret may be a passphrase, a hex string or a base64 string; the derived key is always 32 bytes.

Stored ciphertext carries its format version, so a format change is a new version, not a column migration:

| Bytes | Content |
| --- | --- |
| `1` | Format version (currently `1`). |
| `12` | Encryption nonce. |
| The rest | Ciphertext body and tag. |

Without `ACCESS_SECRET_ENCRYPTION_KEY`, the service never stores client secrets in clear: it refuses to write a tenant and says so.

#### 4.3.1 Rotating a secret

A secret that a client presents rotates with no window in which client and service disagree.

**A tenant's gateway secret.** The administration call that changes it keeps the replaced secret for **24 hours**, and both are accepted during that window. Update the tenant first and the gateway second, within the window: a gateway that switches first presents a secret Access does not know yet and is refused with `401 invalid_client`. The window is the rotation, not a second credential.

Presenting the secret already in use is **not** a rotation and does not close an in-flight rotation window. An unrelated tenant change does not shorten the window.

**The decision and administration tokens** come from the environment, which holds the current token and, during a rotation, the one it replaced:

| Current | Previous | Rule for the previous value |
| --- | --- | --- |
| `ACCESS_DECISION_TOKEN` | `ACCESS_PREVIOUS_DECISION_TOKEN` | Accepted until the deployment removes it. Refused without the token it replaced: removing the shared secret removes it entirely (§8.8). |
| `ACCESS_ADMIN_TOKEN` | `ACCESS_PREVIOUS_ADMIN_TOKEN` | Accepted until the deployment removes it. |

A rotation is rolling: put the previous value in every replica's environment, replace the current value, then remove the previous one. Rotating the decision token changes every gateway's environment at once; the window is what makes it rolling. Both values are compared in constant time.

### 4.4 Production requirements

With `ACCESS_ENVIRONMENT=production`, the service refuses to start when a required variable is missing. All environment problems are reported at once, naming the variables, so a deployment never fixes one, restarts and only then learns about the next.

| Variable | Why it is required |
| --- | --- |
| `ACCESS_DATABASE_URL` | Holds the eight tables. Production must name a server (§3.9). |
| `ACCESS_ISSUER` | The `iss` of every issued token and the issuer the gateway is configured with. |
| `ACCESS_REDIS_URL` | Replicas must share authorization codes, unless `ACCESS_ALLOW_MEMORY_STATE=true` marks a single-node deployment. |
| `ACCESS_ADMIN_TOKEN` | The bearer token of the twelve administrative endpoints, unless the deployment names its credentials in `ACCESS_ADMIN_TOKENS` (§4.6). |
| `ACCESS_STATE_SECRET` | Signs and encrypts the login state. At least 32 bytes. |
| `ACCESS_SECRET_ENCRYPTION_KEY` | Encrypts client secrets at rest. At least 32 bytes. |
| `ACCESS_SIGNING_KEY` | The private key that signs issued tokens, in PEM. |
| `ACCESS_SIGNING_KID` | The key's identifier in the JWKS. |

Production also refuses to start when:

- a secret is shorter than 32 bytes, counted as decoded (64 hex characters, 44 base64 characters);
- a bearer token is shorter than **16 bytes**, or a secret is an example or one-character value (§4.1);
- a credential of the access context is shorter than **32 bytes**, is a published value, or acts for every tenant without `ACCESS_CONTEXT_ALLOW_PLATFORM_TOKEN` (§4.1, §9.2);
- the database role is a superuser or has `BYPASSRLS`, since the database does not enforce tenant isolation for it (§3.10). The message names the role and the fix.

The log level is the only value that never stops the service: a typo in it must not keep a deployment down.

**Optional:** `ACCESS_DECISION_TOKEN`, which is deprecated and unscoped; keep it only while a gateway (such as the reference gateway) still sends it (§8.8). `ACCESS_CONTEXT_TOKENS`, needed only by a deployment that serves a data backend (§9).

### 4.5 Secrets in files

Any secret may be given in a **file** named by `ACCESS_<NAME>_FILE` instead of its variable `ACCESS_<NAME>`. Which variables accept a file is listed in [Configuration](configuration.md#secrets-in-files).

- The file's content is the value, with the trailing newline removed.
- An unreadable file is a configuration error; the service does not start without the secret.
- Setting both a variable and its file is refused at start rather than guessing which was meant.

Files are how containers receive secrets: a secret manager writes them, whereas a private key in an environment variable gets mangled by a shell.

### 4.6 Administration credentials

The administration is guarded by bearer tokens. `ACCESS_ADMIN_TOKENS` maps each token to its scope; the JSON format is in [Configuration](configuration.md#administration-credentials).

- A **platform** credential may act for every tenant.
- A **tenant** credential names the slug of the one tenant it may act for, and its operator's **name**. The audit records the name, which an operator can answer for; the credential itself is never written.

A credential is at least 16 characters, and a malformed value stops the service: a credential that is not understood would not be scoped.

`ACCESS_ADMIN_TOKEN` is the platform credential of a deployment that names none in `ACCESS_ADMIN_TOKENS`. It keeps working, and the audit operator is the token's fingerprint. The two schemes combine: a deployment may name tenant credentials and keep the platform token.

## 5. Login

### 5.1 Endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /oauth/authorize` | Authorization endpoint. The gateway sends the browser here. |
| `GET /oauth/tenant/callback` | Callback registered at each tenant's provider. The provider sends the browser here. |
| `POST /oauth/token` | Token endpoint, where the gateway exchanges the code. The client authenticates with `client_secret_basic`; a client without a secret is refused. |
| `GET /oauth/jwks` | The service's public keys. |
| `GET /oauth/userinfo` | Claims of a bearer token's principal. |
| `GET /.well-known/openid-configuration` | Discovery document. |
| `POST /v1/decisions` | The gateway's decision contract (§8). |
| `GET /v1/access-context` | Access context discovery (§9.1). |
| `POST /v1/access-context` | A principal's access context (§9.2). |
| `GET /healthz` | `200 {"status":"ok",…}`. Always available. |
| `GET /readyz` | `200` when the database answers and migrations are applied, `503` otherwise. |
| `GET /metrics` | Prometheus text. `404` when `ACCESS_METRICS_TOKEN` is unset, `401` when the bearer token does not match. |
| `GET /openapi.json` | API description: the paths served and the shape of their answers. |
| `POST /v1/admin/tenants` | Administration (§10.2). |
| `GET /v1/admin/tenants` | Administration (§10.3). |
| `POST /v1/admin/users` | Administration (§10.4). |
| `GET /v1/admin/users` | Principals, paginated (§10.5). |
| `PUT /v1/admin/grants` | Administration (§10.6). |
| `DELETE /v1/admin/grants/{id}` | Administration (§10.7). |
| `GET /v1/admin/grants` | Grants, paginated (§10.8). |
| `POST /v1/admin/groups` | A group and its membership (§10.9). |
| `GET /v1/admin/groups` | Groups, paginated (§10.10). |
| `PUT /v1/admin/roles` | A role and its memberships (§10.11). |
| `GET /v1/admin/roles` | Roles, paginated (§10.12). |
| `DELETE /v1/admin/roles/{id}` | Removes a role (§10.13). |
| `GET /v1/admin/audit` | The audit of changes, paginated (§10.15). Read-only. |

Every other path is `404 not_found`.

### 5.2 Resolving the tenant

The login's tenant is resolved in this order; the first match wins.

1. **The request's client.** The authorization request's `client_id` names the tenant that owns it. This is the normal case and the only one a gateway can reach (§1.4).
2. **The `tenant` parameter.** When the client's tenant has `shared_client = true`, the request may name another tenant in `tenant`, and that tenant is used. The parameter is ignored for a client that is not shared, so it cannot move a login to another tenant.
3. **The hint.** When the request carries a `login_hint` that is an e-mail, its domain names the tenant with that `email_domain`. Only usable when the client's tenant is shared.
4. **The default tenant.** When the client's tenant is shared and nothing else matched, the tenant with `is_default = true` is used.

A client that names no tenant → `400 invalid_request`. A disabled tenant → `403 tenant_disabled`.

With a shared client, the operator accepts that a hint the caller controls may choose a login's tenant. It is off by default, which is why a shared gateway is not the recommended topology. Only the platform operator may enable it: it is one of the tenant flags that belong to the platform (§10.1).

**The request's redirect URI.** The caller controls the URL the browser returns to, so it is checked against the gateway's registered URLs (`client_redirect_uris`, §3.1) before the tenant is resolved:

- A `redirect_uri` that is not registered → `400 invalid_request`, and the browser is **not** sent there. The refusal is a page served by Access, not a redirect: an unregistered URL never receives a code.
- A tenant with no registered URL refuses every login, until the deployment registers its gateway's URL.

The check is on the **client**, not the login's tenant. With a shared client the login's tenant may differ, but the return URL always belongs to the gateway that presented the client id.

### 5.3 Login state

Login state is carried by two cookies and by the redirect parameters.

**The state cookie** (`access_login_state`) holds, encrypted with `ACCESS_STATE_SECRET` (AES-256-GCM, authenticated): the tenant, the client id, the redirect URI, the gateway's `state`, the `nonce`, the PKCE verifier for the provider, and the login start time. It is `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/oauth/tenant/callback`, and lives ten minutes.

The cookie is **single use**: it is deleted as soon as the callback is processed, whatever the outcome.

**Provider state.** Access sends the provider a fresh random `state` and a fresh `nonce`, both bound to the state cookie and checked when the browser returns.

**PKCE.** Access sends `S256` to the provider and keeps the verifier in the state cookie. A provider without PKCE support is refused when the tenant is registered.

### 5.4 Flow

1. The gateway sends the browser to `GET /oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=openid profile email groups&state=…&nonce=…&code_challenge=…&code_challenge_method=S256`.
2. Access resolves the tenant (§5.2), sets the state cookie and redirects the browser to the provider's authorization endpoint with the `state`, `nonce`, `code_challenge` and the tenant's `redirect_uri`.
3. The provider authenticates the caller and sends the browser to `GET /oauth/tenant/callback?code=…&state=…`.
4. Access reads the state cookie, checks the `state`, deletes the cookie, exchanges the code at the provider with the PKCE verifier, and validates the id token (§6.1).
5. It maps the external identity to a principal (§6.2, §6.4).
6. It issues an authorization code for the gateway and redirects the browser to the request's `redirect_uri` with the code and the gateway's `state`.
7. The gateway exchanges the code at `POST /oauth/token` with its verifier, client id and secret.
8. Access answers with an `id_token` and an `access_token` (§7).

### 5.5 Authorization code

An opaque random 32-byte string, stored in the shared store under its hash, together with the client id, the redirect URI, the PKCE challenge, the principal and its creation time.

- It lives **60 seconds**.
- It is **single use**: the first exchange deletes it; a second exchange is `invalid_grant`.
- It is bound to the client id, the redirect URI and the PKCE challenge. Another redirect URI, another client or a verifier that does not match → `invalid_grant`.
- It is bound to the **client that began the login**, not the login's tenant. With a shared client the tenant may differ (§5.2), and the gateway exchanges the code with its own registered client id, which is also the token audience (§7.1).
- It never carries the identity in clear.

The shared store is Redis. A single-replica deployment may use process memory with `ACCESS_ALLOW_MEMORY_STATE=true`. An unreachable store fails the login; it never falls back to "no state".

### 5.6 Failed logins

| Case | Answer |
| --- | --- |
| The provider refuses the login | The provider's own answer is passed to the browser unchanged. |
| The provider is unreachable | `502 upstream_unavailable`, with a page saying the provider is not reachable and naming the tenant. Never the provider's raw error. |
| The provider token is invalid | `403 identity_rejected`, with a page saying the identity was refused. The reason is in the service log. |
| Unknown identity, tenant does not auto-provision | `403 identity_unknown`, with a page saying the identity is not known to the platform. The log carries the refused `(tenant, subject)`. |
| The principal is disabled | `403 principal_disabled`. |
| The state does not match, or the cookie is missing | `400 login_state_invalid`. The login is refused; a new one must start. |
| The state cookie is not readable | `400 login_state_invalid`. A cookie that is not a valid escape is not a cookie. |

**Response headers.** Every answer carries `x-content-type-options: nosniff`, `x-frame-options: DENY` and `referrer-policy: no-referrer`. A refusal page carries `content-security-policy: default-src 'none'`. A deployment served over https carries `strict-transport-security`. The token endpoint's answer carries `cache-control: no-store` and `pragma: no-cache`, so no intermediary or browser stores a token (RFC 6749, section 5.1).

## 6. Identity mapping

### 6.1 Validating the provider token

The provider token is validated before any row is read:

| Check | Rule |
| --- | --- |
| Issuer | `iss` is **exactly** the tenant's `idp_issuer`. No case-insensitive or trailing-slash tolerant comparison. |
| Audience | `aud` contains the tenant's `idp_client_id`, or `azp` is it. |
| Nonce | `nonce` is the nonce of the login in flight. |
| Algorithm | In the tenant's `idp_algorithms`. `none` and any unlisted algorithm are refused. |
| Signature | Verified with the provider's JWKS, fetched via its discovery document and cached ten minutes. A token naming a key the cache lacks signals a **rotation**: the keys are re-read once and the token verified against them (§6.6). |
| Clock | `exp` and `iat` checked with a tolerance of `ACCESS_CLOCK_SKEW_SECONDS`. |
| Subject | `sub` is present and not empty. |

The provider's discovery document is fetched from `{idp_issuer}/.well-known/openid-configuration`. A provider whose document names an issuer other than the tenant's `idp_issuer` is refused.

**Provider addresses.** Access calls only the registered issuer's address, for the discovery document and the keys. Before the call, the host is resolved and every address it resolves to must be public. Production refuses private addresses; development accepts them (the test fixtures are on loopback).

**The call goes to the checked address.** The guard pins the resolved address and connects to it, sending the host name in the `Host` header and using it for certificate verification on secure calls. The host is never resolved twice, so a host that returns a public address to the check and a private one to the connection gains nothing. A provider answer is read up to one MiB; a provider that answers more is treated as unreachable.

### 6.2 Mapping key

The mapping key is **`(tenant, subject)`**:

```text
users.tenant_id        = the tenant of the login
users.external_subject = the `sub` of the provider
```

Never the e-mail: an e-mail changes, is reused and is not unique, so a principal bound to one is a guess. Linking two external identities to one principal is a deferred feature (§14).

### 6.3 E-mail is a display value

The token's e-mail is stored on the principal row and published in the tokens Access issues. It is **never** used to find a principal and **never** used to authorize anything. An e-mail domain selects a tenant only for a shared client (§5.2), and only as a hint.

### 6.4 Unknown identity

When the mapping finds no row:

- `auto_provision = true` → the row is created with status `active` **and no grant at all**. The caller authenticates and reaches nothing: the login succeeds and §8 denies the first request.
- `auto_provision = false` → the login is refused with `403 identity_unknown` (§5.6).

The default is `false`: an identity nobody registered does not get an account just because it logged in somewhere.

### 6.5 Principal of a decision

A decision request's `subject` is the principal row's id. The id is unique across the platform, so the principal's tenant is known without the request carrying it. A subject that matches no row is a denial (`the principal does not exist`).

### 6.6 Provider key rotation

A provider rotates by publishing a new key in its JWKS and signing with it; the old key stays published until the last token it signed has expired.

Provider keys are cached ten minutes (§6.1), so a token naming an uncached key is **not** a bad token but a sign of rotation. Access re-reads the keys once and verifies the token against them. A token signed with a key the provider does not publish is still refused.

Keys are re-read at most once every thirty seconds per tenant, so a provider is not hammered with calls when callers send tokens it did not sign.

The provider client is also kept ten minutes. A change to a tenant's registration (its secret, its issuer) drops that tenant's client, and the next login builds a new one.

## 7. Tokens

Access is the gateway's OIDC provider; it issues ordinary OIDC tokens.

### 7.1 ID token claims

| Claim | Value |
| --- | --- |
| `iss` | The Access issuer. |
| `sub` | The principal's id. |
| `aud` | The client id of the tenant's gateway, i.e. the client that began the login (§5.2, §5.5). |
| `exp`, `iat` | Five minutes of life. |
| `nonce` | The login's nonce, when there was one. |
| `email` | The principal's e-mail, when known. |
| `name` | The principal's display name, when known. |
| `roles` | Permission keys of the principal's active grants (§7.3). |
| `tid` | The tenant's slug. |
| `email_verified` | Always `false`: Access does not verify a provider's e-mail. |

The gateway reads only `sub`, `email` and `roles`; those claims are the whole contract with the gateway.

`sub` is a principal id, a **UUID** (§8.1). The release `1.0.0` gateway writes the identity's subject **as is** and refuses with `500` a subject that cannot be written into a header: one with a control character, an empty one, or one longer than 512 characters. A UUID has no control character and is thirty-six characters long, so the subject Access issues is always written and never rewritten.

### 7.2 Access token

A JWT signed with `RS256`, with the issuer, the audience (the client id), the subject, the scope and a five-minute life. The gateway accepts it in its `jwt` and `any` modes, because it validates bearer tokens against the same provider it discovers for the browser.

| Claim | Value |
| --- | --- |
| `iss` | The Access issuer. |
| `sub` | The principal's id. |
| `aud` | The client id of the tenant's gateway. |
| `exp`, `iat` | Five minutes of life. |
| `scope` | The login's scopes. |
| `roles` | Permission keys of the principal's active grants (§7.3). |
| `tid` | The tenant's slug. |

The token carries **no nonce** and **no e-mail**. A bearer token with a nonce is an id token, and the gateway refuses it (`GATEWAY_OIDC_REJECT_NONCE_TOKEN`): id tokens travel through the browser and end up in history, logs and referrers. The e-mail belongs to the id token; a bearer-token caller is an API client, identified by its subject and roles.

The reference gateway requires an **expiry** on a bearer token and bounds a token's lifetime from its issue time (`GATEWAY_OIDC_MAX_TOKEN_AGE_MS`). The access token carries `exp` and `iat` and lives five minutes, so the gateway accepts it whatever bound the deployment sets.

There is **no refresh token**. The gateway does not use one, and a refresh token is a credential that must be revoked, stored and rotated. A client that needs one asks for it: it is a deferred feature (§14).

### 7.3 `roles` claim

The permission keys of the principal's grants that are alive when the token is issued: not revoked, not expired, with an enabled permission. Grants of the principal's **groups** count: a group's permission is a permission of every member.

It is a **snapshot**, published for the deployment's upstreams in the `x-gateway-roles` header. It is **not** the policy: the §8 decision is computed over the grants table, never over the claim (§8.4).

The list is sorted and capped at 64 entries. A principal with more permissions gets the first 64, and the number left out is logged.

### 7.4 Scopes

Access accepts the scopes `openid`, `profile`, `email` and `groups`. An unknown scope is ignored, not refused: the gateway asks for `groups` by default, and refusing unknown scopes would break gateways that never changed.

### 7.5 Discovery document

`GET /.well-known/openid-configuration` is read once by the gateway and cached for ten minutes. It carries at least:

| Field | Value |
| --- | --- |
| `issuer` | Exactly `ACCESS_ISSUER`. The gateway refuses a document whose issuer is not the one it was configured with. |
| `authorization_endpoint` | `{ACCESS_PUBLIC_URL}/oauth/authorize` |
| `token_endpoint` | `{ACCESS_PUBLIC_URL}/oauth/token` |
| `jwks_uri` | `{ACCESS_PUBLIC_URL}/oauth/jwks` |
| `userinfo_endpoint` | `{ACCESS_PUBLIC_URL}/oauth/userinfo` |
| `response_types_supported` | `["code"]` |
| `subject_types_supported` | `["public"]` |
| `id_token_signing_alg_values_supported` | `["RS256"]` |
| `grant_types_supported` | `["authorization_code"]` |
| `scopes_supported` | `["openid","profile","email","groups"]` |
| `code_challenge_methods_supported` | `["S256"]` |
| `token_endpoint_auth_methods_supported` | `["client_secret_basic"]` |

The `userinfo_endpoint` returns the bearer token principal's `sub`, `email`, `name` and `roles`. A token that is expired, signed with another key or issued for another audience → `401`.

## 8. Decisions

This is the contract the gateway already speaks, defined in the [gateway spec: workspace access](../gateway/spec.md#6-workspace-access). It is repeated here because Access must implement it exactly.

### 8.1 Request

```http
POST {ACCESS_ISSUER}/v1/decisions
Authorization: Bearer {ACCESS_DECISION_TOKEN}
Content-Type: application/json

{"subject":"…","workspaceId":"…","routeId":"…","roles":["…"]}
```

These four fields are what the gateway sends. Access requires no field the gateway does not send and refuses no field it does not know.

- Missing or wrong credential → `401 unauthorized`. The two credential schemes are in §8.8.
- Body that is not JSON, or a `subject` that is not a string → `400 bad_request`.
- A `subject` that is not a principal id → `400 bad_request`. A principal id is a UUID; a value that is not one names no row, so the request is refused without asking the database. The database is never asked to cast a value it cannot cast, so a malformed request cannot become a storage failure.
- Database unreachable, or a query longer than `ACCESS_DECISION_TIMEOUT_MS` → `503 service_unavailable`.

Each of these is a **denial** for the gateway, which fails closed on anything but a successful answer.

### 8.2 Answer

```text
200 {"allow": true,  "reason": "allowed"}
200 {"allow": false, "reason": "the principal does not have the role of the workspace", "reasonCode": "missing_role"}
```

A decision, allow or deny, is `200`. The reason is free text and is **never** shown to the caller: the gateway hides it. It is for the operator and is in the service log.

A **denial** carries its reason **code**; an allowance carries none. The codes are the gateway's vocabulary ([gateway spec: access protocol](../gateway/spec.md#61-access-protocol)): `missing_role` means the caller lacks the role the policy requires, and `access_denied` is a denial for a reason the service does not name.

The gateway counts the code when one is sent and the reason text otherwise ([gateway spec: denial reasons in metrics](../gateway/spec.md#65-denial-reasons-in-metrics)). Code and text always agree (§8.7), so rewording a reason does not change the gateway's metric.

### 8.3 Rule

A principal may use a workspace on a route when at least one grant satisfies **all** of:

| Condition | Rule |
| --- | --- |
| Principal | `users.id = subject` and `users.status = 'active'`. |
| Tenant | `users.tenant_id` names a tenant with `enabled = true`. |
| Grant | `grants.revoked_at is null`, and the grant names the principal (`grants.user_id = users.id`) or one of its groups (`grants.group_id` names a group whose `members` hold `users.id`). |
| Expiry | `grants.expires_at is null` or `grants.expires_at > now()`. |
| Permission | The grant's permission is `enabled`. |
| Workspace | `grants.workspace_id is null` (every workspace of the tenant) or `grants.workspace_id = workspaceId`. |
| Route | `grants.route_id is null` (every route) or `grants.route_id = routeId`. |

A grant on one workspace or route does not grant another. A grant with neither workspace nor route covers the whole tenant.

> [!IMPORTANT]
> The rule is coarse on purpose, and an operator has to know it. A grant that names a workspace and **no route** holds on **every route** of that workspace, and the permission of the grant is not compared with the permission a route asks for: any live grant of the workspace authorizes the route. A deployment whose routes ask for different permissions therefore names the route in every grant that is not meant to cover all of them, and the console shows the routes a grant covers.

A **group** grant holds for every member and nobody else. A principal removed from the group loses access at the next decision: membership is read from the table, never from a token.

A **role** grant (§3.6) gives the subject the role's permissions and those of the roles it names. The same statement expands roles transitively: a role that names a role that names a permission holds that permission.

The query is a single statement over the policy tables, using the indexes of §8.5.

**The server enforces the statement deadline.** The statement runs under the pool connection's `statement_timeout`, the service's tightest deadline (`ACCESS_DECISION_TIMEOUT_MS`, two seconds by default). PostgreSQL stops a slow statement, rolls back the transaction and the connection returns to the pool at once. A deadline held only in process memory would let a statement occupy a pool connection for the pool's whole timeout window.

The process deadline is the backstop: a quarter of a second longer, answering `503` (the gateway fails closed) when the server did not answer at all.

### 8.4 Request roles

The request's `roles` are **context, not policy**. The gateway copies them from the caller's token, which is a snapshot (§7.3): it misses grants given after issue and still lists revoked ones. A policy that read them would honor a revoked grant until the next login.

The §8.3 rule reads the table only. Request roles are recorded in the decision log and used for one thing: a denial's **reason** names the roles the principal holds, so the operator sees what it had. Reasons are worded so the gateway's metric separates `missing_role` from `access_denied` (§8.7).

### 8.5 Indexes

| Index | Serves |
| --- | --- |
| `users (id)` | Primary key: the request's subject. |
| `grants (user_id) where revoked_at is null` | The principal's grants. |
| `grants (group_id) where revoked_at is null` | Grants of the principal's groups. |
| `groups` (GIN on `members`) | Groups holding the principal: the containment `members @> array[principal]`. |
| `permissions (id)` | Primary key. |

The §8.3 query stops at the first grant that satisfies it.

### 8.6 Revocation latency

Access does not cache decisions: the table is the truth and the query is cheap. Revocation latency is therefore the gateway's decision cache lifetime, `GATEWAY_ACCESS_CACHE_TTL_MS` (5 s by default).

A route with `accessCacheTtlMs: 0` asks Access on every request, so revocation is immediate there. Access cannot do better: the gateway does not ask again, and changing that would be a gateway change.

### 8.7 Reasons

| Situation | Reason | Code |
| --- | --- | --- |
| Allowed | `allowed` | — |
| The subject is not a principal | `the principal does not exist` | `access_denied` |
| The principal is disabled | `the principal is disabled` | `access_denied` |
| The tenant is disabled | `the tenant is disabled` | `access_denied` |
| No grant satisfies the rule | `the principal does not have the role of the workspace` | `missing_role` |
| A grant exists but it expired | `the role of the workspace has expired` | `missing_role` |

**Code and text agree.** The code is `missing_role` if and only if the text mentions a *role*, as the last two rows do. The gateway counts the code when sent and falls back on the text otherwise (§8.2), so both count the same denials.

They are one contract: adding, rewording or removing a reason changes this table first, and a test holds the agreement. A reason that mentions a role without being a role denial would change the metric of the reference gateway, which counts the text.

### 8.8 Gateway credentials

The gateway authenticates on decisions with one of two schemes. They are not exclusive.

| Scheme | What it is | What it may ask about |
| --- | --- | --- |
| `Authorization: Bearer {token}` | The deployment token, `ACCESS_DECISION_TOKEN`. **Optional and deprecated.** | Every principal of the platform. |
| `Authorization: Basic {id:secret}` | A tenant gateway's registration (§3.1). | That tenant's principals. |

The **bearer token** is the only scheme the reference gateway has, so it keeps working. It is not scoped: every gateway of the deployment shares it and may ask about any principal, so its blast radius is the whole platform.

**Tenant credentials** are the client id and secret registered for a tenant's gateway (§3.1). The client id names the tenant, the secret is compared in constant time, and decisions are **scoped to that tenant**: a subject outside it is refused with the reason for a principal that does not exist. The answer never reveals that the subject exists in another tenant.

The scope does not depend on the tenant row. A `shared_client` tenant may log in other tenants' principals (§5.2), but its decisions stay scoped to its own tenant; a gateway that asks about every tenant's principals presents the unscoped deployment bearer token.

A credential in neither scheme, or a refused one → `401 unauthorized`. Comparison is constant-time in both schemes, and a tenant secret is never logged.

The scheme is a deployment property; nothing in the gateway changes.

**The bearer token is optional.** `ACCESS_DECISION_TOKEN` is not required in production (§4.4). Without it, only tenant credentials are accepted, and a bearer request → `401 unauthorized`. The token used to be **required**, so a deployment that had moved every gateway still kept a platform-wide secret; now it removes the token once the last gateway that sends it has moved.

**The bearer token is deprecated.** It keeps working, but the first decision that presents it logs a notice, once per service, saying the token is not tenant-scoped and naming the scheme to use instead. A warning on every decision would drown the decision log.

## 9. Access context

> [!NOTE]
> Extension: added by the access context contract, a required integration change for the data backend. It does not change §8: the gateway keeps using `POST /v1/decisions`.

A data-owning service needs more than a boolean: it needs **which** capabilities a principal holds to decide what it may read and write. The §8 decision answers "may this principal use this workspace on this route"; the access context answers "which capabilities does this principal hold for this workspace and route".

Both contracts read the same tables and evaluate the same policy. The access context never replaces the decision. Request and response bodies are in [API](api.md#access-context-contract).

### 9.1 Discovery

```http
GET {ACCESS_ISSUER}/v1/access-context
Authorization: Bearer {access context credential}
```

```json
{"versions":[1],"maxPermissionKeys":4096,"maxLifetimeMs":5000}
```

Discovery is the consumer's readiness check. A version the consumer does not know fails its readiness: a consumer that guesses the contract guesses the permissions.

### 9.2 Request

```http
POST {ACCESS_ISSUER}/v1/access-context
Authorization: Bearer {access context credential}
Content-Type: application/json

{"version":1,"subject":"…","tenantId":"…","workspaceId":"…","routeId":"…"}
```

The body is at most 64 KiB. An unknown field, a field of the wrong type or an unsupported version → `400 bad_request`. `subject` and `tenantId` are platform row ids, so UUIDs: a value that is not one names no row, and the request is refused without asking the database.

The access context credential is **neither** the gateway's credential nor an administration credential. It is a dedicated read-only credential scoped to an explicit set of tenants:

| Situation | Answer |
| --- | --- |
| Missing or wrong credential | `401 unauthorized` |
| Credential may not ask about the tenant | `403 forbidden` |
| Body not understood | `400 bad_request` |
| Policy cannot be evaluated completely | `503 service_unavailable` |

Credential scopes come from `ACCESS_CONTEXT_TOKENS`, which maps each bearer token to the list of tenants it may ask about ([format](configuration.md#access-context-credentials)). A `null` scope is a platform credential that may ask about every tenant; it is a deployment choice and never the default for a tenant credential.

### 9.3 Answer

```json
{
  "version": 1,
  "allow": true,
  "subject": "…",
  "tenantId": "…",
  "workspaceId": "…",
  "routeId": "…",
  "permissionKeys": ["content.editor", "content.reader"],
  "evaluatedAt": "2026-10-21T16:00:00.000Z",
  "validUntil": "2026-10-21T16:00:05.000Z"
}
```

`permissionKeys` is the **complete**, sorted, deduplicated set of keys from the grants that apply: the principal's grants and its groups' grants that are enabled, not revoked, not expired, and whose workspace and route scope match the request or are unrestricted.

The answer is never partial: more than 4096 keys is an error, never an allowance with fewer keys.

`validUntil` is at most `evaluatedAt + 5000 ms` and at most the earliest expiry among contributing grants. An earlier, conservative expiry is allowed. It does not promise that no grant is revoked before then.

A denial is a `200` answer: `allow` is false, `permissionKeys` is empty, `validUntil` is absent, and the answer does not disclose whether the cause was an unknown principal, another tenant, a disabled state or a missing grant.

### 9.4 Rule

Access evaluates one consistent policy snapshot:

1. The credential may ask about the requested tenant.
2. The principal exists, is active and belongs to that tenant.
3. The tenant is enabled.
4. At least one enabled, unrevoked, unexpired grant applies to the principal or to one of its groups.

Access keeps no workspace catalog: which workspaces belong to a tenant is the consumer's responsibility. Access still checks that the principal belongs to the requested tenant.

### 9.5 Freshness

The context is evaluated on every request and never cached by Access. A consumer may cache it for reads, within its own bounds: never past `validUntil`, and a mutation or background command always asks for a fresh context.

Authorization is evaluated at decision time. A revocation after that may leave an in-flight request running; the window is bounded by the consumer's cache lifetime plus the request's duration. It is not a distributed transaction.

## 10. Administration

The administrative endpoints, plus one that reads the audit, are the whole administration surface: no console, no portal, no second way to change a tenant, principal or grant (§2.1, invariant 5). Request and response bodies are in [API](api.md#administration).

### 10.1 Common rules

**Authentication.** Every endpoint is under `/v1/admin` and requires a **bearer token**. Missing or wrong token → `401 unauthorized`. Comparison is constant-time. The token the current one replaced is accepted until the deployment removes it (§4.3.1).

Credential kinds (§4.6):

| Credential | May act for | Audit operator |
| --- | --- | --- |
| `ACCESS_ADMIN_TOKEN` | Every tenant. | The token's fingerprint. |
| Tenant credential in `ACCESS_ADMIN_TOKENS` | Its own tenant only. | The credential's operator name. |
| Platform credential in `ACCESS_ADMIN_TOKENS` | Every tenant. | The operator name, or the token's fingerprint. |

A tenant credential acting for **another** tenant (its principal, group, grant, or the tenant itself) → `403 forbidden`. A tenant credential's lists are limited to its tenant, and a query filter cannot widen them. A tenant credential cannot create a tenant; only the platform operator can.

**Platform-owned tenant flags are for the platform operator only.** `shared_client` moves logins across the platform and `is_default` routes shared-client logins, so a tenant credential may not change them. A call carrying a value different from the row's → `403 forbidden`; a call carrying the row's current value proceeds like any other change.

**Bodies and answers.**

- Bodies are JSON, at most 64 KiB. Larger → `413`.
- Answers are JSON. Errors are `{"error": "<code>", "message": "<text>"}`.

**Rate limit.** Calls are rate limited per address: a burst of failed authentications → `429`, so the admin token cannot be guessed by hammering. **Only failed calls spend an address's budget**: an authenticated call is answered whatever the address did before, and it clears the address's count. The failure count lives in the deployment's **shared store**, so the limiter window is the deployment's, not a replica's; several replicas do not multiply the budget. A deployment that keeps state in process memory is a single node, so its count is the deployment's.

**Logging.** Every call is logged: endpoint, status, address and the identifier of what changed. Secrets are never logged.

**Pagination.** List endpoints are **paginated**: `limit` (default `50`, maximum `200`) and `offset` (default `0`). A non-numeric `limit`, a `limit` above the maximum or a negative `offset` → `400 invalid_request`. The answer carries the `total` of matching rows, so the operator knows how many pages there are.

**Audit.** **Every change is audited in a table**, `admin_audit`: action, identifier of what changed, tenant, operator, address and request. The operator is the credential's **name** when it has one and its **fingerprint** otherwise (the first twelve hexadecimal characters of the token's digest), so the audit names the operator but never holds the secret. The row is written by **the same statement** as the change, so both commit or neither does. A failed write fails the call; the caller retries, and every administration call is idempotent. Read the audit with `GET /v1/admin/audit` (§10.15). A tenant credential sees only its tenant's audit.

**Error codes:** `unauthorized`, `invalid_request`, `not_found`, `conflict`, `forbidden`, `too_many_requests`, `service_unavailable`. `service_unavailable` answers a call that cannot be authenticated because the failed-authentication count, held in the shared store, could not be read: a store that is down refuses calls, never lets them through.

### 10.2 `POST /v1/admin/tenants`

Creates a tenant, or updates the tenant with that slug: an **upsert** keyed by slug. `201` when created, `200` when updated.

A slug that belongs to another tenant of the same client id → `409 conflict`. A `clientId` that belongs to another tenant → `409 conflict`. A `default` that would make a second tenant the default → `409 conflict`.

Both client secrets are encrypted at rest and never returned.

### 10.3 `GET /v1/admin/tenants`

Lists tenants, with their principal and grant counts.

### 10.4 `POST /v1/admin/users`

Creates a principal, or updates the one with that `(tenant, externalSubject)` pair. Use it to register a caller before its first login, and to disable a caller.

An **upsert** keyed by the pair. `201` when created, `200` when updated. Unknown tenant → `404 not_found`.

**Batch.** The body may carry a list of principals instead of one ([shape](api.md#batch-of-principals)). It is how a tenant is onboarded: one call writes a hundred principals instead of a hundred calls.

- At most **1 000** principals. A bigger list → `400 invalid_request`; an empty list → `400 invalid_request`. A batch body is at most 1 MiB; a single-principal body is at most 64 KiB.
- The answer is `200` and reports **every** item: `{"principals": [{"tenant", "externalSubject", "id", "created", "error"?, "message"?}, …]}`.
- **Each item is written on its own.** An item's change and its audit row are one statement: a written item is audited, and a failed item leaves nothing behind. A failed item does not stop the others; its `error` names the refusal (`not_found` for a missing tenant, `conflict` for an identity already in use), so the operator knows *which* identities were refused.
- The call is **idempotent**: repeating the batch updates the existing principals instead of creating them.
- Cost scales with items: each is one statement and one audit row, so a thousand principals is a thousand statements. A batch is an onboarding call, not a request-path call.

### 10.5 `GET /v1/admin/users`

Lists principals: who has an account here, and in what state, without querying the database by hand. Filters: `tenant`, `status`, `email`; paging: `limit`, `offset` (§10.1).

Order is newest first (`created_at desc, id desc`) and stable: pages never repeat or skip a row. The list never carries a secret.

### 10.6 `PUT /v1/admin/grants`

Creates a grant, or updates the one with that `(tenant, user, permission, workspace, route)` tuple.

Exactly one of `userId` and `group` is required. The permission row is **created on demand**, in the tenant's scope, when it does not exist.

| Case | Answer |
| --- | --- |
| Principal of another tenant | `403 forbidden` |
| `userId` does not exist | `404 not_found` |
| Group does not exist | `404 not_found` |
| Group of another tenant | `403 forbidden` |
| Neither a principal nor a group, or both | `400 invalid_request` |

A permission in the platform catalogue is reused. A permission in another tenant is **not**: the tenant creates its own row and the grant names it, since a key is a name inside a tenant (§3.3).

**Batch.** The body may carry a list of grants instead of one ([shape](api.md#batch-of-grants)). The principal batch rules of §10.4 apply: at most **1 000** grants, each item written on its own, every item's outcome reported, and the call idempotent.

### 10.7 `DELETE /v1/admin/grants/{id}`

Revokes a grant. The row is kept and stamped with `revoked_at`: policy history is worth more than the bytes, and a revived revoked grant is not a grant that never existed.

**Idempotent**: an already revoked grant also answers `204`. Unknown id → `404 not_found`. The gateway sees a revocation within `GATEWAY_ACCESS_CACHE_TTL_MS` (§8.6).

### 10.8 `GET /v1/admin/grants`

Lists grants: who may use this workspace, and what is still live, without querying the database by hand. Filters: `tenant`, `userId`, `live`; paging: `limit`, `offset` (§10.1). Order is newest first and stable.

Each grant carries the row's `grantedBy`, so the operator can see who gave an access without querying the database.

### 10.9 `POST /v1/admin/groups`

Creates a group, or changes the one with that key. The call **replaces** the group's membership.

Members are given as the principals' external identities (§6.2): the operator knows the provider's `sub`, not the row id. A member that is not a principal of the tenant → `404 not_found`; a group cannot name a principal that does not exist.

An **upsert** keyed by the group key. `201` when created, `200` when changed.

### 10.10 `GET /v1/admin/groups`

Lists groups, paginated like the other lists (§10.1). Read-only.

Filters: `tenant`, `key`. Unknown tenant → `404 not_found`.

Each group carries its members' **external subjects** (§10.9).

### 10.11 `PUT /v1/admin/roles`

Creates a role, or changes the one with that key. The call **replaces** the role's memberships: the **permissions** it holds and the **roles** it names (§3.6).

Permissions are named by key; an unknown key is created in the tenant's scope, as for a grant (§10.6). Roles are named by key; an unknown role key → `404 not_found`, since a role cannot name a role that does not exist.

A role that names itself, directly or through other roles → `409 conflict`: the nesting would never end and the decision would never answer. The schema refuses the cycle too (§3.6.3).

An **upsert** keyed by the role key, like a group (§10.9). `201` when created, `200` when changed.

### 10.12 `GET /v1/admin/roles`

Lists roles, paginated like the other lists (§10.1). Read-only.

Filters: `tenant`, `key`, as for groups (§10.10). Unknown tenant → `404 not_found`.

Each role carries the keys of the permissions it holds and of the roles it names.

### 10.13 `DELETE /v1/admin/roles/{id}`

Removes a role that no grant names. A role named by a grant → `409 conflict`: grants are kept, so the operator revokes them first. Unknown role → `404 not_found`.

### 10.14 Full session in twelve calls

A tenant's whole lifecycle, from registration to revocation, takes one call to each administrative endpoint; the walkthrough is in [API](api.md#session-in-twelve-calls).

### 10.15 `GET /v1/admin/audit`

The audit of changes, newest first. Read-only, paginated like the other lists (§10.1).

Filters: `tenant` (an unknown tenant slug → `404 not_found`) and `action` (`tenant.created`, `tenant.updated`, `principal.created`, `principal.updated`, `group.created`, `group.updated`, `grant.created`, `grant.updated`, `grant.revoked`, `role.created`, `role.updated`, `role.removed`, `role.permission.granted`, `role.permission.revoked`, `role.role.nested`, `role.role.unnested`).

`format` defaults to `json`; `csv` and `jsonl` are **exports** that a spreadsheet or script can read, with the list filters applied. Any other format → `400 invalid_request`.

| Format | Answer |
| --- | --- |
| `json` | The paginated list: rows, `total`, `limit` and `offset`. |
| `csv` | `text/csv`: a header row of column names, then one line per row. |
| `jsonl` | `application/x-ndjson`: one object per line. |

An export carries at most **10 000 rows** per answer, and the list's `limit` applies: export a larger audit page by page. An export names its file in `content-disposition`.

The `json` answer carries the rows and the `total` matching the filter:

```json
{
  "records": [
    {
      "id": "0f2c…",
      "at": "2026-10-21T19:44:20.975Z",
      "action": "grant.revoked",
      "targetId": "9fbfda13-…",
      "tenant": "acme",
      "operator": "6b1f2c9d0e3a",
      "address": "10.0.0.7",
      "requestId": "8452a08e-ebd7-4e61-ae99-fe051f3e531d"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

A row carries no secret: in this example the operator is the calling credential's fingerprint.

## 11. Decision outcomes

| Path | Answer |
| --- | --- |
| The caller has a grant that satisfies the rule | `{"allow":true,"reason":"allowed"}` |
| The caller has no grant | `{"allow":false,"reason":"the principal does not have the role of the workspace"}` |
| The caller is not a principal of Access | `{"allow":false,"reason":"the principal does not exist"}` |
| The database is down | `503` → the gateway denies, because it fails closed |

The gateway hides the reason from the caller and counts it: `allowed` is not counted, a denial with *role* in the reason is `missing_role`, any other denial is `access_denied`.

## 12. Operations

This section is the contract that operations must respect; procedures are in [Operations](operations.md).

### 12.1 Probes

`GET /healthz` answers `200 {"status":"ok","service":"access","version":"<version>"}` while the process is alive. The version is the platform release tag, so you can see what is running without reading logs.

`GET /readyz` answers `200 {"status":"ready"}` when the database answers a trivial query and the migrations are applied, `503 {"status":"draining"}` during a drain, and `503 {"status":"not-ready"}` otherwise.

### 12.2 Metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `access_decisions_total` | counter | `result` (`allow`, `deny`), `tenant` |
| `access_decision_duration_seconds` | histogram | `tenant` |
| `access_logins_total` | counter | `result` (`success`, `refused`, `error`), `tenant` |
| `access_admin_requests_total` | counter | `endpoint`, `status` |
| `access_store_errors_total` | counter | `store` (`redis`, `postgres`) |

Labels are bounded: `tenant` is capped at 100 values, and the rest aggregate into `overflow`. Neither a caller nor a provider can grow the series count without limit.

### 12.3 Logs

Structured JSON, one line per event, with redacted fields. Events: login (tenant, outcome, refusal reason), decision (subject, workspace, route, allow or deny, reason), administration (endpoint, status, identifier of what changed) and process lifecycle.

Redaction matches the gateway's: a token, a secret, a cookie or an `Authorization` header never reaches a log line.

### 12.4 Drain

On `SIGTERM`, the readiness probe answers `503` with body `draining`, the listener stops accepting new work, running logins get five seconds to finish, and the process exits. A decision still running at the deadline is a denial.

## 13. What does not change in the gateway

The point of the design, as a list of what is **not** touched:

| In the gateway | Status |
| --- | --- |
| The route table format (`config/routes.json`) | Unchanged. |
| The gateway environment (`GATEWAY_*`) | Names carry the gateway's role; the contract is unchanged. Access asks for no new variable. Variables added by gateway releases before the merge are the deployment's business; two are required by a production gateway (`GATEWAY_SESSION_SECRET` and `GATEWAY_IDENTITY_SIGNING_KEY`). The gateway added `GATEWAY_TRUSTED_PROXY_HOPS` (default one), the number of proxies in front of it, and changed `GATEWAY_TRUSTED_PROXIES`: when set, its ranges replace the route table's ranges instead of adding to them. The platform release added no variable and changed no contract. |
| The single provider (`GATEWAY_OIDC_ISSUER`, `GATEWAY_OIDC_CLIENT_ID`, `GATEWAY_OIDC_REDIRECT_URI`, `GATEWAY_OIDC_CLIENT_SECRET`) | Unchanged. They name Access. |
| The single Access (`GATEWAY_ACCESS_URL`, `GATEWAY_ACCESS_TOKEN`) | Unchanged. They name the service. |
| The decision contract (`POST /v1/decisions`, `{subject, workspaceId, routeId, roles}` → `{allow, reason}`) | Unchanged. Access implements it as is and sends a denial's `reasonCode` (§8.7). |
| The gateway's decision cache | Unchanged. Its TTL is the revocation latency. |
| Identity headers, sessions, limits, WebSockets | Names carry the gateway's role; the contract is unchanged. The release `1.0.0` gateway writes the identity's **subject** as is and refuses one that cannot be written into a header; the Access token subject is a UUID (§7.1), so it is always written. |
| The identity signature | The gateway's own: release `1.0.0` removed the symmetric format, and upstreams verify the signature with the deployment's public key. The gateway signs it, not Access. |
| Routes, upstreams, workspaces | Unchanged. They belong to the deployment, not the broker. |
| The gateway code | **No commit.** |

### 13.1 Deployment configuration

```bash
GATEWAY_OIDC_ISSUER=https://access.example.com
GATEWAY_OIDC_CLIENT_ID=gateway-acme
GATEWAY_OIDC_CLIENT_SECRET=the-secret-of-the-gateway
GATEWAY_OIDC_REDIRECT_URI=https://gateway-acme.example.com/auth/callback
GATEWAY_OIDC_SCOPES=openid,profile,email,groups
GATEWAY_OIDC_ROLES_CLAIM=roles

GATEWAY_ACCESS_URL=https://access.example.com
GATEWAY_ACCESS_TOKEN=the-access-token-of-the-Access
```

The gateway discovers Access, reads its JWKS, exchanges codes at its token endpoint and asks it for decisions, without knowing it fronts several identity providers.

The release `1.0.0` gateway and later also require, in production, `GATEWAY_SESSION_SECRET` (the browser session secret) and `GATEWAY_IDENTITY_SIGNING_KEY` (the private key that signs a request's identity). They are the deployment's business, not Access's: upstreams verify the identity with the deployment's public key.

### 13.2 Settings that must agree

| Access | Gateway |
| --- | --- |
| `ACCESS_ISSUER` | `GATEWAY_OIDC_ISSUER`: the **same** URL, character for character. |
| `tenants.client_id` | `GATEWAY_OIDC_CLIENT_ID` |
| `tenants.client_secret` | `GATEWAY_OIDC_CLIENT_SECRET` |
| `ACCESS_DECISION_TOKEN` | `GATEWAY_ACCESS_TOKEN` |

### 13.3 What the gateway learns

The gateway learns the caller's identity: subject, e-mail and roles. It does not learn the tenant, the grants or the permissions; they are not claims it reads.

The e-mail is an id token claim: a bearer-token caller is identified by its subject and roles (§7.2).

The tenant is in the `tid` claim for the operator. The gateway ignores it, which is fine: the §8 decision does not need it, because the subject names the principal and the principal names its tenant.

## 14. Deferred features

Everything below is **deferred**: no column, table, flag, endpoint or code. The schema reserves nothing for them, because a column that is always `null` gets read as a feature.

One comes back only when **a named customer pays for it**. Not "it seems useful", not "it is on the roadmap", not "it is standard".

| Deferred | What it would mean | Without it |
| --- | --- | --- |
| **SAML** | A tenant whose provider speaks SAML instead of OIDC. | A tenant whose provider is not an OIDC provider is not served. |
| **Account linking** | One principal, several external identities (a second provider, a second subject). | The mapping key `(tenant, subject)` is one to one. A person with two accounts has two principals and two sets of grants. |
| **Console** | A web interface for the administration. | The twelve endpoints of §10 and `curl`. |
| **SCIM** | Principal provisioning by a provider. | Principals are created by the §10.4 endpoint or by the tenant's auto-provisioning. |
| **Directory sync** | Scheduled import of a tenant's directory from a source of truth. | Principals are created one at a time, by hand or by a script calling the endpoints. |

**Groups** were not deferred: the platform operator asked for them, and they are the fifth table of the model (§3.5).

## 15. Settled questions

Questions open when this document was first written, and the answers the implementation gives. The answers are the contract: changing one changes this document first. Design decisions and their evidence are in [Decisions](decisions.md); how every rule is tested is in [Internals](internals.md#tests).

| # | Question | Answer | Where |
| --- | --- | --- | --- |
| 1 | May the shared client be enabled at all? | Off by default: `shared_client` is `false` unless the operator says so. When enabled, the `tenant` parameter and the e-mail hint can move a login to another tenant, and nothing else can. | §3.1, §5.2 |
| 2 | Is the token's `roles` claim the right list? | The keys of the principal's live grants, sorted, deduplicated and capped at sixty-four entries. The number left out is logged. | §7.3 |
| 3 | Does a grant need a scope on the request path? | No. The decision contract carries none and does not change: a grant is a workspace and a route, the granularity the gateway knows. | §8.3 |
| 4 | Is grant expiry worth it? | Yes: temporary access is real, and it costs one comparison in the decision statement. | §3.4, §8.3 |
| 5 | How is a secret rotated? | A tenant's gateway secret is kept 24 hours after replacement, and environment tokens are read from two variables during a rotation. Rotation is rolling, never a window where client and service disagree. | §4.3.1 |
| 6 | Where does the administration audit live? | In the infrastructure table `admin_audit`, written by the call that made the change. A log line is not an audit: it disappears with the container and is not queryable. | §10.1 |
