# Architecture

A PostgreSQL role is the user. A person signs in through Dex, which fronts every upstream
sign-in system and issues the token; PostgreSQL 18 checks that token during connection startup
and logs its holder in as the role named by its email claim. The same sign-in works in psql and
in the interface. There is no parallel application identity, and no role has a password
except the installer's administrator.

```
upstream providers -> Dex (one issuer) -> token -> interface / psql / CLI
                                                      |  OAUTHBEARER
                                          PostgreSQL 18 + validator: signature, issuer, expiry,
                                          and email claim = role name
```

There is no application server. The interface is a static site whose pages speak PostgreSQL's
frontend/backend protocol themselves. It is published to a CDN as files, and never runs in a
container. In a browser the protocol travels over a WebSocket to the relay, a forwarder in
front of PostgreSQL's port:

```
page (wire protocol) -> wss://relay.example.com -> relay (Origin check, session cap) -> PostgreSQL
```

For each action, the page:

1. Opens a WebSocket to the relay, which opens a TCP connection to PostgreSQL.
2. Logs in as the role the token names, presenting the token through OAUTHBEARER. The page
   verifies nothing about it: PostgreSQL does.
3. Runs parameterized SQL, or the reader's one SQL statement, on that login.
4. Shows the rows or the refusal and closes the connection.

Nothing on the way connects as a service login, and nothing uses SET ROLE or SET SESSION
AUTHORIZATION to manufacture user identity. A user can issue native SET ROLE only when
PostgreSQL permits it; the connection closes at the end of that action, so state does not
survive. `session_user` remains the authenticated login when a granted role is selected.

The database decides access with ordinary ACLs and RLS. Catalog introspection shapes the
interface and its default column list; it is not a cached permission evaluator. PostgreSQL
still authorizes every explicit projection, predicate, sort, relation and write.

## Database layout

- Workspace: a PostgreSQL schema. Its owner controls model administration.
- Collection: a table. Fields are columns; relations are foreign keys. Existing tables/views
  can also be queried from the SQL page or any client if their native grants permit it.
- User: LOGIN role; group: NOLOGIN role. Membership lives in pg_auth_members.
- Table/column permissions: native ACLs. Row policies: CREATE POLICY and ALTER TABLE RLS.
- `platform`: helper functions, installation marker and transactional row audit/revisions.
- `platform.item_metadata`: what a workspace, a collection or a field is. One collection
  for every workspace, read and written under forced row security that asks PostgreSQL's
  own privilege functions. A field's metadata carries the
  views it appears in, and the default is written in one place; see [views](views.md).

`platform_core` owns the platform schema. It is NOLOGIN and has no CREATEROLE, CREATEDB,
SUPERUSER or BYPASSRLS. Only installation administrators should be members. `platform_users`
is a NOLOGIN convenience group with CONNECT, platform schema usage, helper execution and
RLS-filtered audit reading. It does not grant access to any workspace table.

`platform.create_collection` and `platform.stamp` run as SECURITY INVOKER. Creating a table
requires the caller's CREATE privilege on its schema. Later ALTER TABLE and policy changes
require ownership or another native PostgreSQL authority. The interface has no separate DDL
connection and no elevated model-management path.

`platform.record_change` is the only SECURITY DEFINER helper. It runs as platform_core and
inserts the trigger's OLD/NEW rows and actual session_user into platform.activity. Its fixed
search_path and qualified audit target avoid object substitution. It accepts no arbitrary SQL
or actor argument. It can only be invoked as a trigger.

The rows it logs hold every column of a collection, so nobody is granted them. They are read
through `platform.revisions`, a view of platform_core's with the log's own rule in it: a
workspace's owners read its revisions, and `platform.readable_row` cuts each logged row down
to the columns the reader holds SELECT on in the table it came from, which the log names by
OID. What happened — who, when, to which collection — is readable in platform.activity under
the same rule.

A collection receives UUID identity, creation/update timestamps, actor role names and a
monotonic version. BEFORE triggers stamp metadata; AFTER triggers record revisions in the
same transaction. Failed and rolled-back changes leave no committed revision.

## Interface

The interface is a static site in `packages/ui/`: a TypeScript React application that Vite
builds into `packages/ui/dist` — one bundle and its styles, the self-hosted Inter and JetBrains
Mono fonts, `config.json`, `_headers`, and one copy of the document per page, so every address
is a real file.

Routing is `react-router`: the same location contract drives the generator and the browser, so a
page is generated where it is served, links are ordinary anchors that the router intercepts,
and the back button, bookmarks and new tabs all work. Because the token is held in memory only,
a page load always starts signed out, which is exactly the state the generated pages show.

The page speaks PostgreSQL's protocol version 3 itself (`packages/core/src/token-client.ts`): OAUTHBEARER
(RFC 7628) login with the reader's token, the extended query protocol with exactly one
statement per query and every value bound as a parameter, and text-format results. In a
browser the bytes go over a WebSocket (`packages/ui/src/connect.ts`) to the relay, which forwards
them to PostgreSQL's port and understands none of them. The page opens one login when the
reader signs in and keeps it open while they work (`packages/ui/src/connect.ts`,
`withDb` in `packages/ui/src/session.tsx`); the reader's own statements run on a login of
their own, so that what they type cannot reach the platform's work.

What the page does is ordinary SQL, and it belongs to the domain that asks for it. The
questions themselves are the platform's own, and they are asked of PostgreSQL in
`packages/core`: the catalog is read with PostgreSQL's privilege functions; the roles and
memberships through `platform.visible_roles()` and `platform.visible_memberships()`, policies
from `pg_policies`, grants from the ACLs through `aclexplode`; the revisions from
`platform.revisions`; the records with filters, search, sort, paging and a row count, written
without RETURNING, and guarded on update by the version the reader saw
(`WHERE id = $n AND version = $m`). The DDL and the DCL — collections, fields, grants,
policies, memberships and roles — are the vocabulary's own, in `packages/core`, and the
interface's pages (`packages/ui/src/model.tsx`, `packages/ui/src/access.tsx`) show them to the
reader before they run. Every statement that changes the model or access is shown to the reader
before it runs, then runs as them in one transaction.

Every right the interface shows is PostgreSQL's own. The catalog is built from
`has_table_privilege`, `has_column_privilege` and `has_schema_privilege`, and it carries one
more answer — `pg_has_role(current_user, relowner, 'USAGE')`, the test PostgreSQL itself uses
for "must be owner of table" — because ALTER, GRANT and CREATE POLICY belong to the owner of
the relation. The identity carries `has_database_privilege(current_database(), 'CREATE')`,
which is what a workspace needs, and `platform.is_operator()`, the platform's own answer about
roles. The interface keeps no second opinion about rights; it asks the database, marks the
fields it withholds (hidden from you, write-only, read-only), and shows a refusal with its
SQLSTATE.

The interface reaches the database through one seam, `packages/ui/src/connect.ts`. A production
build leaves it alone, and the page opens a WebSocket to the relay. A dev-mode build
(`bun run examples:newsroom:dev`) loads the same seam as `packages/ui/src/inpage.ts`, handed
the files the example's `platform.json` says it applies: PostgreSQL 18 running
inside the page (PGlite) and installed with the real migrations, so the interface can be built
without a server, an issuer or a relay. The swap happens while the bundle is built, so PGlite
never reaches a production bundle. The seam carries more than the connection: it says who may
sign in without an issuer, what they are told, and how their choice is kept. A production
seam has none of that — there is an issuer — and the dev-mode seam reads it from the example:
the people are the ones its `models.ts` names.

There is a second seam, the module `virtual:platform-site` (`packages/ui/vite.config.ts`), for what a site adds to the interface:
field types and renderers of its own. It is empty, and every build of a site puts the module
a site's `platform.json` names as `extensions` in its place; the module registers with what
`@platform/ui` publishes (`fields/registry.ts`, `fields/renderers.tsx`). The example's is
`examples/newsroom/extensions.tsx`.

Sign-in is authorization code with PKCE against the one configured issuer, done by the page
itself (`packages/ui/src/session.tsx`): the token kept in memory, the PKCE verifier held in
sessionStorage only across the redirect. The page reads the issuer, client id, claim, relay
address and database name from `/config.json`, a file served beside the pages, so that a
deployment changes it without rebuilding the bundle.

The interface reads in one workspace at a time. A workspace is the unit of ownership and of
permission here, so it is the unit the interface presents in: the workspace in view lives in
the address (`?ws=<schema>`), a link carries it, and every module shows that workspace alone —
its collections, its row policies, its revisions. The workspace is chosen in one place only,
the workspace switcher of the navigation pane, which also offers the way to make a new one.
PostgreSQL's default schema is PostgreSQL's own, not a workspace, so it is never offered and
never modelled. Roles and memberships stay cluster-wide: they are the same in every workspace.

Inside a workspace, a collection is the unit the interface reads: the collection in view lives
in the address too (`?c=<collection>`), and a record in view as `?id=<uuid>`. The navigation
pane lists the collections of the workspace in view. Content holds the records of a collection
and the form that writes one; Data model holds its fields and the right to add another; the
sidebar shows the collection's information, the reader's rights on it and the row policies
that apply. Each is editable only where PostgreSQL says so: a reader who is not the owner is
offered no field to add, because PostgreSQL gives ALTER on a table to its owner, and the
interface does not offer what the database would refuse. A workspace has settings of its own:
what it is (its metadata) and who may use it (the rights on the schema).

## Repository

Four packages and an example, and a repository root that holds what belongs to the deployment
as a whole: the migration, the deployment files and the documentation. The platform's own
code is what no package does for it; the rest is other people's, kept current.

- `packages/core` — what the platform says to PostgreSQL and reads back, written once and
  run in the browser and in Bun alike. `sql.ts` is the SQL it writes — grants and their
  differences, row policies, roles, collections and fields, metadata — with Kysely doing the
  quoting and the parameters, and no driver behind it: a statement can be shown before it
  runs, and run by whichever connection the caller holds. `catalog.ts`, `access.ts` and
  `metadata.ts` are the questions it asks (PostgreSQL's own privilege functions, the ACLs,
  the platform's functions); `records.ts` is the record browser's query, built with Kysely;
  `manifest.ts` is the manifest (Zod) and what converges a database on one; `db.ts` is the one
  seam to a connection, tokens (jwt-decode) and versions (compare-versions).
  `token-client.ts` adds OAUTHBEARER logins to node-postgres and the drivers built on it, and
  `pglite.ts` adapts PGlite: PostgreSQL in the page and in the tests.
- `packages/ui` — the interface: a React application on Mantine (components, forms,
  notifications), mantine-datatable (the records grid), TanStack Query (what is read from
  PostgreSQL), React Router (the address), lucide (icons) and oidc-client-ts (the sign-in),
  built by Vite. `connect.ts` is the page's logins: Neon's serverless driver — node-postgres
  over a WebSocket — and its pool. `session.tsx` holds the sign-in and the installation;
  `fields.tsx` is the field types, the renderers and what an installation may register;
  `content.tsx`, `model.tsx`, `access.tsx`, `metadata.tsx`, `workspace.tsx` and `activity.tsx`
  are the pages; `bits.tsx` is the little they share — the privilege mark, the statement, and
  the drawer every change goes through. `inpage.ts` is the dev mode's PostgreSQL, and
  `vite.config.ts` the seam (`virtual:platform-site`) through which a site's extensions, and
  in the dev mode alone its in-page database, reach the bundle.
- `packages/cli` — the operator's tools, on citty (commands), clack (questions), node-postgres,
  openid-client (the device sign-in) and yaml. `cli.ts` is the commands; `database.ts` the
  login a command acts as, doctor, lock and harden; `site.ts` reads `platform.json` and
  builds, serves and develops a site; `deploy.ts` is the local stack and Kubernetes.
- `packages/relay` — the WebSocket in front of PostgreSQL's port: `relay.ts`, one file and no
  dependency. It holds no credentials and reads nothing but the first packet, which must be
  a login.
- `examples/newsroom` — the newsroom example. It is content, and no machinery: `platform.json`
  says what the folder is, `apply/` holds what it applies to a database (`models.ts`,
  `migration.sql` and `demo.sql`), and `extensions.tsx` is what it adds to the interface. The
  same files are applied to a deployment, installed in the page of a dev-mode build, and
  asked questions of by the tests.

`migrations/` holds the installation scripts the CLI applies and the dev-mode build
installs into its in-page PostgreSQL. `deploy/cdn` explains how the site is published. There
is no access-policy compiler or authorization service.
