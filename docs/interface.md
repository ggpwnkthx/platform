# Interface

The interface is a static site in `packages/ui/`. Its pages are generated at build time, and the client
in them speaks PostgreSQL's own wire protocol: it logs in to PostgreSQL with the reader's token,
runs ordinary SQL as the reader, and lets PostgreSQL decide every right. There is no application
server, no `/api` and no session of the interface's own. The same rules apply in psql, the CLI
and any other client.

## Pages

`bun run build:ui` prerenders every page with `preact-iso` into `packages/ui/dist`, beside one client
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

## How the page reaches PostgreSQL

`packages/ui/src/pg/wire.ts` is a PostgreSQL client for protocol version 3, written for the page:

- Login is OAUTHBEARER (RFC 7628) with the reader's own token, as the role the token's claim
  names. PostgreSQL's validator checks the token's signature, issuer and expiry; the page
  verifies nothing about it.
- Statements use the extended query protocol: exactly one statement per query, every value
  bound as a parameter, results in text format.
- The startup message sends `statement_timeout` (STATEMENT_TIMEOUT_MS from `config.json`) and
  `idle_in_transaction_session_timeout`, and the application name `platform-ui`.

In a browser, the protocol travels over a WebSocket (`packages/ui/src/pg/socket.ts`) to the relay, at
the address `config.json` names (`wss://relay.example.com`). The relay (`packages/relay/src/relay.ts`, the
`relay` image) hands the bytes to PostgreSQL's port and understands none of them. It holds no
credentials and reads nothing it carries: the reader's token travels inside the PostgreSQL
startup packet, and PostgreSQL alone checks it.

Each action opens one login and closes it (`withDb` in `packages/ui/src/session.tsx`): loading a page's
data, saving a record, running a statement. One connection per action, always closed. Session
state such as SET ROLE or an open transaction does not survive into the next action. A token
that has expired signs the reader out before a connection is attempted; a login PostgreSQL
refuses signs them out with PostgreSQL's message.

What the page runs is ordinary SQL, all of it in `packages/ui/src/db/platform.ts` and
`packages/ui/src/db/model.ts`:

- The catalog, from PostgreSQL's privilege functions (`has_table_privilege`,
  `has_column_privilege`, `has_schema_privilege`, `pg_has_role`).
- Roles and memberships through `platform.visible_roles()` and `platform.visible_memberships()`,
  which answer for the reader alone; row policies from `pg_policies`; grants from the ACLs
  through `aclexplode`; activity from `platform.activity`.
- Records with filters, search, sort, `LIMIT`/`OFFSET` and a `count(*)` under the same
  predicate.
- Inserts, updates and deletes without RETURNING: the right to write a column is not a right
  to read it back, so a write reports how many rows it touched. An update made from a record
  the reader opened is guarded by its version (`WHERE id = $n AND version = $m`). When it
  touches no row, the page reads the record again: a newer version means someone changed it
  since it was opened, otherwise a row policy refused the change or the row is gone, and the
  page says "PostgreSQL changed no row".
- Metadata in `platform.item_metadata`.
- DDL and DCL built by `packages/ui/src/db/model.ts`: workspaces, collections, fields, grants, row
  policies, memberships and roles.

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
a collection may say how it should be read. It is stored in `platform.item_metadata`, one row
per key per item, and PostgreSQL decides who reaches it (see [access](access.md#metadata)). A
reader is shown the keys they may see and nothing for the rest; a write by anyone but the
owner is refused by PostgreSQL. A value is any JSON value. A change to a key the reader opened
is guarded by its version, as a record is.

## config.json

The pages are static, so what they need to find the issuer and the database is a file served
beside them, read once at start (`packages/ui/src/config.ts`). It is a file in the published site, so
a deployment changes it without rebuilding the bundle.

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

| Variable                   | Default        | Purpose                                           |
| -------------------------- | -------------- | ------------------------------------------------- |
| RELAY_UPSTREAM             | 127.0.0.1:5432 | host:port of PostgreSQL                           |
| RELAY_PORT                 | 8081           | The port the relay listens on                     |
| RELAY_ORIGINS              | any            | Comma-separated origins allowed to open a session |
| RELAY_SESSIONS_PER_ADDRESS | 20             | Open sessions one client address may hold         |
| RELAY_TLS_CERT             | none           | The certificate the relay serves TLS with         |
| RELAY_TLS_KEY              | none           | Its key                                           |

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
  written by `packages/ui/scripts/headers.ts`, in the `_headers` file a CDN reads.
- **Origin check.** The relay refuses a handshake whose Origin is not one of
  `RELAY_ORIGINS`, so another site's page cannot open a database session through a visitor's
  browser. A handshake with no Origin at all is refused too when the list is not empty.
- **Session cap.** One open WebSocket is one database session. The relay caps how many one
  client address may hold at once (RELAY_SESSIONS_PER_ADDRESS); behind a proxy, every client
  shares the proxy's address. Size PostgreSQL's `max_connections` and per-role connection
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

## Development

`bun run dev:ui` (packages/ui/scripts/dev.ts) builds the development interface into `packages/ui/dist-dev` and
serves it on http://localhost:5173 (PORT to change). Every change under `packages/ui/src` rebuilds the
pages; reload to see it.

In it, PostgreSQL 18 runs inside the page: PGlite (`@electric-sql/pglite`, a devDependency),
installed with the real `migrations/*.sql` and seeded by `packages/ui/src/dev/seed.sql`. The seed is
what the example manifest and the CRM model would leave behind, with rows: the newsroom
workspace with sections, articles and corrections and its grants and policies; the crm
workspace, owned by the group `sales`, with accounts, contacts and deals and real foreign
keys; revisions and metadata. The sign-in page offers the three example people, admin, alice
and bob. Choosing one logs that role in with `SET SESSION AUTHORIZATION`, so grants, row
policies and triggers apply as they would on a server. Signing in as someone else reloads the
page, and the database is kept in IndexedDB across reloads. Clearing the site's storage
forgets it: the next load starts from the seed again.

The swap happens at build time: a Bun plugin replaces `packages/ui/src/db/connect.ts` with
`packages/ui/src/dev/database.ts`, so PGlite never reaches the production bundle. The development
server's CSP adds `'wasm-unsafe-eval'` to `script-src`, there only, because PGlite is
WebAssembly.

`bun run dev:ui --relay=HOST:PORT` serves the real build from `packages/ui/dist` instead and forwards
`/pg` WebSockets to a PostgreSQL at HOST:PORT, byte for byte, as the deployment's relay does.
Sign-in then goes through the issuer in `ui/public/config.json`. Use it to work against the
local stack.
