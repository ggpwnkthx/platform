# Interface

The interface is a static site in `packages/ui/`. Its pages are generated at build time, and the client
in them speaks PostgreSQL's own wire protocol: it logs in to PostgreSQL with the reader's token,
runs ordinary SQL as the reader, and lets PostgreSQL decide every right. There is no application
server, no `/api` and no session of the interface's own. The same rules apply in psql, the CLI
and any other client.

## Pages

`bun run build:ui` (packages/cli) prerenders every page with the interface's own prerenderer into `packages/ui/dist`, beside one client
bundle (`app.js`), `styles.css`, the self-hosted Inter and JetBrains Mono fonts and
`config.json`. Each page is its own file, so a bookmark, a new tab and a reload all land on a
real page; inside the app, links move between pages without a reload, which is what keeps the
token in memory.

| Page                  | Module     | What it is for                                                   |
| --------------------- | ---------- | ---------------------------------------------------------------- |
| `/`                   |            | Sign-in                                                          |
| `/content`            | Content    | The collections of the workspace in view, as an entry point      |
| `/content/records`    | Content    | The records of a collection: search, filters, sort, pages, count |
| `/content/item`       | Content    | One record: read it, edit it, delete it, or write a new one      |
| `/model`              | Data model | The collections of the workspace and their shape                 |
| `/model/collection`   | Data model | One collection: its fields; its description, RLS and metadata    |
| `/model/new`          | Data model | A new collection, with its fields                                |
| `/workspace/new`      |            | A new workspace (a schema)                                       |
| `/workspace/settings` |            | The workspace in view: its metadata and the rights on its schema |
| `/access`             | Access     | The roles the reader may see, and a new role                     |
| `/access/role`        | Access     | One role: memberships, its rights in the workspace, its policies |
| `/access/policies`    | Access     | The row policies of the workspace's collections, and a new one   |
| `/activity`           | Activity   | The revisions the reader may read, under the audit table's RLS   |
| `/sql`                | SQL        | One statement at a time, run as the reader                       |

The layout is a data studio: a module bar (Content, Data model, Access, Activity, SQL), a
navigation pane with the workspace switcher and the collections of the workspace in view, a
header with the page's actions, and a sidebar with the collection's information, the reader's
rights on it and the row policies that apply to it. Everything is read in one workspace at a
time. The address carries what is in view: the workspace in `?ws=`, the collection in `?c=`,
a record in `?id=`. Roles and memberships are cluster-wide and the same in every workspace.

The record browser searches every column the reader may read, as text, case-insensitively;
filters on named operators; sorts by any column; pages; and counts the rows the predicate
allows under row security. The operators are `eq`, `neq`, `contains`, `starts_with`,
`ends_with`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `is_null` and `not_null`. The text
operators match case-insensitively and treat `%` and `_` as literal characters. A condition on
a column the reader may not read is refused by PostgreSQL, not hidden by the page.

Field types offered by the collection and field builders are text, integer, bigint, decimal,
float, boolean, date, time, timestamp, uuid, json and relation. A relation is a real foreign
key to another collection of the same workspace, with what PostgreSQL does when the target row
goes (restrict, cascade or set null). Fields may be required, unique or indexed, carry a
default, and take a maximum length, a list of choices, or a minimum and a maximum. Other schema
changes use native SQL.

A field may have any type the database holds, not only the platform's own. The builder offers
the types of the installation beside them: `geometry` and `geography` where PostGIS is
installed, an enum or a domain of the installation's own. Such a type is named with the
schema it lives in, so it means the same thing wherever the statement runs, and it may carry
the modifiers it takes — `Point, 4326` for a geometry:

```sql
ALTER TABLE newsroom.places ADD COLUMN "public"."geometry"("Point", 4326);
```

The values of such a field are read and written as PostgreSQL writes them: the interface does
not know what a geometry looks like on a map, and does not pretend to.

A field is more than a column: it is drawn in three situations — the records grid, the record
form and the filter builder — and the owner of a collection may say which of them it belongs
to. A field may be kept out of the grid, locked in the form or kept out of the filters; see
[where a field appears](#where-a-field-appears). PostgreSQL still decides who may read the
field and who may write it: a field kept out of the form is the reader's to change in psql.

A column PostgreSQL computes itself — a generated column, or an identity column it numbers —
is shown and never offered as an input. The interface offers only what the database would
allow, and PostgreSQL refuses a write to such a column.

## How the page reaches PostgreSQL

`packages/pg-client/src/wire.ts` is a PostgreSQL client for protocol version 3, written for the page:

- Login is OAUTHBEARER (RFC 7628) with the reader's own token, as the role the token's claim
  names. PostgreSQL's validator checks the token's signature, issuer and expiry; the page
  verifies nothing about it.
- Statements use the extended query protocol: exactly one statement per query, every value
  bound as a parameter, results in text format.
- The startup message sends `statement_timeout` (STATEMENT_TIMEOUT_MS from `config.json`) and
  `idle_in_transaction_session_timeout`, and the application name `platform-ui`.

In a browser, the protocol travels over a WebSocket (`packages/pg-client/src/socket.ts`) to the relay, at
the address `config.json` names (`wss://relay.example.com`). The relay (`packages/relay/src/relay.ts`, the
`relay` image) hands the bytes to PostgreSQL's port and understands none of them. It holds no
credentials: the reader's token travels inside the PostgreSQL startup packet, and PostgreSQL
alone checks it. The one thing the relay reads is the setting PostgreSQL reports for the role
it has signed the session in as, so that it can keep one role from taking the database's
connections for itself.

The page keeps its login open (`packages/pg-client/src/kept.ts`): one login when the reader signs
in, closed when the sign-in ends or the token expires. Every action the platform runs — loading
a page's data, saving a record, running a statement — runs on it, and a second action running
at the same time gets a login of its own rather than waiting. A login the server has closed is
opened again the next time; a login whose session has been broken is thrown away. The reader's
own statements (`packages/ui/src/sql/`) run on a login of their own that is closed again
afterwards, so a transaction or a SET ROLE they leave open cannot reach the platform's work. A
token that has expired signs the reader out before a connection is attempted; a login
PostgreSQL refuses signs them out with PostgreSQL's message.

What the page runs is ordinary SQL, and the questions are the platform's own, in
`packages/data`, so that the same question may be asked of another source and mean the same
thing:

- The catalog (`packages/data/src/catalog/`), from PostgreSQL's privilege functions
  (`has_table_privilege`, `has_column_privilege`, `has_schema_privilege`, `pg_has_role`).
  The platform's own schema is in it, as a workspace of another kind (`kind: 'system'`): the
  switcher lists it as **Platform**, after the installation's workspaces, and its tables —
  `item_metadata`, `activity`, `installation` — are system collections, drawn by the same
  records grid, record form and data model page as any other. PostgreSQL's row security
  decides which rows reach the reader, and the catalog never says the reader may change its
  model, whoever they are: that is the migrations' to do. Nobody lands in it; it is in view
  when it is chosen.
- Roles and memberships (`packages/data/src/access/`) through `platform.visible_roles()` and
  `platform.visible_memberships()`, which answer for the reader alone; row policies from
  `pg_policies`; grants from the ACLs through `aclexplode`; the revisions
  (`packages/data/src/activity/`) from `platform.activity`.
- Records (`packages/data/src/content/`) with filters, search, sort, `LIMIT`/`OFFSET` and a
  `count(*)` under the same predicate.
- Inserts, updates and deletes without RETURNING: the right to write a column is not a right
  to read it back, so a write reports how many rows it touched. An update made from a record
  the reader opened is guarded by its version (`WHERE id = $n AND version = $m`). When it
  touches no row, the page reads the record again: a newer version means someone changed it
  since it was opened, otherwise a row policy refused the change or the row is gone, and the
  page says "PostgreSQL changed no row".
- Metadata (`packages/data/src/metadata/`) in `platform.item_metadata`.
- DDL and DCL built by `packages/ui/src/model/` and `packages/ui/src/access/`: workspaces,
  collections, fields, grants, row policies, memberships and roles. The statements
  themselves are the platform's own, in `packages/vocabulary`, so that the operator's tools and
  the interface grant the same rights the same way.

## Shown before it runs

Every statement that changes the model or access — a workspace, a collection, a field, a grant
or revoke, a row policy, a membership, a role — is shown to the reader as SQL before it runs.
When the reader confirms, the statements run as them in one transaction: all of them happen or
none do. The interface grants nothing: PostgreSQL refuses a statement the reader lacks the
authority for, and the interface shows the refusal with its SQLSTATE. The catalog is read
again afterwards, since a statement may change what the reader may reach.

The interface marks what PostgreSQL withholds: a field the reader may not read is "hidden from
you", a field they may write but not read is "write-only", and one they may read but not
write is "read-only". It offers only what the catalog says the database would allow, and
PostgreSQL still judges every statement.

The SQL page runs one statement as the reader. The extended query protocol accepts one
statement, including a complete CREATE FUNCTION body or a DO block; several statements in one
run fail. BEGIN or SET ROLE cannot establish a session for the next run. Use psql or the CLI for
interactive transactions and scripts.

## Metadata

Metadata is what an item is, as opposed to what it holds: a workspace may say what it is for,
a collection may say how it should be read, a field may say what it holds. It is stored in
`platform.item_metadata`, one row per key per item, and PostgreSQL decides who reaches it (see
[access](access.md#metadata)). A reader is shown the keys they may see and nothing for the
rest; a write by anyone but the owner is refused by PostgreSQL. A value is any JSON value. A
change to a key the reader opened is guarded by its version, because it is a record.

An item is a workspace (`schema`), a collection (`schema.table`) or a field of one
(`schema.table.column`). A field's metadata is as private as the field: PostgreSQL returns the
rows of the fields the reader holds a right on, and no others, so a reader who may not read a
column never learns what it is called. The interface reads a collection's fields in one
statement, and labels the fields it may read with their `display_name` when they have one.

### Metadata is a collection

`platform.item_metadata` is a system collection, and the interface has no second way of
reading or changing it. What an item's page shows as its metadata is that collection,
filtered to the item (`metadataFilter` in `packages/data/src/metadata/collection.ts`): read by
the question every collection is read by, and drawn by the fields every collection is drawn
by. A key is a link to its row, and **Add key** opens the ordinary record form with the names
of the item filled in; a row is changed and removed there, by its `id` and its `version`, as
every row is. **Open as a collection** shows the same rows in the records grid, under
Platform.

Three things about it are its own, and they are small:

- **What a row is about.** The item is named — a scope and the names of a schema, a table
  and a column — and not pointed at: the platform keeps no table of items, and metadata
  outlives its item. So the item is composed from the names (`metadataTargetOf`), not drawn
  as a relation.
- **The value.** It is a JSON column, typed as it is meant: a sentence is kept as a string
  and what reads as JSON as itself. That is a field type of that one column
  (`packages/ui/src/metadata/value.tsx`), asked by the record form as any other is.
- **The keys the interface reads for itself.** `display_name`, `icon`, `color`, `views` and
  `renderers` have editors of their own, held in a registry that mirrors the field types'
  (`packages/ui/src/metadata/registry.ts` → `registerMetadataKeyEditor`). An editor is shown
  beside the item, and under its row in the record form; a key without one is just a row. An
  installation that keeps a key of its own may register an editor for it in its extensions.

An item carries a key once. That is the collection's one rule of its own, kept by a unique
index, and the record form says so in words when PostgreSQL refuses a second row (`23505`).
The reserved editors still write by the item's names — `INSERT … ON CONFLICT` — because they
may be the ones that make the row.

A new record may start from what the address says (`v.<field>=…`), and the record form goes
back to where the reader came from (`from=`, a page of the interface and nowhere else). Both
are the record form's own, for every collection.

### Presentation

Three keys are reserved: an item may say how it presents itself.

| Key            | Value                                               | What it does                                               |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `display_name` | Text, up to 80 characters                           | The name people read, in place of the schema or table name |
| `icon`         | The name of one of the platform's icons             | The mark drawn beside the name                             |
| `color`        | A family of the palette, or a colour of the owner's | The colour of the mark                                     |

A field is presented by its name alone: a column is a label, not a mark, so the interface
offers no icon and no colour for one.

They are ordinary metadata rows, so the same rules hold: a reader sees the presentation of
the items they may reach, and only the owner of an item may change it. The interface writes
them as ordinary statements, shown before they run:

```sql
INSERT INTO platform.item_metadata (scope, schema_name, table_name, key, value)
VALUES ('workspace', 'newsroom', NULL, 'display_name', '"Newsroom"'::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;
```

The icon names are the platform's own, one stroke and one weight: `newspaper`, `globe`,
`building-2`, `briefcase`, `folder`, `database`, `boxes`, `book-open`, `graduation-cap`,
`landmark`, `factory`, `store`, `file-text`, `camera`, `film`, `audio-lines`, `clipboard-list`,
`list-todo`, `calendar-days`, `mail`, `message-square`, `bell`, `users`, `tags`, `star`,
`shopping-bag`, `package`, `truck`, `wallet`, `receipt`, `chart-column`, `map-pin`,
`pencil-ruler`, `megaphone`, `rss`, `lightbulb`, `wrench`, `puzzle`, `heart-pulse`, `scale`. A
name the platform does not draw falls back to the generic mark.

The colour is a family of the pinned palette: `orange`, `red`, `green`, `blue`, `amber`,
`indigo`, `mint`, `pink`, `steel`, `olive`, `purple`, `cyan`, `bronze`, `violet`, `teal`,
`clay`. A colour written as `#rrggbb` is drawn as the family nearest to it, so the interface
stays inside its own palette whatever the owner asks for. The colour fills the item's mark
alone — the workspace switcher's tile, a collection tile, the icon in a page header — and never
a heading, a border or a ground.

### Where a Field Appears

A field is drawn in three situations: the records grid, the record form and the filter
builder. The owner of a collection may say where a field belongs, in the reserved key `views`
of the field's own metadata:

```json
{ "list": "show", "record": "readonly", "filter": "hide" }
```

`list` and `filter` are `show` or `hide`. `record` is `show`, `readonly` — shown, but never
as an input — or `hide`. A field that carries no such key appears in all three.

Every field carries its own saying: the platform writes one when it makes a field, so where a
field appears is said of the field itself and not left to be inferred. A collection that was
made before this was true can be given the sayings it lacks, with one statement, from the
Data model page.

The saying is not limited to the three situations the interface draws. The owner of a
collection may name views of their own — an export, a print sheet, a screen of their own
making — and say whether the field appears in them:

```json
{ "list": "show", "record": "show", "filter": "show", "export": "hide" }
```

A view of the owner's own may be shown, hidden or shown and locked, and it is kept as it was
said: the platform holds it, hands it back, and draws the three situations it knows. The
drawing of a custom view is the deployment's business; the saying has a place to live, on the
field itself, under the same rights as every other key.

How the default views are changed, how a view of your own is added, and how a field is
pointed at a view other than the default is told in full in [views](views.md).

The saying is metadata like any other, so PostgreSQL's own row security decides it: whoever
holds a right on the column reads it, and only the owner of the collection changes it. It
narrows the interface and grants nothing.

The interface honours it in the three places. The grid shows the fields whose list is
`show`. The record form shows the fields whose record is not `hide`, locks the ones whose
record is `readonly`, and says which fields the owner keeps out of it. The filter builder
offers the fields whose filter is `show`. The search still reads every readable column: a
search is a question to the database, not a view of it.

### How a Field is Drawn

Where a field appears is one half of the saying; how its values are drawn is the other. A
value is not one thing drawn one way: the same column is a cell in the records grid, a value
in the record form and a value in the filter builder, and each of those may want a different
drawing. A uuid is eight characters in a cell and thirty-six in a record. A JSON document is
a clipped line in a cell and a document in a record.

The owner of a collection may say so, in the reserved key `renderers` of the field's own
metadata:

```json
{ "list": "truncate", "record": { "renderer": "template", "options": { "template": "» {value}" } } }
```

Each entry names a renderer — one the platform holds, or one the installation added — and,
where it takes any, the options it is given.

The platform's own default already draws a value differently in each place: a text is clipped
in the grid and wrapped in the record, a number is written in digits in the grid and with its
thousands marked in the record, a moment is shortened to the minute in the grid and whole in
the record, a uuid is eight characters in the grid and whole in the record, a JSON document is
a line in the grid and a document in the record. The saying is for what the default does not
answer.

A renderer the field names that the platform does not hold, or that does not fit the kind of
value, draws nothing: the value is drawn as the platform draws it. A renderer draws and
nothing else — it never decides who may read a value and never changes one.

How the renderers are named, which ones the platform holds, and how one of the installation's
own is added is told in full in [renderers](renderers.md).

## config.json

The pages are static, so what they need to find the issuer and the database is a file served
beside them, read once at start (`packages/ui/src/config.ts`). It is a file in the published site, so
a deployment changes it without rebuilding the bundle.

The file belongs to the site, not to the interface: the interface says nothing about where it
runs. Three things say it, in this order — the platform's own defaults
(`defaultRuntimeConfig` in `packages/ui/src/config.ts`), the site itself (a `config.json`
beside its `platform.json`, as `examples/newsroom/config.json` has), and the environment the
deployment runs in (`PLATFORM_ISSUER`, `PLATFORM_RELAY_URL`, `PLATFORM_CLIENT_ID`,
`PLATFORM_CLAIM`, `PLATFORM_DATABASE_NAME`, `PLATFORM_STATEMENT_TIMEOUT_MS`). The build
writes the result into the site, so a deployment changes it without rebuilding the bundle.

| Field                | Example                       | Purpose                                                    |
| -------------------- | ----------------------------- | ---------------------------------------------------------- |
| `issuer`             | `https://sso.example.com/dex` | The one OpenID Connect issuer PostgreSQL trusts: your Dex  |
| `clientId`           | `platform-console`            | The public client the page signs in with                   |
| `claim`              | `email`                       | The token claim PostgreSQL matches against the role name   |
| `relay`              | `wss://relay.example.com`     | The relay's WebSocket; a path is resolved against the page |
| `database`           | `platform`                    | The database Platform is installed in                      |
| `statementTimeoutMs` | `15000`                       | Sent as `statement_timeout` with each login                |

A relative `relay` becomes `ws://` on an `http` page and `wss://` on an `https` one. An
absolute `ws://` or `wss://` address is used as it is, which is what a site on a CDN needs:
the relay is a different origin from the pages.

## Publishing the site

The interface is files, not a container. `bun run build:ui` writes `packages/ui/dist`: one HTML file
per page, the client bundle, the styles, the fonts, `config.json` and `_headers`. A CDN
serves that directory; there is nothing to run. `deploy/cdn/README.md` has the details.

The deployment's names live in `config.json` and in the headers, not in the bundle, so one
build serves every deployment. The build reads them from the environment:

| Variable                      | Default                   | Purpose                                                   |
| ----------------------------- | ------------------------- | --------------------------------------------------------- |
| PLATFORM_PUBLIC_URL           | http://localhost:5173     | The address people open; the only origin the relay allows |
| PLATFORM_ISSUER               | http://localhost:5556/dex | Your Dex, the issuer PostgreSQL trusts                    |
| PLATFORM_CLIENT_ID            | platform-console          | The public client the pages sign in with                  |
| PLATFORM_CLAIM                | email                     | The claim that names the role; must match the validator's |
| PLATFORM_RELAY_URL            | ws://localhost:8081       | The relay the pages open their sessions through           |
| PLATFORM_DATABASE_NAME        | platform                  | The database Platform is installed in                     |
| PLATFORM_STATEMENT_TIMEOUT_MS | 15000                     | Sent with each login as `statement_timeout`               |

## The relay image

The `relay` image (Dockerfile target `relay`, based on `oven/bun`) is the only part of the
interface's path that answers on the network. It is configured from the environment:

| Variable                   | Default        | Purpose                                               |
| -------------------------- | -------------- | ----------------------------------------------------- |
| RELAY_UPSTREAM             | 127.0.0.1:5432 | host:port of PostgreSQL                               |
| RELAY_PORT                 | 8081           | The port the relay listens on                         |
| RELAY_ORIGINS              | any            | Comma-separated origins allowed to open a session     |
| RELAY_SESSIONS_PER_ADDRESS | 20             | Logins one client address may have signing in at once |
| RELAY_SESSIONS_PER_ROLE    | 20             | Open sessions one role may hold                       |
| RELAY_TLS_CERT             | none           | The certificate the relay serves TLS with             |
| RELAY_TLS_KEY              | none           | Its key                                               |

`/health` answers `ok` without touching the database. The image holds no database
credentials and no OAuth client secret. Put it behind TLS: an ingress controller, a load
balancer, a tunnel, or the relay itself with a certificate.

## The browser surface

- **The token lives in page memory only.** It is not written to localStorage, sessionStorage
  or a cookie, so a reload or a new tab starts signed out. sessionStorage holds the PKCE
  verifier across the redirect to Dex and is cleared when the page returns. The page is a
  public client and has no client secret. XSS or a compromised page could still read the
  in-memory token, as it could in any single-page application.
- **Content security policy.** Every page is sent `default-src 'self';
  script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'
  <relay origin> <issuer origin>; frame-ancestors 'none'; base-uri 'none';
  form-action 'self'`, with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  and HSTS. There is no inline script and no third-party asset: the fonts are bundled. Pages
  are sent with `Cache-Control: no-cache` and `config.json` with `no-store`. The headers are
  written by `packages/ui/src/headers.ts`, in the `_headers` file a CDN reads.
- **Origin check.** The relay refuses a handshake whose Origin is not one of
  `RELAY_ORIGINS`, so another site's page cannot open a database session through a visitor's
  browser. A handshake with no Origin at all is refused too when the list is not empty.
- **Session cap.** One open WebSocket is one database session. The relay caps how many open
  sessions one role may hold (RELAY_SESSIONS_PER_ROLE), and how many logins one client address
  may have signing in at once (RELAY_SESSIONS_PER_ADDRESS); behind a proxy, every client shares
  the proxy's address. The role is the one PostgreSQL reports, so a client cannot claim a role it
  has not been signed in as. Size PostgreSQL's `max_connections` and per-role connection
  limits accordingly.
- **statement_timeout.** Each login asks for STATEMENT_TIMEOUT_MS. It is a session setting the
  reader may change with SET on their own connection, not a resource boundary; set role or
  database defaults and connection limits in PostgreSQL where it matters.
- **What the relay can see.** The relay carries the whole protocol stream: the token in
  the login, every statement and every row. Between the browser and the relay the stream is
  inside the deployment's WSS. Between the relay and PostgreSQL it is plain TCP: the browser
  cannot negotiate PostgreSQL's TLS inside the stream. The relay must therefore run next to
  PostgreSQL or on a private network you trust: the same host, the same pod network, a service
  mesh with mTLS, or a tunnel. Whoever controls the relay or that network can read tokens in
  flight and use them until they expire.
- **Only tokens from the relay's network.** PostgreSQL's image takes PLATFORM_TOKEN_ONLY_FROM, a
  list of CIDR blocks from which a login is by token or not at all, written before the
  administrator's password rule. Set it to the relay's addresses, so that nobody, the
  administrator included, logs in with a password through the relay.

## Dev mode

`bun run examples:newsroom:dev` (packages/cli) builds the dev-mode interface into
`examples/newsroom/.dist` and serves it on http://localhost:5173 (PORT to change). Every change
under `packages/ui/src` — or under `examples/newsroom` — rebuilds the pages; reload to see it.

The CLI reads `platform.json` from the directory it is pointed at. That file is how the
example says what it is: the mode it is built in, the module that is the database, the module
that holds its own field types and renderers, and where the site is written.

```json
{ "mode": "development", "database": "database.ts", "extensions": "extensions.tsx", "out": ".dist" }
```

`extensions` is optional, and it is read in either mode: the build puts the module it names
in the place of `packages/ui/src/extensions.ts`, which is empty, so what the site registers
is in the prerendered pages and in the bundle. See [renderers](renderers.md) and
[fields](fields.md).

`bun run cli ui build` and `bun run cli ui dev` take the same file, in the working directory or
in `--dir=DIR`. Without one, the interface is built as it is published: the real one, with the
relay and the issuer.

In it, PostgreSQL 18 runs inside the page: PGlite (`@electric-sql/pglite`, a dependency of the
example package),
installed with the real `migrations/*.sql` and seeded by `examples/newsroom/seed.sql`. The seed is
what the example manifest and the CRM model would leave behind, with rows: the newsroom
workspace with sections, articles and corrections and its grants and policies; the crm
workspace, owned by the group `sales`, with accounts, contacts and deals and real foreign
keys; revisions and metadata. The sign-in page offers the three example people, admin, alice
and bob. Choosing one logs that role in with `SET SESSION AUTHORIZATION`, so grants, row
policies and triggers apply as they would on a server. Signing in as someone else reloads the
page, and the database is kept in IndexedDB across reloads. Clearing the site's storage
forgets it: the next load starts from the seed again.

The swap happens at build time: a Bun plugin replaces `packages/ui/src/pg/connect.ts` with
`examples/newsroom/database.ts`, so PGlite never reaches the production bundle. The example is a
package of its own (`examples/newsroom/package.json`): it depends on `@platform/ui`, and it is the
only thing that knows PostgreSQL runs in the page. What it holds is its configuration
(`platform.json`): the mode it is built in, the module that is the database, the module that
holds its own renderers (`extensions.tsx`), and where the site is written. The people who sign in without an issuer come from the example too — the people, the
words the sign-in page says, and the storage that keeps the choice between reloads. The
interface asks the seam who may sign in and how, and the production seam has none. The
dev-mode server's CSP adds `'wasm-unsafe-eval'` to `script-src`, there only, because PGlite is
WebAssembly.

`bun run examples:newsroom:dev --relay=HOST:PORT` serves the real build from `packages/ui/dist` instead and forwards
`/pg` WebSockets to a PostgreSQL at HOST:PORT, byte for byte, as the deployment's relay does.
Sign-in then goes through the issuer in `examples/newsroom/config.json`. Use it to work
against the local stack.
