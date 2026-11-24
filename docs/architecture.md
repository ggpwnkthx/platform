# Architecture

A PostgreSQL role is the user. A person signs in through Dex, which fronts every upstream
sign-in system and issues the token; PostgreSQL 18 checks that token during connection startup
and logs its holder in as the role named by its email claim. The same sign-in works in psql and
in the interface. There is no parallel application identity, and no role has a password.

```
upstream providers -> Dex (one issuer) -> token -> interface / psql
                                                      |  OAUTHBEARER
                                          PostgreSQL 18 + validator: signature, issuer, expiry,
                                          and email claim = role name
```

There is no application server. The interface is a static site whose pages speak PostgreSQL's
frontend/backend protocol themselves. It is published to a CDN as files. In a browser the
protocol travels over a WebSocket to the relay, a forwarder in front of PostgreSQL's port:

```
page (wire protocol) -> wss://api.example.com -> relay (Origin check, first packet) -> PostgreSQL
```

The page opens one login when the reader signs in, with the reader's own token, and keeps it
open while they work. It runs parameterized SQL on it, one statement per query, always
prepared, and shows the rows or the refusal. Nothing on the way connects as a service login,
and nothing uses SET ROLE or SET SESSION AUTHORIZATION to manufacture identity.

The database decides access with ordinary ACLs and row security. What the interface reads of
the catalog shapes what it draws; it is not a permission evaluator. PostgreSQL still
authorizes every projection, predicate, sort, relation and write.

## Database layout

- Workspace: a PostgreSQL schema. Its owner controls model administration.
- Collection: a table. Fields are columns; relations are foreign keys.
- User: LOGIN role; group: NOLOGIN role. Membership lives in pg_auth_members.
- Table and column permissions: native ACLs. Row policies: CREATE POLICY and row security.
- `platform`: the helper schema — functions, the installation marker, the revisions, the
  metadata of items, and the views of the catalog.

`platform_core` owns the platform schema. It is NOLOGIN and has no CREATEROLE, CREATEDB,
SUPERUSER or BYPASSRLS. `platform_users` is a NOLOGIN convenience group with CONNECT, usage of
the platform schema and its helpers. It grants access to no workspace table.

`platform.create_collection` and `platform.stamp` run as SECURITY INVOKER: creating a table
needs the caller's own CREATE privilege on its schema. `platform.record_change` is the only
SECURITY DEFINER helper that acts: it runs as platform_core, appends the trigger's OLD and NEW
rows and the real `session_user` to `platform.activity`, takes no actor argument, and can only
be invoked as a trigger. The logged rows are read through `platform.revisions`, which shows a
workspace's owners its history and cuts each row down to the columns the reader holds SELECT
on. A collection receives a UUID identity, creation and update stamps, and a monotonic
version; an update made from the interface is guarded by the version the reader saw.

`platform.item_metadata` holds what a workspace, a collection or a field says of itself, under
forced row security that asks PostgreSQL's own privilege functions.

### The catalog, as views

The questions the interface asks are written once, in the migration, as views with
`security_invoker`: `platform.session`, `catalog_schemas`, `catalog_tables`,
`catalog_columns`, `catalog_constraints`, `catalog_indexes`, `catalog_types`,
`access_grants`, `access_policies`, and the functions `platform.reach` and
`platform.schema_reach`. Each asks PostgreSQL's privilege functions
(`has_table_privilege`, `has_column_privilege`, `has_schema_privilege`, `pg_has_role`), which
answer for the caller. psql reads the same answers: `SELECT * FROM platform.catalog_tables`.
Roles and memberships are read through `platform.visible_roles()` and
`platform.visible_memberships()`, which answer about the caller, so the interface keeps
working once the role catalogs are hidden.

## Repository

Our own code is what no package does for it.

- `packages/core` — what the platform says to PostgreSQL and reads back, run in the browser
  and in Bun alike. `sql/` is the DDL and DCL it writes — grants and their differences, row
  policies, roles, collections and fields, metadata — as text, with Kysely doing the quoting,
  so a statement can be shown before it runs. `catalog/` and `access.ts` read the views.
  `records/` is the record browser's query: filters, search across relations, sort, paging,
  links. `token-client.ts` adds OAUTHBEARER logins to node-postgres and the drivers built on
  it, and fails loudly if the driver's private hooks move. `pglite.ts` adapts PGlite.
- `packages/ui` — the interface: react-admin on Material UI. `data/` is the data provider
  over the reader's login; `kit/` is the building blocks every page is made of; `fields/` is
  the field types and renderers; `records/`, `model/`, `access/` and `pages/` are the pages.
  `session/` is the sign-in (openid-client), the connection (Neon's serverless driver over a
  WebSocket) and the dev mode's in-page PostgreSQL. `vite.ts` is the site build.
- `packages/relay` — the WebSocket in front of PostgreSQL's port. No dependency. It holds no
  credentials and reads nothing but the first packet, which must be a login.
- `packages/cli` — `bun run deploy`: the local stack and Kubernetes.
- `examples/newsroom` — a site folder. It is content: `platform.json`, the SQL it applies,
  and the renderers it adds.

There is no access-policy compiler, no authorization service, and no manifest format: a
schema is SQL ([applying SQL](apply.md)).
