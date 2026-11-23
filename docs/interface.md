# Interface

The interface is a static site in `packages/ui/`. Its pages are generated at build time, and the client
in them speaks PostgreSQL's own wire protocol: it logs in to PostgreSQL with the reader's token,
runs ordinary SQL as the reader, and lets PostgreSQL decide every right. There is no application
server, no `/api` and no session of the interface's own. The same rules apply in psql, the CLI
and any other client.

## Pages

`bun run build:ui` builds the interface with Vite into `packages/ui/dist`: one bundle and its
styles under `assets/`, the self-hosted Inter and JetBrains Mono fonts, `config.json` and
`_headers`. Each page is its own file — a copy of the one document — so a bookmark, a new tab
and a reload all land on a real page with no rewrite rule on the CDN; inside the app, links
move between pages without a reload, which is what keeps the token in memory.

| Page                  | Module     | What it is for                                                   |
| --------------------- | ---------- | ---------------------------------------------------------------- |
| `/`                   |            | Sign-in                                                          |
| `/content`            | Content    | The collections of the workspace in view, as an entry point      |
| `/content/records`    | Content    | The records of a collection: search, filters, sort, pages, count |
| `/content/item`       | Content    | One record: read it, edit it, delete it, or write a new one      |
| `/model`              | Data model | The collections of the workspace and their shape                 |
| `/model/collection`   | Data model | One collection: its fields, its metadata, and its access         |
| `/model/new`          | Data model | A new collection, with its fields                                |
| `/workspace/new`      |            | A new workspace (a schema)                                       |
| `/workspace/settings` |            | The workspace in view: its metadata and who may use it           |
| `/access`             | Access     | The roles the reader may see, and a new role                     |
| `/access/role`        | Access     | One role: memberships, what it may do in the workspace, policies |
| `/access/grants`      | Access     | The workspace's permissions: who may use it, and every grant     |
| `/access/policies`    | Access     | The row policies of the workspace's collections: new, changed    |
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

The page speaks PostgreSQL's protocol, version 3, with node-postgres's own implementation of
it: Neon's serverless driver, which is node-postgres carried over a WebSocket
(`packages/ui/src/connect.ts`). The one thing added is the token login, which neither driver
has yet (`packages/core/src/token-client.ts`), and the operator's tools use the same addition:

- Login is OAUTHBEARER (RFC 7628) with the reader's own token, as the role the token's claim
  names. PostgreSQL's validator checks the token's signature, issuer and expiry; the page
  verifies nothing about it.
- Statements use the extended query protocol: exactly one statement per query, every value
  bound as a parameter, results in text format.
- The startup message sends `statement_timeout` (STATEMENT_TIMEOUT_MS from `config.json`) and
  `idle_in_transaction_session_timeout`, and the application name `platform-ui`.

In a browser, the protocol travels over a WebSocket (`packages/ui/src/connect.ts`) to the relay, at
the address `config.json` names (`wss://api.platform.example.com`). The relay (`packages/relay/src/relay.ts`, the
`relay` image) hands the bytes to PostgreSQL's port and understands none of them. It holds no
credentials: the reader's token travels inside the PostgreSQL startup packet, and PostgreSQL
alone checks it. The one thing the relay reads is the first packet of a session, which must
be a login.

The page keeps its logins in the driver's pool (`packages/ui/src/connect.ts`): one login when
the reader signs in, closed when the sign-in ends or the token expires. Every action the platform runs — loading
a page's data, saving a record, running a statement — runs on it, and a second action running
at the same time gets a login of its own rather than waiting. A login the server has closed is
opened again the next time; a login whose session has been broken is thrown away. The reader's
own statements (`packages/ui/src/activity/sql.tsx`) run on a login of their own that is closed again
afterwards, so a transaction or a SET ROLE they leave open cannot reach the platform's work. A
token that has expired signs the reader out before a connection is attempted; a login
PostgreSQL refuses signs them out with PostgreSQL's message.

What the page runs is ordinary SQL, and the questions are the platform's own, in
`packages/core`, so that the same question may be asked of another source and mean the same
thing:

- The catalog (`packages/core/src/catalog/`), from PostgreSQL's privilege functions
  (`has_table_privilege`, `has_column_privilege`, `has_schema_privilege`, `pg_has_role`).
  The platform's own schema is in it, as a workspace of another kind (`kind: 'system'`): the
  switcher lists it as **Platform**, after the installation's workspaces, and its tables —
  `activity` and `installation` — are system collections, drawn by the same
  records grid, record form and data model page as any other. PostgreSQL's row security
  decides which rows reach the reader, and the catalog never says the reader may change its
  model, whoever they are: that is the migrations' to do. Nobody lands in it; it is in view
  when it is chosen.
- What a role may do (`reach`, `schemaReach` in `packages/core/src/access.ts`): PostgreSQL's
  privilege functions asked of that role, for the roles the reader may see and the ones the
  workspace's ACLs name.
- Roles and memberships (`packages/core/src/access.ts`) through `platform.visible_roles()` and
  `platform.visible_memberships()`, which answer for the reader alone; row policies from
  `pg_policies`; grants from the ACLs through `aclexplode`; the revisions
  (`packages/core/src/access.ts`) from `platform.revisions`, where each logged row holds
  the columns the reader may read and no others.
- Records (`packages/core/src/records.ts`) with filters, search, sort, `LIMIT`/`OFFSET` and a
  `count(*)` under the same predicate.
- Inserts, updates and deletes without RETURNING: the right to write a column is not a right
  to read it back, so a write reports how many rows it touched. An update made from a record
  the reader opened is guarded by its version (`WHERE id = $n AND version = $m`). When it
  touches no row, the page reads the record again: a newer version means someone changed it
  since it was opened, otherwise a row policy refused the change or the row is gone, and the
  page says "PostgreSQL changed no row".
- Metadata (`packages/core/src/metadata.ts`) in `platform.item_metadata`.
- DDL and DCL built by `packages/ui/src/model/` and `packages/ui/src/access/`: workspaces,
  collections, fields, grants, row policies, memberships and roles. The statements
  themselves are the platform's own, in `packages/core`, so that the operator's tools and
  the interface grant the same rights the same way.

## Access, from wherever it is asked about

Access is one thing — PostgreSQL's ACLs, memberships and row policies — read from four places,
and drawn the same way in each: a privilege is PostgreSQL's own name with a full, half or empty
mark, and a half mark says how many fields it covers.

- **A role** (`/access/role`). What the role may do in the workspace in view is PostgreSQL's own
  answer for it (`has_table_privilege`, `has_any_column_privilege`, `has_schema_privilege`, asked
  of that role), so a right held through a group or through PUBLIC counts, and a last column says
  where each comes from: its own grants, or the groups it inherits from. The row policies listed
  are the ones that apply to it by name, through a group, or as PUBLIC.
- **A workspace** (`/access/grants`, and the same panel in `/workspace/settings`). Who holds
  USAGE and CREATE on the schema, and for every collection the roles its ACL names and what each
  holds. A row is one role on one collection, and opens the grant it draws.
- **A collection** (`/model/collection?tab=access`). The roles its ACL names; the roles that
  reach it through one of those without being named; who reads and writes each field; and its
  row security, with its policies. A policy is written, changed and dropped here, and row
  security is turned on and off here.
- **A field** (the key beside it, in the collection's Fields and Access tabs). The roles that
  hold SELECT, INSERT and UPDATE on the field, whether through the whole collection or by name.

The grant editor is the same wherever it is opened: one role on one collection, each privilege
not held, held on the whole collection, or held on chosen fields. What runs is the difference
between what the ACL records and what was asked for (`grantChangeStatements` in
`packages/core`). PostgreSQL's two levels do not mirror each other, and the editor writes
what they need: a privilege narrowed from the whole collection to fields is revoked on the
collection and granted on those fields by name; one widened from fields to the whole collection
gives its field grants up; one taken away is revoked on the collection, which takes its fields
with it. Taking one field away from a role that holds the whole collection — from the field's
own drawer — is the first of those, and the drawer says that a field added later will not be
among the ones named.

A grant on a collection is of no use without USAGE on the workspace, so the editor asks
PostgreSQL whether the role holds it and, when it does not, offers the workspace's owner the
`GRANT USAGE` in the same transaction; anyone else is told who grants it. A role is chosen by
name: the roles the reader may see are offered, and any other may be typed, since a collection's
owner may grant to a role PostgreSQL does not list for them.

A row policy that is changed is dropped and made again, in the one transaction every change
runs in: PostgreSQL alters a policy's roles and expressions in place but not what it is for, and
no statement ever sees the collection without the policy.

Nothing here is the interface's own answer. Whether the reader may change a grant is PostgreSQL's
to say when the statement runs; the interface offers the editors to a collection's owner, and
shows everyone else what the catalog shows them.

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
one collection of the platform's own — `platform.item_metadata` — one
row per key per item, and PostgreSQL decides who reaches it (see
[access](access.md#metadata)). A reader is shown the keys they may see and nothing for the
rest; a write by anyone but the owner is refused by PostgreSQL. A value is any JSON value. A
change to a key the reader opened is guarded by its version, because it is a record.

An item is a workspace (`schema`), a collection (`schema.table`) or a field of one
(`schema.table.column`). A field's metadata is as private as the field: PostgreSQL returns the
rows of the fields the reader holds a right on, and no others, so a reader who may not read a
column never learns what it is called. The interface reads a collection's fields in one
statement, and labels the fields it may read with their `display_name` when they have one.

### Metadata is a collection

The metadata of every item is kept in one table, `platform.item_metadata`, and that table is
a system collection: it is listed in the platform's own workspace, and the interface has no
second way of reading or changing it. Its model is the platform's — the interface offers no
change to its fields — and its rows are their owners'. What an item's page shows as its metadata is that collection,
filtered to the item (`packages/ui/src/metadata/panel.tsx`): read by
the question every collection is read by, and drawn by the fields every collection is drawn
by. A key is a link to its row, and **Add key** opens the ordinary record form with the names
of the item filled in; a row is changed and removed there, by its `id` and its `version`, as
every row is. **Open as a collection** shows the same rows in the records grid.

Three things about it are its own, and they are small:

- **What a row is about.** The item is named — a scope and the names of a schema, a table
  and a column — and not pointed at: the platform keeps no table of items, and metadata
  outlives its item. So the item is composed from the names (`metadataTargetOf`), not drawn
  as a relation.
- **The value.** It is a JSON column, typed as it is meant: a sentence is kept as a string
  and what reads as JSON as itself. That is a field type of that one column
  (`packages/ui/src/metadata/panel.tsx`), asked by the record form as any other is.
- **The keys the interface reads for itself.** `display_name`, `icon`, `color`, `views` and
  `renderers` have editors of their own, held in a registry that mirrors the field types'
  (`packages/ui/src/metadata/panel.tsx`). An editor is shown
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
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES ('workspace', 'newsroom', NULL, NULL, 'display_name', '"Newsroom"'::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
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

The file belongs to the deployment: neither the interface nor a site's `platform.json` says
where it runs. Two things say it, in this order — the platform's own defaults
(`defaultRuntimeConfig` in `packages/ui/src/config.ts`) and the environment the
deployment runs in (`PLATFORM_ISSUER`, `PLATFORM_RELAY_URL`, `PLATFORM_CLIENT_ID`,
`PLATFORM_CLAIM`, `PLATFORM_DATABASE_NAME`, `PLATFORM_STATEMENT_TIMEOUT_MS`). The build
writes the result into the site, and writes the `_headers` file from the same answer, so the
issuer the pages are sent to is the issuer the headers let them reach.

| Field                | Example                            | Purpose                                                    |
| -------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `issuer`             | `https://idp.platform.example.com` | The one OpenID Connect issuer PostgreSQL trusts: your Dex  |
| `clientId`           | `platform-console`                 | The public client the page signs in with                   |
| `claim`              | `email`                            | The token claim PostgreSQL matches against the role name   |
| `relay`              | `wss://api.platform.example.com`   | The relay's WebSocket; a path is resolved against the page |
| `database`           | `platform`                         | The database Platform is installed in                      |
| `statementTimeoutMs` | `15000`                            | Sent as `statement_timeout` with each login                |

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
| PLATFORM_ISSUER               | http://idp.localhost:5556 | Your Dex, the issuer PostgreSQL trusts                    |
| PLATFORM_CLIENT_ID            | platform-console          | The public client the pages sign in with                  |
| PLATFORM_CLAIM                | email                     | The claim that names the role; must match the validator's |
| PLATFORM_RELAY_URL            | ws://api.localhost:8081   | The relay the pages open their sessions through           |
| PLATFORM_DATABASE_NAME        | platform                  | The database Platform is installed in                     |
| PLATFORM_STATEMENT_TIMEOUT_MS | 15000                     | Sent with each login as `statement_timeout`               |

## The relay image

The `relay` image (Dockerfile target `relay`, based on `oven/bun`) is the only part of the
interface's path that answers on the network. It is configured from the environment:

| Variable           | Default        | Purpose                                               |
| ------------------ | -------------- | ----------------------------------------------------- |
| RELAY_UPSTREAM     | 127.0.0.1:5432 | host:port of PostgreSQL                               |
| RELAY_PORT         | 8081           | The port the relay listens on                         |
| RELAY_ORIGINS      | any            | Comma-separated origins allowed to open a session     |
| RELAY_UPSTREAM_TLS | see below      | `verify` or `off`; required unless on this machine    |
| RELAY_UPSTREAM_CA  | the system's   | The authority PostgreSQL's certificate must come from |
| RELAY_TLS_CERT     | none           | The certificate the relay serves TLS with             |
| RELAY_TLS_KEY      | none           | Its key                                               |

`/health` answers `ok` without touching the database. The image holds no database
credentials and no OAuth client secret. Put it behind TLS: an ingress controller, a load
balancer, a tunnel, or the relay itself with a certificate.

## The browser surface

- **The token lives in page memory only.** It is not written to localStorage, sessionStorage
  or a cookie, so a reload or a new tab starts signed out. sessionStorage holds the PKCE
  verifier across the redirect to Dex and is cleared when the page returns. The page is a
  public client and has no client secret. XSS or a compromised page could still read the
  in-memory token, as it could in any single-page application.
- **Content security policy.** Every page is sent `default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'
  <relay origin> <issuer origin>; frame-ancestors 'none'; base-uri 'none';
  form-action 'self'`, with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  and HSTS. There is no inline script and no third-party asset: the fonts are bundled. Styles
  may be inline because the component library (Mantine) styles elements that way; scripts may
  not. The dev mode alone adds `'wasm-unsafe-eval'`, for the PostgreSQL in the page. The
  headers are written by `packages/ui/src/config.ts`, in the `_headers` file a CDN reads.
- **Origin check.** The relay refuses a handshake whose Origin is not one of
  `RELAY_ORIGINS`, so another site's page cannot open a database session through a visitor's
  browser. A handshake with no Origin at all is refused too when the list is not empty. Unset
  (or `*`), the relay checks no origin, which is right where what is in front of it does. A
  platform's CORS settings are not that: a browser sends a WebSocket handshake from any page
  without asking, so only something that refuses the handshake by its Origin stands in for
  the list.
- **Session caps.** One open WebSocket is one database session, and the relay counts none of
  them: it forwards. The caps are kept by what already keeps them well. How many sessions one
  client address may hold open is the edge's: the local stack's Traefik holds each address to
  20 (`inFlightReq` in `deploy/traefik/dynamic.yaml`), and `deploy/k8s/ingress.yaml` does the
  same with `limit-connections`. How many one role may hold is PostgreSQL's own
  `CONNECTION LIMIT` (`connections` on a user in a manifest), which counts through every relay
  together. Size `max_connections` for the people who use the interface at once.
- **Logins that do not finish.** A session has no connection to PostgreSQL until it has sent
  a startup packet of protocol 3. One that opens with anything else is refused: a request
  for TLS inside the stream, for GSSAPI or to cancel a statement is not a login. A login that
  stalls after that is PostgreSQL's to close, with `authentication_timeout` (30 seconds in the
  stack's image).
- **A side that falls behind.** When the browser reads slowly the relay stops reading
  PostgreSQL, and when PostgreSQL reads slowly it stops reading the browser, so a large result
  or a large write waits in the sender instead of filling the relay's memory.
- **statement_timeout.** Each login asks for STATEMENT_TIMEOUT_MS. It is a session setting the
  reader may change with SET on their own connection, not a resource boundary; set role or
  database defaults and connection limits in PostgreSQL where it matters.
- **What the relay can see.** The relay carries the whole protocol stream: the token in
  the login, every statement and every row. Between the browser and the relay the stream is
  inside the deployment's WSS. Between the relay and PostgreSQL it is TLS with
  RELAY_UPSTREAM_TLS=verify, with which the relay opens that connection in TLS and checks
  PostgreSQL's certificate, and plain TCP with RELAY_UPSTREAM_TLS=off. The relay has to be
  told which, unless PostgreSQL is on its own machine. In the clear the relay must run next to
  PostgreSQL or on a private
  network you trust: the same host, the same pod network, a service mesh with mTLS, or a
  tunnel. Whoever controls the relay, or that network when it is in the clear, can read tokens
  in flight and use them until they expire.
- **No administrator through the relay.** PostgreSQL's image takes PLATFORM_TOKEN_ONLY_FROM, a
  list of CIDR blocks from which the administrator (PLATFORM_ADMIN) is refused outright. Set
  it to the relay's addresses, so that a token that names the administrator is not a way in
  through the relay. PLATFORM_ADMIN_FROM names the operators' networks instead, and the
  administrator is then refused from everywhere else. PLATFORM_HBA_DATABASES names the
  databases a token opens, so the relay reaches no other database of the same server.
  Nobody logs in with a password from anywhere: no login has one.

## Dev mode

`bun run examples:newsroom:dev` (packages/cli) builds the dev-mode interface into
`examples/newsroom/.dist` and serves it on http://localhost:5173 (PORT to change). Every change
under `packages/ui/src` — or under `examples/newsroom` — rebuilds the pages; reload to see it.

The CLI reads `platform.json` from the directory it is pointed at. That file is how a folder
says what it is, and every tool reads the same one (`packages/cli/src/site.ts`): the files
it applies to a database, and the module that holds its own field types and renderers.

```json
{
  "apply": {
    "models": "apply/models.ts",
    "migration": "apply/migration.sql",
    "demo": "apply/demo.sql"
  },
  "extensions": "extensions.tsx"
}
```

`apply` is what a folder brings a database to. `apply --dir` applies those files to a
deployment ([apply](apply.md)), and a build of the folder installs them in a PostgreSQL that
runs inside the page. `models` is required; the two SQL files are the folder's to leave out.

`extensions` is optional, and it is read by every build of the folder: the build puts the
module it names in the place of the module `virtual:platform-site` (`packages/ui/vite.config.ts`), which is empty, so what the
site registers is in the bundle. See [renderers](renderers.md)
and [fields](fields.md).

The file says what the folder is, and nothing else. How it is built is the command's to say:
`ui build` and `ui dev` build a folder that applies something with it installed in the page,
and `--production` (or `--relay` with `dev`) builds the published interface instead, the one
with the relay and the issuer. Where it runs is the deployment's to say, in its environment
(see [config.json](#configjson)). A key the file does not know is refused. The site is
written to `.dist` in the folder.

`bun run cli ui build` and `bun run cli ui dev` take the file in the working directory or
in `--dir=DIR`. Without one, the interface is built as it is published, in
`packages/ui/dist`.

In it, PostgreSQL 18 runs inside the page: PGlite (`@electric-sql/pglite`, a dependency of the
CLI, which builds the site),
installed with the real `migrations/*.sql` (the list `migrate` runs,
`packages/cli/src/cli.ts`) and then with the folder's own files, through the
same code a deployment applies them with (`packages/ui/src/inpage.ts`: the installation,
and the database the build puts in the seam, made of whichever folder's files it is handed): `models.ts` is
the schema, `migration.sql` is what a manifest cannot say, and `demo.sql` is the records and
their history. In the newsroom example they leave the newsroom
workspace with sections, articles and corrections and its grants and policies; the crm
workspace, owned by the group `sales`, with accounts, contacts and deals and real foreign
keys; revisions and metadata. The sign-in page offers the people `models.ts` names — admin,
alice and bob — each with what the manifest says of them: what they own, whether they
administer roles, and their groups. Choosing one logs that role in with `SET SESSION AUTHORIZATION`, so grants, row
policies and triggers apply as they would on a server. Signing in as someone else reloads the
page, and the database is kept in IndexedDB across reloads, under a name made from the
installation scripts and the folder's three files. A change to any of them is another name:
the next load installs them again, forgets the database of the earlier build, and with
it what was written in the page. Clearing the site's storage does the same.

The swap happens at build time: a Bun plugin loads `packages/ui/src/connect.ts` as a module
that imports the files `apply` names and hands them to `packages/ui/src/inpage.ts`, so
PGlite never reaches the production bundle and nothing is written in the folder to make it
so. The newsroom example is a package of its own (`examples/newsroom/package.json`) so that its
extensions and its tests are compiled as its own; it holds no code that knows PostgreSQL
runs in the page. The interface asks the seam who may sign in and how — the people, the
words the sign-in page says, and the storage that keeps the choice between reloads — and the
production seam has none. The
dev-mode server's CSP adds `'wasm-unsafe-eval'` to `script-src`, there only, because PGlite is
WebAssembly.

`bun run examples:newsroom:dev --relay=HOST:PORT` serves the real build from `packages/ui/dist` instead and forwards
`/pg` WebSockets to a PostgreSQL at HOST:PORT, byte for byte, as the deployment's relay does.
Sign-in then goes through the issuer the environment names (`PLATFORM_ISSUER`), or the
platform's default, `http://idp.localhost:5556`. Use it to work against the local stack.
