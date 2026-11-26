# Interface

The interface is a static site: react-admin on Material UI, over a data provider that runs
on the reader's own PostgreSQL login. It has no server. Every page is assembled from the same
few building blocks, so a page cannot be inconsistent with another.

## Pages and addresses

The address is a hash, so one document serves every page with no rewrite rule on the CDN. The
schema in view is part of the address, and every link carries it.

| Address                                | Page                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `#/newsroom.articles`                  | The rows of a table. Search, filters, sort and page are in the address        |
| `#/newsroom.articles/<id>`, `…/create` | The row form                                                                  |
| `#/schemas/newsroom`                   | The schema: its tables, views, functions, types, access and metadata          |
| `#/schemas/newsroom/articles`          | The table's model: columns, links, keys, rules and triggers, access, metadata |
| `#/roles`, `#/roles/<role>`            | Roles; one role's memberships and its privileges                              |
| `#/activity/newsroom`                  | The revisions of the schema                                                   |
| `#/database`                           | Sessions, tables by size and their upkeep, extensions                         |
| `#/sql`                                | One statement, as the reader                                                  |

The frame is a module bar (Data, Roles, Activity, Database, SQL), a navigation pane, a sticky header,
and the page. The pane belongs to the modules read one schema at a time: in Data it holds
the schema switcher and the tables, in Activity the same tables choose whose
revisions are read, and Roles, Database and SQL have none. On a screen under 900px the pane is a
drawer behind a menu button. The foot of the module bar says who is signed in, and signs out.

The header carries the page's name and, at its right, what the page is for doing: its one
one primary action last (Insert row, Run), which keeps its words where there is room; the
others are icons with their names in a tip. A page too long to read at once is in tabs, and the
address says which (`?tab=Privileges`): a schema is Tables, Views, Functions, Types, Privileges
and Metadata; a table's definition is Columns, Constraints and indexes, Privileges and Metadata. A schema's
page and a table's model carry their own change and delete in the header: a rename or a
drop takes the reader to the address of what is left. An input's name stands above it, always.

## The building blocks

All of them are in `packages/ui/src/kit`. A page is made of these and nothing else.

- **Frame** and **Page** — the one frame, and a page as a heading (title, actions) and a
  stack of sections, in **Tabbed** parts where it is long.
- **Table** — the one table: react-admin's `DataTable` in a bordered card, with the first
  column pinned at the left and a row's actions at the right, values clipped at one width, and
  one way each of saying loading, empty and refused. Rows and every kind of thing are
  listed by it. An empty page says what emptied it: a search, a policy, or nothing.
- **Change** — the one way a change to the model or to access is made: a drawer holding the
  form, the statements the form writes, shown before the button that runs them, and
  PostgreSQL's answer. What runs is what is shown, in one transaction, as the reader.
- **Statement**, **Refusal**, **Empty**, **Section** — the SQL figure; a refusal in
  PostgreSQL's words with its SQLSTATE; an empty place and why; a section with a hairline.
- **Privilege**, **ItemMark**, **RoleName** — the marks of [DESIGN.md](../DESIGN.md).

Forms are react-hook-form through react-admin's inputs. Reads and writes go through TanStack
Query by way of react-admin's data provider.

## Kinds

Everything PostgreSQL holds beside rows — a column, a constraint, a row policy, a grant, a
role, a membership, a metadata entry, a revision — is a _kind_ (`data/kinds.ts`): how its rows
are read, how they are drawn, what its form asks, and the statements a change is.

```ts
export const policies = defineKind({
  name: 'policies',
  title: 'Row policies',              // the heading its table stands under, on any page
  note: 'A policy decides which rows a role reaches…',
  noun: 'row policy',
  read: (db, { schema, table }) => readPolicies(db, schema, table),
  columns: [{ source: 'name', label: 'Policy' }, …],
  may: ownsTable,                     // PostgreSQL's own answer, read from the catalog
  mayRow: (row, where, ctx) => …,     // the same answer, where it differs from row to row
  Inputs: () => <>…</>,               // react-admin inputs
  create: (form, where) => [policyStatement(…)],
  remove: (row, where) => [dropPolicyStatement(…)],
})
```

A kind may also say what removing one is called where it is not deleting (`removeWord: 'End'`
for a session), and that its statements cannot run inside a transaction (`atomic: false` for
VACUUM), when they run one after another and the first refused stops the rest.

`<KindTable kind={policies} where={{ schema, table }} />` is then the whole of a section: its
heading and note, the add action at the heading's right, the table, the change and remove
actions on each row, and the change surface. `may` decides only whether
a change is offered; PostgreSQL judges the statement.

## How the page reaches PostgreSQL

`session/connect.ts` opens the reader's login: Neon's serverless driver — node-postgres over a
WebSocket — with the token login added by `packages/core/src/token-client.ts`. A pool of two
keeps the login open; a transaction takes one to itself; the reader's own statement on the SQL
page runs on a login of its own. Every query is prepared, so a second statement in the text is
refused by the server (42601).

`data/provider.ts` is the data provider. A resource is a table (`schema.table`)
or a kind. Rows are read with their filters, search, sort, page and count under row
security; written without RETURNING; an update is guarded by the version the reader saw, and a
row policy that refuses it is said as such. Rows chosen in the grid are deleted in one
transaction, each under the version the grid showed. `run` executes the statements of a
change, and undoes them all if PostgreSQL warns that a GRANT or REVOKE changed nothing.

The SQL page runs one statement on Ctrl-Enter (⌘-Enter) or the Run button, and shows
PostgreSQL's answer with what it said beside it: its warnings and notices, with their
SQLSTATE. As a script, the text is cut at the semicolons that end a statement — not inside a
string, a quoted name, a dollar-quoted body or a comment (`core/src/sql/split.ts`) — and each
is sent on its own, prepared, in one transaction that a refusal undoes. Explain shows a
statement's plan; with ANALYZE it runs the statement, measures it and rolls it back.

The grid saves what is in view as a CSV file: the columns the reader may read, under
the filters and the sort shown, up to 10,000 rows. A CSV file is added to a table by
matching its columns to the columns the reader may write, by name or by the name people read,
and shown before anything is written; each row is then an INSERT as the reader, in one
transaction, and an empty cell gives nothing so the column's default applies.

The Database page lists the sessions on the database (what another role's session runs is
PostgreSQL's to show: to that role, and to pg_read_all_stats), with a statement cancelled or a
session ended where PostgreSQL lets the reader; the tables the reader may reach by size,
with VACUUM, ANALYZE and REINDEX where they own it or hold MAINTAIN; and the extensions the
server offers, installed, updated and removed by whoever PostgreSQL lets.

The interface holds no permission of its own. react-admin's access-control layer is not used:
there is no `canAccess`. What is offered follows the catalog's answers (`can_select`,
`can_insert`, `can_update`, `can_alter`, `can_grant`, and the roles the session says the
reader `admits` to), and a refusal is shown as PostgreSQL said it.

## Sign-in

Authorization code with PKCE against the one configured issuer, by openid-client in the page,
as a public client. The token is held in memory and handed to PostgreSQL inside the login.
sessionStorage holds the PKCE verifier across the redirect and is cleared when the page
returns. react-admin's store is a memory store, and its telemetry is off. A reload starts
signed out.

## Building a site

A site folder builds the interface:

```ts
// vite.config.ts
import { site } from '@platform/ui/vite'
export default site(import.meta.dirname)
```

| Command, in the folder          | Result                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `vite`                          | The dev mode, served: PostgreSQL in the page, installed with the folder's SQL files |
| `vite build`                    | The published site in `.dist`: no in-page PostgreSQL                                |
| `vite build --mode development` | The dev mode as files                                                               |
| `vite preview`                  | The built folder, served with its headers                                           |

The build writes `config.json` (issuer, client, claim, relay, database) and `_headers` beside
the pages, from PLATFORM_ISSUER, PLATFORM_CLIENT_ID, PLATFORM_CLAIM, PLATFORM_RELAY_URL,
PLATFORM_DATABASE_NAME and PLATFORM_STATEMENT_TIMEOUT_MS. A deployment may replace
`config.json` without rebuilding. Two modules are provided by the build:
`virtual:platform-site` is the site's extensions and, in the dev mode alone, the in-page
PostgreSQL; `virtual:design-tokens` is DESIGN.md's own frontmatter.

## The browser surface

`_headers` carries a Content-Security-Policy of `default-src 'self'`, `script-src 'self'`,
`style-src 'self' 'unsafe-inline'` (Material UI writes its styles into the document),
`img-src 'self'`, `object-src 'none'`, `connect-src` limited to the site, the issuer and the
relay, `frame-ancestors 'none'`,
`base-uri 'none'` and `form-action 'self'`, with nosniff, no-referrer and HSTS. Only the dev
mode adds `'wasm-unsafe-eval'`, for the in-page PostgreSQL. Fonts are bundled, so the pages ask
no third party for anything.

## Dev mode

`bun run dev` serves the newsroom example with PostgreSQL 18 inside the page (PGlite),
installed with the real migration and the SQL files the folder's `platform.json` lists. The
page is the identity provider: the people offered are the roles that may sign in, read from
the in-page database, and choosing one makes the session theirs with `SET SESSION
AUTHORIZATION`. A statement from the SQL page leaves nothing of its session behind, as a
login of its own would not (`DISCARD ALL`), and one that leaves the session another role's is
rolled back and refused. That is not a full boundary: a single DO block can become the
superuser and switch back within itself. The data is kept in IndexedDB across reloads, and a
change to any installed file starts a fresh database. None of it reaches a published build.
