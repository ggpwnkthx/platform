# What the remakes replaced

Platform was rebuilt on other people's packages twice: the plumbing in 2.3.0, and the
application layer in 3.0.0. The premise did not change either time.

## 3.0.0: the application layer

The first remake left the application layer hand-written, and it grew back. Every page was
assembled by hand from component primitives, so each came out slightly different. This remake
replaced the layer with fewer, higher-level building blocks, and moved everything that a
standard tool already does out of our own code.

| What the platform wrote itself                                                   | What does it now                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tables, forms, filters, URL state, reference lookups, paging, page by page       | react-admin: one data provider over the page's own PostgreSQL login, one table, one form mechanism                        |
| A hundred `useState` calls of form state; writes outside TanStack Query          | react-hook-form through react-admin's inputs; every write a mutation                                                      |
| A drawer, a table and a toolbar written for each page of the model and of access | _Kinds_: each thing PostgreSQL holds is one definition, drawn by the one table and changed through the one change surface |
| Colours, sizes and inline styles at the point of use                             | A Material UI theme read from DESIGN.md's own frontmatter; a test refuses a value written anywhere else                   |
| The catalog and access questions, as SQL in TypeScript                           | Views and functions in the migration: psql gets the answers the interface gets                                            |
| A manifest format, and what converged a database on one                          | SQL files, run by psql                                                                                                    |
| `migrate`, `apply`, `model:apply`, `sql`, `doctor`, `lock`, `harden`, `token`    | psql 18, which signs in through Dex itself, and the SQL files in deploy/sql                                               |
| `ui build`, `ui dev`, `ui serve`; a copy of the document for every page          | `vite`, `vite build` and `vite preview` in the site's folder; one document, hash addresses                                |
| oidc-client-ts                                                                   | openid-client, in the page                                                                                                |
| A browser-test harness                                                           | Playwright's own runner                                                                                                   |
| Settings prompts, a YAML parser for the Kubernetes manifests                     | Defaults and `.env`; placeholders in the manifest                                                                         |

The relay, the token login and the SQL the platform writes stayed our own: nothing else does
them. Kysely's schema builder was considered for the DDL and not adopted: it writes keywords in
lower case, and a statement is shown to the reader before it runs, in one voice with the
GRANT, POLICY and ROLE statements it has no builder for.

### What behaves differently

- **Addresses are hashes.** `#/newsroom.articles/<id>` replaces `/data/item?ws=&c=&id=`. One
  document serves every page. Old addresses do not land.
- **The interface is Material UI, not Mantine.** A site's extensions import from
  `@mui/material` and `@platform/ui/extensions`; a field type's input is a react-admin input.
- **The version is 3.0.0**, and `migrations/0001_platform.sql` changed: it gained the views of
  the catalog and lost the upgrade step for earlier installations. Install a new database.
- **A new collection is made first, and its fields are added on its page.** The one-step
  composer of a collection with all its fields is gone.
- **A join table's keys are named after the collections they point at** (`articles`,
  `pitches`), and the table `articles_pitches`.
- **A field that says nothing of where it appears has no metadata row.** Only what narrows
  the default is written.
- **A locked field is shown as its value, not as a disabled input.**
- **The records grid opens newest first.**
- **Who is signed in is said at the foot of the module bar**, with the way out.
- **The guard reads the catalogs, not the statement.** It compares each collection before and
  after an ordinary role's DDL, so a comment, dynamic SQL, a renamed trigger, `DISABLE TRIGGER
  ALL` and `CREATE OR REPLACE TRIGGER` no longer pass it. It also refuses a rule on a
  collection and a child table of one, and a dropped collection leaves a revision of the drop.
- **Hardening hides `pg_group`** as well as the other role catalogs.
- **A GRANT or REVOKE that changes nothing is refused.** PostgreSQL only warns (01007, 01006);
  a change that draws the warning is rolled back and the warning shown.
- **Who may grant and admit is PostgreSQL's answer**: a right held WITH GRANT OPTION, a group
  held WITH ADMIN OPTION, not ownership or CREATEROLE alone.
- **Rows deleted together are each guarded by their version.**
- **The SQL page shows PostgreSQL's warnings and notices**, and Ctrl-Enter runs the statement.
- **The Content-Security-Policy is stricter**: `img-src` no longer allows `data:`, and
  `object-src` is `'none'`.
- **In the dev mode a statement from the SQL page leaves nothing of its session behind**, and
  one that leaves the session another role's is refused.
- **Screens under 900px have the navigation pane**, as a drawer behind a menu button.

### Not carried over

- Manifests, `apply`'s convergence, the `absent` state, the dry-run flag and JSON model
  import. A file is tried inside a transaction that is rolled back.
- `cli token` and every use of a token outside a browser or psql. psql's sign-in needs a
  person at a browser; automation beside the server uses the socket.
- Conditions on a field of the row a relation reaches (`through`), in the interface and in
  core. A filter asks which rows a record is linked to; the search still follows a relation to
  the name on the other side.
- Views of the owner's own beside the three the interface draws, and the backfill of a
  saying to fields that had none.
- What a link carries beside its two keys is not shown in the record form.
- A relation whose key points at a column other than `id` is typed as its value, not chosen
  by name.
- The warning a minute before a sign-in expires, and the page's own history of statements
  on the SQL page.
- The settings prompts of a first `deploy local`, and `deploy local admin`.

### Two remakes, compared

3.0.0 was made twice, independently, and this one took from the other what was better. The
other kept Mantine and wrote its pages by hand over one kit; its interface is 9,160 lines to
this one's 5,243, so the react-admin base stayed. What came over:

| From the other remake                                                       | Where it is now                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A guard that compares the catalogs before and after, with its bypass tests  | `deploy/sql/guard.sql`, `packages/cli/test/guard*.test.ts`       |
| `pg_group` hidden with the other role catalogs                              | `deploy/sql/harden.sql`                                          |
| A grant that changes nothing is a refusal                                   | PostgreSQL's own warning, raised by `unchanged` in core          |
| Who may grant and admit, asked of PostgreSQL                                | `can_grant` in the catalog views, `admits` in `platform.session` |
| Version-guarded bulk delete                                                 | `data/provider.ts`, `records/List.tsx`                           |
| Notices and warnings on the SQL page, Ctrl-Enter                            | `packages/core` drivers, `pages/Sql.tsx`                         |
| `img-src 'self'`, `object-src 'none'`                                       | `config.ts`                                                      |
| The dev mode's session kept the person's                                    | `session/inpage.ts`                                              |
| Backpressure from the browser to PostgreSQL; no SNI for an address          | `packages/relay`                                                 |
| Tabs on the model pages; actions in the page header; a pane for each module | `kit/Page.tsx`, `kit/Frame.tsx`, `kit/Pane.tsx`                  |
| Field names above their inputs; one-line rows with pinned actions           | `theme-components.ts`, `kit/Table.tsx`                           |
| The pane on a narrow screen; who is signed in                               | `kit/Frame.tsx`                                                  |
| An empty page that says what emptied it                                     | `kit/Table.tsx`                                                  |

Not taken, and why:

- **Mantine, nuqs and a page written out for each address.** They are the larger interface.
  Both remakes are static files; this one is a single document with hash addresses.
- **CodeMirror on the SQL page.** Seven more direct dependencies for highlighting and
  completion.
- **A relay with no session counters.** It is a hundred lines smaller, and leaves the caps to
  the edge and to PostgreSQL's `CONNECTION LIMIT`. The counters are a tested security
  property, so they stayed.
- **`platform token`, `platform sql` and `platform migrate`.** psql does all three; the CLI
  here only deploys.
- **Kustomize in place of `deploy k8s`.** It would remove about a hundred lines of the CLI
  and the settings that fill the manifest.
- **The one-step collection composer, conditions through a relation, custom views and the
  statement shown under a record form.** Each is a feature this remake cut or never had; none
  is smaller.

## 2.3.0: the plumbing

Platform 2.3.0 was rebuilt on packages other people maintain. The database
is the same — `migrations/0001_platform.sql` is unchanged, so an installation of 2.3.0 needs no
migration — and so are the premise, the commands and the pages. What changed is whose code
does the work.

| What the platform wrote itself                                   | What does it now                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A PostgreSQL wire client for the page (`packages/pg-client`)     | Neon's serverless driver: node-postgres over a WebSocket, and its pool                                      |
| The token login, twice (page and CLI)                            | One forty-line addition to both drivers (`packages/core/src/token-client.ts`)                               |
| SQL quoting, filters, record queries (`vocabulary`, `data`)      | Kysely, with no driver behind it                                                                            |
| The sign-in: discovery, PKCE, the code exchange                  | oidc-client-ts in the page, openid-client in the CLI                                                        |
| Widgets: grid, form, drawer, toasts, pickers; 3,600 lines of CSS | Mantine, mantine-datatable, lucide; a theme and 200 lines of CSS                                            |
| Routing, loading and reloading what is read                      | React Router, TanStack Query                                                                                |
| A bundler script, a prerenderer, a dev server with rebuilds      | Vite                                                                                                        |
| Argument parsing and help                                        | citty                                                                                                       |
| A relay that counted sessions per address and per role           | A relay that forwards, and counts them only when told to: the edge and PostgreSQL count as well (see below) |
| A terminal layer for questions and progress                      | clack                                                                                                       |

### What behaved differently in 2.3.0

- **Session caps are layered, and the edge's are the ones that count.** Sessions per client
  address are capped by the edge (Traefik `inFlightReq` in the local stack,
  `limit-connections` on the ingress), sessions per role by PostgreSQL's `CONNECTION LIMIT`, and
  stalled logins by `authentication_timeout`. The relay keeps its own caps as well, read from
  `RELAY_SESSIONS_PER_ADDRESS` and `RELAY_SESSIONS_PER_ROLE`; both are 0 — no limit — unless a
  deployment sets them, so a relay with no edge in front of it has no per-address cap of its own.
  `RELAY_SESSIONS_LOGGING_IN`, `RELAY_LOGIN_SECONDS` and `RELAY_TRUSTED_PROXIES` are gone.
- **Styles may be inline.** The Content-Security-Policy's `style-src` gained `'unsafe-inline'`,
  which Mantine needs. `script-src` is still `'self'`.
- **Pages are copies of one document** rather than prerendered one by one. Every address is
  still a real file.
- **A relation's constraint carries PostgreSQL's own name** (`<table>_<field>_fkey`) instead of
  a computed one. Existing constraints are found by their column, whatever their name.
- **A row policy's expression is checked by PostgreSQL alone.** The interface no longer parses
  it first; every statement is still sent as one prepared statement, so nothing can ride along.
- **`deploy local` does not edit the hosts file.** It prints the line to add.
- **Not carried over:** editors for an installation's own metadata keys
  (`registerMetadataKeyEditor`), and the reserved keys' editors under a row of
  `platform.item_metadata` in the record form. Renderers and field types are still registered
  from a site's extensions, now from `@platform/ui/extensions`.
- **The suite is smaller and needs no server.** See [validation](validation.md) for what was
  and was not verified.
