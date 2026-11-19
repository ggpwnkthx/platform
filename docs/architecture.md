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
- `platform`: helper functions, installation marker, transactional row audit/revisions, and
  `item_metadata`: what a workspace, a collection or a field is, read and written under row
  security that asks PostgreSQL's own privilege functions. A field's metadata carries the
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

A collection receives UUID identity, creation/update timestamps, actor role names and a
monotonic version. BEFORE triggers stamp metadata; AFTER triggers record revisions in the
same transaction. Failed and rolled-back changes leave no committed revision.

## Interface

The interface is a static site in `packages/ui/`, generated at build time. `packages/ui/src` is a TypeScript
Preact application; `packages/cli` renders every page to HTML with the interface's own
prerenderer and bundles the client with Bun's bundler into `packages/ui/dist`: one file per page, one
client bundle (`app.js`), `styles.css`, the self-hosted Inter and JetBrains Mono fonts and
`config.json` — the file the site says in, written by the build from the site's own
configuration and the environment. A web server hands out those files; nothing renders a page at request time,
holds a session or adds authorization of its own. The pages are listed in
`packages/ui/src/routes.ts` and described in [interface](interface.md).

Routing is `preact-iso`: the same location contract drives the generator and the browser, so a
page is generated where it is served, links are ordinary anchors that the router intercepts,
and the back button, bookmarks and new tabs all work. Because the token is held in memory only,
a page load always starts signed out, which is exactly the state the generated pages show.

The page speaks PostgreSQL's protocol version 3 itself (`packages/pg-client/src/wire.ts`): OAUTHBEARER
(RFC 7628) login with the reader's token, the extended query protocol with exactly one
statement per query and every value bound as a parameter, and text-format results. In a
browser the bytes go over a WebSocket (`packages/pg-client/src/socket.ts`) to the relay, which forwards
them to PostgreSQL's port and understands none of them. The page opens one login when the
reader signs in and keeps it open while they work (`packages/pg-client/src/kept.ts`,
`withDb` in `packages/ui/src/session.tsx`); the reader's own statements run on a login of
their own, so that what they type cannot reach the platform's work.

What the page does is ordinary SQL, and it belongs to the domain that asks for it. The
questions themselves are the platform's own, and they are asked of PostgreSQL in
`packages/data`: the catalog is read with PostgreSQL's privilege functions; the roles and
memberships through `platform.visible_roles()` and `platform.visible_memberships()`, policies
from `pg_policies`, grants from the ACLs through `aclexplode`; the revisions from
`platform.activity`; the records with filters, search, sort, paging and a row count, written
without RETURNING, and guarded on update by the version the reader saw
(`WHERE id = $n AND version = $m`). The DDL and the DCL — collections, fields, grants,
policies, memberships and roles — are the vocabulary's own, in `packages/vocabulary`, and the
interface's pages (`packages/ui/src/model/`, `packages/ui/src/access/`) show them to the
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

The interface reaches the database through one seam, `packages/ui/src/pg/connect.ts`. A production
build leaves it alone, and the page opens a WebSocket to the relay. A dev-mode build
(`bun run examples:newsroom:dev`) resolves the same seam to the module the example's
configuration names — `examples/newsroom/database.ts` — PostgreSQL 18 running
inside the page (PGlite) and installed with the real migrations, so the interface can be built
without a server, an issuer or a relay. The swap happens while the bundle is built, so PGlite
never reaches a production bundle. The seam carries more than the connection: it says who may
sign in without an issuer, what they are told, and how their choice is kept. A production
seam has none of that — there is an issuer — and the dev-mode seam is the example's own.

There is a second seam, `packages/ui/src/extensions.ts`, for what a site adds to the interface:
field types and renderers of its own. It is empty, and a build of either mode puts the module
a site's `platform.json` names as `extensions` in its place; the module registers with what
`@platform/ui` publishes (`fields/registry.ts`, `fields/renderers.tsx`). The example's is
`examples/newsroom/extensions.tsx`.

Sign-in is authorization code with PKCE against the one configured issuer, done by the page
itself (`packages/ui/src/identity/oidc.ts`): the token kept in memory, the PKCE verifier held in
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

Six packages and an example, each with its own dependencies and its own tests, and a
repository root that holds what belongs to the deployment as a whole: the migrations, the
deployment files, the documentation and the integration tests that cross the packages.

- `packages/vocabulary` — the vocabulary the platform speaks, written once: the SQL it writes
  (identifiers, literals, columns, the names a relation's constraint carries, and the access
  it grants) and the tokens and versions it reads. The operator's tools and the interface
  both build DDL and DCL, and they must build it the same way, so the rules live here rather
  than twice. It has no dependencies and runs in the browser, in Bun and in Node.
- `packages/data` — the questions the platform asks PostgreSQL, and the answers it reads
  back: the catalog, the records, the metadata, the access, the revisions, the identity and
  the workspace. It holds no connection of its own: it asks through a source of statements
  (`DataSource` in `packages/vocabulary`), so the page may ask in the browser and a tool may ask
  from Node, and the question means the same thing either way.
- `packages/pg-client` — the PostgreSQL client the platform speaks with: the protocol itself
  (`wire.ts`), the browser's way of carrying it (`socket.ts`) and the logins a client keeps
  open (`kept.ts`). It knows nothing about the interface, and nothing about what a statement
  means.
- `packages/cli` — the operator's tools. `database/db.ts` owns the CLI's connections and the token
  login, `database/config.ts` the endpoint it reaches and `database/requirements.ts` the
  server version and its authentication rules; `token.ts` signs a terminal in; `model.ts`
  builds typed DDL for the model importer; `cli.ts` runs the operator tasks; `apply.ts`
  converges a database on a JSON manifest; `harden.ts` hides the role catalogs;
  `deployment/` runs the deployments, split into the local stack, Kubernetes, the help text
  and the runtime they share; `ui/` builds the interface as a static site and serves it
  while it is worked on, reading `platform.json` for what to build.
- `packages/relay` — the WebSocket in front of PostgreSQL's port: `relay.ts`, and nothing else.
  It holds no credentials, and it reads one setting: the role PostgreSQL reports, so that it
  can keep one role from taking the database's connections for itself.
- `packages/ui` — the interface, and little else: `src` is the Preact application, laid
  out by domain, and each domain holds its page and what it draws. `content/` reads and
  writes the records of a collection, `model/` the collections and their fields, `access/`
  the roles, grants and row policies, `activity/` the revisions, `metadata/` what an item is
  and how it presents itself, `sql/` the reader's own statement, `workspace/` the schema and
  the rights on it, `identity/` who the reader is, and `fields/` what a column is drawn as.
  The SQL these pages run is the platform's own, in `packages/data` and `packages/vocabulary`; the
  protocol is the client's, in `packages/pg-client`. What is left here is the interface: its
  widgets (`ui/`), its shell, and the one seam (`pg/connect.ts`) that reaches the database.
  The root of `src` holds
  the shell of the application: `app.tsx` routes, `session.tsx` holds the token and the
  catalog, `shell.tsx` draws the layout, `routes.ts` names the pages, `config.ts` reads
  `config.json`, `url.ts` carries the context in the address and `format.ts` the words.
  `src/prerender.tsx` renders the pages, `src/headers.ts` holds the headers the site is
  served with, and `src/paths.ts` says where the interface lives. There is no build script
  here: the interface is source, and the packages that need a site build one. The dev-mode
  server is not here either: it belongs to the example, which is where the PostgreSQL that
  runs inside the page lives too.
- `examples/newsroom` — the newsroom example, running. It imports the interface and the
  builder, and it is the only thing that knows PostgreSQL runs inside the page: the in-page
  database, the seed it installs, the people who sign in without an issuer, the dev-mode
  build and the server that serves it.

`migrations/` holds the installation scripts the CLI applies and the dev-mode build
installs into its in-page PostgreSQL. `deploy/cdn` explains how the site is published. There
is no access-policy compiler or authorization service.
