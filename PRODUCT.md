# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an application developer working inside their own workspace: their team owns
the schema, they build and ship against it, and the interface is where they model collections,
read and write records, grant access and run SQL.

The interface is confirmed to serve two audiences, and design must not be built against either
one of them alone:

- **Data entry users** — people whose job is the record: reading, creating, editing and
  correcting rows in the collections they are given. They work inside a workspace they do not
  own, and their rights are what PostgreSQL gives them.
- **Data security managers** — people whose job is who may do what: roles, groups,
  memberships, grants, column privileges and row policies. They read access where it belongs
  to the thing it belongs to, and they must be able to see a refusal and its reason.

The product also serves, and design must not be built against, these confirmed roles:

- **Workspace owner** — administers the model inside a workspace they own: creates collections and
  fields, and reads that workspace's full revision history.
- **Ordinary reader** — sees only what grants and row policies allow, cannot use the audit log to
  bypass column permissions, and must never own a table.
- **Cluster operator** — installs, migrates, hardens the role catalogs, deploys and diagnoses.
  Their work happens in the CLI, not the interface.

The platform is free and open-source software, delivered to other teams and customers, so
surfaces serve a real audience and not only the operators.

## Product Purpose

PostgreSQL is the identity and authorization system. A person is a PostgreSQL `LOGIN` role: they
prove who they are to Dex, which fronts the upstream sign-in systems and is the one issuer
PostgreSQL 18 trusts, and PostgreSQL checks that token itself during connection startup and logs
its holder in as the role named by their email claim.

There is no web process. The interface is a static site whose pages speak PostgreSQL's wire
protocol themselves, through a relay that forwards bytes and understands none of them. Nothing
between the page and PostgreSQL holds a database service account, an administrator password, a
user table, password hashes, session tokens, a policy cache or a privileged schema connection.
The page opens one PostgreSQL login with the reader's own token when they sign in, keeps it
open while they work, and closes it when the sign-in ends.

Success means one identity and one set of rules: what a person may do in the interface is
exactly what they may do in psql and in any other database client. Native roles,
grants and policies are the single source of access control.

The product is free software: there is no pricing, no paid tier and no commercial packaging,
and no future work may invent one. Success for the people who receive it means it runs their
data honestly and asks nothing of their PostgreSQL but the permissions their own roles hold.

## Positioning

The transport is the page and the relay, and neither is a policy authority. The page carries the
reader's own token into PostgreSQL's login; the relay carries bytes. Neither can manufacture
identity, cache a decision or grant a right PostgreSQL refused: every action connects as the
reader and lets the database judge. Nothing here is a shadow permission system
layered over PostgreSQL — roles, groups, memberships, column ACLs, row policies, constraints and
revisions are PostgreSQL's own, so the same installation is administered with psql, the CLI and
the interface alike.

What the platform does not claim to be is a database manager with privileges of its own. It is a
client of PostgreSQL that a data entry user and a data security manager can both sit in front
of, and it is honest about refusals rather than hiding them behind a policy layer it controls.

## Operating Context

- Requires Bun 1.4.3+ and PostgreSQL 18+ with an OAuth token validator (`pg_oidc_validator`),
  and installs into a dedicated PostgreSQL database with Dex beside it.
- The operator's tools are standard ones. Everything done to a database is a SQL file run by
  psql, which signs in through Dex itself (it prints an address and a code;
  `PGOAUTHDEBUG=UNSAFE` is needed only because the local Dex is plain HTTP):
  `migrations/0001_platform.sql` installs the platform, a site's `apply/*.sql` its schema and
  records, and `deploy/sql` holds `doctor.sql`, `harden.sql`, `guard.sql`, `restore.sql` and
  `administrator.sql`. `deploy/models/crm.sql` is a second schema, a CRM model with real
  foreign keys.
- The local stack (`bun run deploy local up`) builds the image under `deploy/postgres` and
  runs Dex, the relay and an edge next to it. Docker Compose and Podman Compose are detected
  automatically; `--engine=podman` chooses. It installs the database, what the site's folder
  applies, and the guard, with psql through PostgreSQL's own socket: PostgreSQL has no
  password, for anyone. It does not edit the hosts file: it prints the line to add.
- A deployment is named by a domain (`PLATFORM_DOMAIN`, `localhost` by default), and each
  service answers on its own sub-domain of it: `idp` for Dex (the issuer), `api` for the relay,
  `db` for PostgreSQL, and `app` for the site. The addresses and the ports follow from the
  domain and the sub-domains, so they are never asked for.
- The local Dex holds one account with a password — the break-glass administrator,
  `PLATFORM_ADMIN`, which is `admin` on the deployment's own domain (`admin@localhost`) unless
  another is named — and what it asks it for is generated into `.env`
  (`PLATFORM_ADMIN_PASSWORD`). It stands in for a real sign-in system; every other account
  comes from a provider added to Dex as a connector (`deploy/dex/config.yaml.tmpl`). The
  example's roles — the administrator, `alice@example.com`, `bob@example.com` — are roles, not
  accounts: who may sign in as them is the identity provider's business. A person can log in
  when a PostgreSQL role named after their email exists.
- The interface is a static site in `packages/ui/`, never built on its own: a site folder
  builds it with Vite (`vite build` in the folder → its `.dist`) and publishes it to a CDN: it
  is files, not a container. The build carries the self-hosted Inter and JetBrains Mono fonts,
  `config.json` and `_headers` beside one document. The address inside the interface is a
  hash, so a bookmark, a new tab and a reload all land on the page with no rewrite rule on the
  CDN, and links move between pages without a reload, which is what keeps the token in memory.
  The page opens a WebSocket to the relay in front of PostgreSQL and reads its issuer, client,
  claim, relay and database from `/config.json`. The access token lives in memory only, so a
  page load always starts signed out.
- **The stack** (the 3.0.0 remake): the interface is react-admin 5 on Material UI 9 and React
  19, with react-hook-form, TanStack Query, React Router 7, lucide and openid-client, talking
  to PostgreSQL over Neon's serverless driver; the SQL the platform says lives in
  `packages/core` on Kysely; the browser suite is Playwright's own runner; the deployment CLI
  and the relay have no dependency at all. Four things stay the platform's own because nothing
  else does them: the SQL it says and the questions it asks the catalog, the OAUTHBEARER token
  login over the drivers' own protocol code (`packages/core/src/token-client.ts`), the relay,
  and the migration. `migrations/0001_platform.sql` changed in this remake — it gained the
  views of the catalog — and nothing was in use to migrate.
- Development: `bun run dev` serves the newsroom example on http://localhost:5173 with
  PostgreSQL 18 running inside the page (PGlite), installed with the real migration and the
  SQL files the example's `platform.json` lists; the data is kept in the browser's IndexedDB
  across reloads. The example's `platform.json` says what the folder is — the SQL it applies
  and its extensions — and `examples/newsroom/extensions.tsx` registers the newsroom's own
  renderers through `@platform/ui/extensions`, so any build of the folder offers them beside
  the platform's own. `bun run check` builds the site, typechecks, lints, checks formatting
  and file size, and runs the tests.
- Testing: `bun test` needs nothing but Bun — the suites start PostgreSQL in memory (PGlite) and
  cover the security properties (catalog, rows and columns, version-guarded writes, audit
  privacy, grants, metadata, the guard), the SQL the platform writes, the page's connection
  and the relay, the operator's SQL files and the deployment's settings. `bun run test:e2e`
  drives the interface in Chrome, in the dev mode and as a published site behind the relay,
  under the site's own Content-Security-Policy.
- The remake was validated on 24 November 2026 (`docs/validation.md`), and that document names
  what was not verified — a token login against PostgreSQL 18, Dex itself, `deploy local up`,
  a Kubernetes rollout, psql's own sign-in, and the edge's session cap.
- The relay reaches PostgreSQL in plain TCP or in verified TLS, so in the clear it runs next
  to PostgreSQL or on a private network the operator trusts; PostgreSQL takes only tokens
  from the relay's addresses (`PLATFORM_TOKEN_ONLY_FROM`).
- Deployment is Docker Compose, Podman Compose or Kubernetes (`deploy/compose`, `deploy/k8s`),
  automated by `bun run deploy local` and `bun run deploy k8s`.
- Version 3.0.0; MIT licensed; free and open-source software.

## Capabilities and Constraints

**Terminology** (the product's own words; use them consistently):

- **Workspace** — a PostgreSQL schema. Its owner controls model administration.
- **Collection** — a table. Fields are columns; relations are foreign keys.
- **User** — a `LOGIN` role. **Group** — a `NOLOGIN` role. Membership lives in `pg_auth_members`.
- **Revision** — a trigger-logged row change, stored in `platform.activity` and read through
  `platform.revisions`, which shows a reader the columns of the row they may read.
- **platform** — the helper schema owned by `platform_core`. It is the one **system workspace**:
  its tables (`activity`, `revisions`, `installation`) are **system collections**, shown by
  the interface like any other and read under their own row security. Its model is changed by
  migrations, never from the interface.

**Capabilities**

- The interface (`packages/ui/`): a data studio in the manner of a headless CMS — a module bar
  (Data, Access, Activity, SQL), a navigation pane with the workspace switcher and the
  collections, and a sidebar with the collection's information, the reader's rights and the row
  policies that apply. Every page is made of the same building blocks: one table, one form
  mechanism, one change surface. Records, model inspection, runtime collection and field creation, roles,
  memberships, row policies, activity and one-statement SQL. The data module holds two views of
  a collection: its records, which is what comes up by default, and its model, behind the
  Data model button of its records page. It reads one workspace at a time:
  the workspace, the collection and the record are part of the address
  (`#/newsroom.articles/<id>`), links carry them, and every module presents that workspace
  alone.
- An access module that reads only what the caller may see (the roles they may use, their
  memberships, the cluster's policies, the grants in the workspace) and composes the GRANT,
  CREATE POLICY, membership and role statements for the caller to run. Access is read from a
  role, from a workspace, from a collection and from a field, and changed from any of them: the
  permissions belong to the thing they are about, and one editor writes the difference between
  what an ACL records and what is asked for, down to the fields a privilege is limited to.
  Every statement that changes the model or access is shown before it runs, then runs as the
  caller's own role in one transaction; the interface grants nothing, and PostgreSQL refuses it
  if they lack the authority. Refusals are shown with their SQLSTATE; withheld fields are marked
  hidden, write-only or read-only.
- Typed collection and field builders producing real CHECK, NOT NULL, UNIQUE, indexes and foreign
  keys; native `ALTER TABLE` for anything else, native views and joins for relationships.
- Metadata of a workspace, of a collection and of a field: what an item is, as opposed to what
  it holds. It is stored in the platform schema and gated by row security that asks
  PostgreSQL's own privilege functions, so a reader reaches the metadata of the items they may
  reach and only the owner of an item may change it. A field's metadata is secured by the
  field's own rights: whoever holds a right on the column reaches it, and nobody else does.
  Three keys of it are reserved for presentation: `display_name`, `icon` and `color`, so a
  workspace or a collection can carry the name people read, a mark of the platform's own icons
  and a colour, and the interface draws them wherever the item appears. A field is presented
  by its name alone, and that name labels the column wherever the interface shows it.
- A field that says where it appears: the records grid, the record form, the filter builder.
  The owner of a collection may keep a field out of one of them, or lock it in the record. It
  is the field's own metadata, so PostgreSQL's own rights decide who reads the saying and who
  changes it, and it grants nothing: PostgreSQL still decides who may read the field and who
  may write it. A column the database computes itself — a generated column, an identity
  column — is shown and never offered as an input.
- A record browser with named-operator filters, a case-insensitive search across the readable
  columns, sorting, paging with a row count, and updates guarded by the version the reader saw.
- A one-statement SQL page executing as the signed-in reader; native PostgreSQL checks every
  GRANT, REVOKE, CREATE ROLE, CREATE POLICY and DDL statement.
- Transactional row revisions from database triggers, including direct SQL writes and TRUNCATE.
  Owners read full revisions; ordinary readers cannot use the audit log to bypass column
  permissions.
- A schema as SQL files: users, groups, workspaces, collections, grants and policies, applied
  by psql in one transaction, and tried in one that is rolled back.
- The catalog and the access rules as views of the platform's own, so psql reads what the
  interface reads (`SELECT * FROM platform.catalog_tables`).
- A deployment CLI for Docker/Podman Compose and Kubernetes, and nothing else.
- Renderers and field types that a site registers for itself, through `@platform/ui/extensions`.

**Constraints**

- Nothing between the page and PostgreSQL connects as a service login, and nothing uses
  `SET ROLE` or `SET SESSION AUTHORIZATION` to manufacture user identity. (The dev-mode
  build's in-page PostgreSQL uses `SET SESSION AUTHORIZATION` to stand in for a token login; it
  never reaches a production bundle.)
- `platform_core` is `NOLOGIN` without `CREATEROLE`, `CREATEDB`, `SUPERUSER` or `BYPASSRLS`, and
  must never be granted to workspace administrators. `platform_users` is a `NOLOGIN` convenience
  group with no access to any workspace table.
- New collections have RLS enabled and no policies: grants alone never make rows visible. Owners
  administer their tables; ordinary users must never own them.
- `platform.create_collection` and `platform.stamp` run as SECURITY INVOKER; creating a table
  requires the caller's own CREATE privilege on the schema. `platform.record_change` is the only
  SECURITY DEFINER helper: it runs as `platform_core`, is trigger-only, and accepts no actor
  argument.
- One authenticated login for a sign-in, opened with the reader's token and closed when the
  sign-in ends; a transaction takes a login to itself, and the reader's own statement runs on
  a login of its own. One statement per query, always prepared, every value bound.
- Raw SQL executes with the caller's native authority. There is no sandbox and no allowlist:
  the `statement_timeout` sent with each login is a session setting, not a resource boundary.
- **Session caps are layered.** The relay counts the sessions one client address and one role
  may hold (`RELAY_SESSIONS_PER_ADDRESS`, `RELAY_SESSIONS_PER_ROLE`; `0`, no limit, by
  default). Behind an edge the address the relay sees is the edge's, so the edge's own cap is
  the one that counts the people: the local stack's Traefik holds each address to 20
  (`inFlightReq` in `deploy/traefik/dynamic.yaml`) and `deploy/k8s/ingress.yaml` does the same
  with `limit-connections`. How many one role may hold is PostgreSQL's own `CONNECTION LIMIT`
  (`ALTER ROLE ... CONNECTION LIMIT`), which
  counts through every relay together, and a login that stalls is closed by PostgreSQL's
  `authentication_timeout` (30 seconds in the stack's image). `RELAY_SESSIONS_LOGGING_IN`,
  `RELAY_LOGIN_SECONDS` and `RELAY_TRUSTED_PROXIES` are gone. A relay exposed with no edge in
  front of it and no caps of its own has no per-address limit.
- Role catalogs are visible to every connection by default; `deploy/sql/harden.sql` hides them from ordinary
  sessions while the interface keeps working. The local stack hardens itself as it installs.
- The guard (`deploy/sql/guard.sql`) compares each collection before and after an ordinary
  role's DDL, and refuses what turned its row security off or let writes pass by its history:
  a trigger dropped, disabled or changed, a rule, a child table. Everything else a table owner
  may do stays theirs.
- The audit table is append-only for ordinary roles, not tamper-proof against database owners,
  `platform_core` members or superusers. RLS is not a substitute for withholding table ownership.
- The metadata of every workspace is kept in one collection, `platform.item_metadata`, under
  forced row security. A row names its item by name: an item that is renamed leaves its
  metadata behind until a database administrator carries the rows across, and a workspace
  dumped by its schema does not take its metadata with it.
- Metadata is not audited in `platform.activity`; its rows carry their own `created_by`,
  `updated_by` and `version`, and a dropped collection leaves its metadata behind, unread.
- Writes return counts rather than `RETURNING *`.
- The browser surface: a strict CSP (`default-src 'self'`, `script-src 'self'`, `style-src 'self'
  'unsafe-inline'` — the component library writes its styles into the document —, `connect-src` limited to the
  site, the relay's origin and the issuer, `frame-ancestors 'none'`, `base-uri 'none'`), a
  WebSocket refused with 403 from any Origin but the site's own, and the layered caps on the
  open sessions one address and one role may hold: the relay's own, the edge's, and
  PostgreSQL's `CONNECTION LIMIT`.
- The relay to PostgreSQL leg is plain TCP and must stay on a network the operator trusts.
- A relation's constraint carries PostgreSQL's own name (`<table>_<field>_fkey`) rather than a
  computed one; an existing constraint is found by its column, whatever its name.
- A row policy's expression is checked by PostgreSQL alone: the page does not parse it first.
  Every statement is still sent as one prepared statement, so nothing can ride along.
- The interface keeps nothing outside memory: no localStorage, no cookie, react-admin's store
  in memory, its telemetry off. sessionStorage holds the PKCE verifier across the redirect, and
  in the dev mode the person chosen.
- react-admin's own access-control layer is not used: there is no `canAccess`. What is offered
  follows the catalog's answers, and PostgreSQL judges every statement.
- A file is at most 200 lines (`bun run lines`). The cap is a guard on what one file says, not
  a target to be met by splitting.
- Not carried into the remakes: manifests and `apply`; a token used outside a browser or psql;
  conditions on a field of the row a relation reaches; views of the owner's own; editors for
  an installation's own metadata keys. `docs/remake.md` lists them.

**Designed surfaces beyond the interface** (settled):

- The CLI's own output (`bun run deploy`) is a designed surface, held to the same care as the
  interface: what it prints is part of the operator's experience.
- `docs/` is a designed surface and must reflect the actual code and the end user's experience.

## Brand Commitments

One commitment is in force: the interface's visual reference is pinned by the user as "a
combination of Directus and Keystone" — a headless-CMS data studio at that level of craft, light
and dense. The pin remains the target that the design work pushes toward. Material UI, under
react-admin, is the library the interface is built on, not the visual reference: its defaults
are replaced by a theme read from DESIGN.md.

Beyond that, no name, voice, asset or personality has been declared binding. The product is
free and open-source software and goes by "Platform"; the interface carries its own title, and
`packages/ui/public/favicon.svg` is the only logo asset in the repository. The written voice
across the README and `docs/` is plain, declarative and technical — a statement of what the
system does, not of how it feels — which future work may keep or replace.

## Evidence on Hand

- Real content: the newsroom example (`examples/newsroom/platform.json`, `apply/schema.sql`,
  `apply/demo.sql`, `extensions.tsx`), `deploy/models/crm.sql`, the product documents in
  `docs/`, and the built site in `examples/newsroom/.dist`.
- Real demonstrations: the dev mode with its three people; the local stack with its
  break-glass administrator; `bun test` and the browser scenarios of `bun run test:e2e`;
  `deploy/sql/doctor.sql`; `docs/validation.md`, which states plainly what the remake was and
  was not verified against.
- No testimonials, customer names, logos, press, case studies, pricing, usage metrics or
  benchmarks exist. Future work must not fabricate any of them.

## Product Principles

1. **PostgreSQL decides.** The transport never grants a right, caches a permission or
   manufactures an identity; every action connects as the caller and lets the database judge.
2. **One login, every client.** The same sign-in works in the interface, psql, the CLI and any
   other client, and the token is never stored.
3. **Native over bespoke.** Roles, groups, ACLs, RLS, revisions and constraints are
   PostgreSQL's own, so an administrator can always fall back to psql.
4. **Least surprise for the developer.** The interface shows what the database says — including
   what it refuses, and why — and shows a change as SQL before it runs.
5. **One workspace at a time.** A workspace is the unit of ownership and of permission, so
   surfaces read inside a workspace rather than showing every schema at once.
6. **Free software, honestly.** There is no pricing and no commercial story; the product's
   value is that it gives its users their own PostgreSQL's truth and nothing else.
