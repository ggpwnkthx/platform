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
frontend/backend protocol themselves. In a browser the protocol travels over a WebSocket to a
relay, a stock WebSocket-to-TCP forwarder in front of PostgreSQL's port:

```
page (wire protocol) -> wss://.../pg -> nginx (Origin check, session cap) -> relay -> PostgreSQL
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
- `platform`: helper functions, installation marker, transactional row audit/revisions, and
  `item_metadata`: what a workspace or a collection is, read and written under row security
  that asks PostgreSQL's own privilege functions.

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

A collection receives UUID identity, creation/update timestamps, actor role names and a
monotonic version. BEFORE triggers stamp metadata; AFTER triggers record revisions in the
same transaction. Failed and rolled-back changes leave no committed revision.

## Interface

The interface is a static site in `ui/`, generated at build time. `ui/src` is a TypeScript
Preact application; `scripts/build-ui.tsx` renders every page to HTML with `preact-iso`'s
prerenderer and bundles the client with Bun's bundler into `ui/dist`: one file per page, one
client bundle (`app.js`), `styles.css`, the self-hosted Inter and JetBrains Mono fonts and
`config.json`. A web server hands out those files; nothing renders a page at request time,
holds a session or adds authorization of its own. The pages are listed in
`ui/src/routes.ts` and described in [interface](interface.md).

Routing is `preact-iso`: the same location contract drives the generator and the browser, so a
page is generated where it is served, links are ordinary anchors that the router intercepts,
and the back button, bookmarks and new tabs all work. Because the token is held in memory only,
a page load always starts signed out, which is exactly the state the generated pages show.

The page speaks PostgreSQL's protocol version 3 itself (`ui/src/pg/wire.ts`): OAUTHBEARER
(RFC 7628) login with the reader's token, the extended query protocol with exactly one
statement per query and every value bound as a parameter, and text-format results. In a
browser the bytes go over a WebSocket (`ui/src/pg/socket.ts`) to the relay, which forwards
them to PostgreSQL's port and understands none of them. Each action opens one login and closes
it (`withDb` in `ui/src/session.tsx`).

What the page does is ordinary SQL, all of it in two files. `ui/src/db/platform.ts` reads the
catalog with PostgreSQL's privilege functions, the roles and memberships through
`platform.visible_roles()` and `platform.visible_memberships()`, policies from `pg_policies`,
grants from the ACLs through `aclexplode`, and activity; it reads records with filters, search,
sort, paging and a row count, writes them without RETURNING, and guards an update with the
version the reader saw (`WHERE id = $n AND version = $m`). `ui/src/db/model.ts` builds the DDL
for collections, fields, grants, policies, memberships and roles. Every statement that changes
the model or access is shown to the reader before it runs, then runs as them in one
transaction.

Every right the interface shows is PostgreSQL's own. The catalog is built from
`has_table_privilege`, `has_column_privilege` and `has_schema_privilege`, and it carries one
more answer — `pg_has_role(current_user, relowner, 'USAGE')`, the test PostgreSQL itself uses
for "must be owner of table" — because ALTER, GRANT and CREATE POLICY belong to the owner of
the relation. The identity carries `has_database_privilege(current_database(), 'CREATE')`,
which is what a workspace needs, and `platform.is_operator()`, the platform's own answer about
roles. The interface keeps no second opinion about rights; it asks the database, marks the
fields it withholds (hidden from you, write-only, read-only), and shows a refusal with its
SQLSTATE.

The interface reaches the database through one seam, `ui/src/db/connect.ts`. A production
build leaves it alone, and the page opens a WebSocket to the relay. A development build
(`bun run dev:ui`) resolves the same seam to `ui/src/dev/database.ts`, PostgreSQL 18 running
inside the page (PGlite) and installed with the real migrations, so the interface can be built
without a server, an issuer or a relay. The swap happens while the bundle is built, so PGlite
never reaches a production bundle.

Sign-in is authorization code with PKCE against the one configured issuer, done by the page
itself (`ui/src/auth/oidc.ts`): the token kept in memory, the PKCE verifier held in
sessionStorage only across the redirect. The page reads the issuer, client id, claim, relay
path and database name from `/config.json`, which the deployment writes when it starts.

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

`src/db.ts` owns the CLI's connections, the token login and SQL quoting; `requirements.ts`
checks the server version and its authentication rules; `token.ts` signs a terminal in;
`model.ts` builds typed DDL for the model importer; `cli.ts` runs operator tasks; `apply.ts`
converges a database on a JSON manifest; `harden.ts` hides the role catalogs; `deploy.ts` runs
the deployments. `ui/src` is the interface; `scripts/build-ui.tsx` generates its static pages
and `scripts/dev-ui.ts` serves it in development. `deploy/ui` holds the web server's
configuration. There is no access-policy compiler or authorization service.
