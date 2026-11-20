# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an application developer working inside their own workspace: their team owns
the schema, they build and ship against it, and the interface is where they model collections,
read and write records, grant access and run SQL.

The product also serves, and design must not be built against, these confirmed roles:

- **Workspace owner** — administers the model inside a workspace they own: creates collections and
  fields, and reads that workspace's full revision history.
- **Ordinary reader** — sees only what grants and row policies allow, cannot use the audit log to
  bypass column permissions, and must never own a table.
- **Cluster operator** — installs, migrates, hardens the role catalogs, deploys and diagnoses.
  Their work happens in the CLI, not the interface.

The platform is both an internal tool for the team that builds it and something delivered to other
teams and customers, so surfaces serve a real customer audience and not only the operators.

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

## Positioning

The transport is the page and the relay, and neither is a policy authority. The page carries the
reader's own token into PostgreSQL's login; the relay carries bytes. Neither can manufacture
identity, cache a decision or grant a right PostgreSQL refused: every action connects as the
reader and lets the database judge. Nothing here is a shadow permission system
layered over PostgreSQL — roles, groups, memberships, column ACLs, row policies, constraints and
revisions are PostgreSQL's own, so the same installation is administered with psql, the CLI and
the interface alike.

## Operating Context

- Requires Bun 1.4.3+ and PostgreSQL 18+ with an OAuth token validator, and installs into a
  dedicated PostgreSQL database with Dex beside it.
- The local stack (`bun run cli deploy local up`) builds the images under `deploy/postgres` and
  runs Dex next to them. Docker Compose and Podman Compose are detected automatically;
  `--engine=podman` chooses. It installs the database and the example roles, workspace, grants
  and policy through PostgreSQL's own socket: PostgreSQL has no password, for anyone.
- `bun run cli apply <deployment> FILE` applies a manifest as the person whose token it is given.
  `deploy/models/crm.json` is a second manifest, an additive CRM model with real foreign keys
  and role names in its owner fields.
- The local Dex holds one account with a password — the break-glass administrator,
  `PLATFORM_ADMIN`, which is `admin` on the deployment's own domain (`admin@localhost`) unless
  another is named — and what it asks it for is generated into `.env`
  (`PLATFORM_ADMIN_PASSWORD`). It stands in for a real sign-in system; every other account
  comes from a provider added to Dex as a connector (`deploy/dex/config.yaml.tmpl`). The
  example's roles — the administrator, `alice@example.com`, `bob@example.com` — are roles, not
  accounts: who may sign in as them is the identity provider's business. A person can log in
  when a PostgreSQL role named after their email exists.
- psql 18 signs in through Dex itself: it prints an address and a code. `PGOAUTHDEBUG=UNSAFE` is
  needed only because the local Dex is plain HTTP.
- The interface is a static site in `packages/ui/`, generated at build time (`bun run build:ui` →
  `packages/ui/dist`) and published to a CDN: it is files, not a container. The page opens a WebSocket to
  the relay in front of PostgreSQL and reads its issuer, client, claim, relay and database from
  `/config.json`, served beside the pages. The access token lives in memory only, so a page load
  always starts signed out — which is exactly the state the generated pages show.
- The relay reaches PostgreSQL in plain TCP, so it runs next to PostgreSQL or on a private
  network the operator trusts; PostgreSQL takes only tokens from the relay's addresses
  (`PLATFORM_TOKEN_ONLY_FROM`).
- Development: `bun run examples:newsroom:dev` serves the interface on http://localhost:5173 with PostgreSQL 18
  running inside the page (PGlite), installed with the real migrations and seeded with the
  example workspaces and people; `bun run examples:newsroom:dev --relay=HOST:PORT` serves the real build against
  a real PostgreSQL. `bun run check` builds the interface, typechecks, lints, formats and runs
  the tests. `bun test` needs the test server and relay described in `docs/operations.md`.
- Integration tests and CI run against PostgreSQL 18 with real token logins.
- Deployment is Docker Compose, Podman Compose or Kubernetes (`deploy/compose`, `deploy/k8s`).
  `bun run cli migrate` installs or upgrades the database; `bun run cli harden k8s` hides the
  role catalogs from ordinary connections (cluster superuser).
- Versioned through the CLI (`bun run cli --version`); MIT licensed.

## Capabilities and Constraints

**Terminology** (the product's own words; use them consistently):

- **Workspace** — a PostgreSQL schema. Its owner controls model administration.
- **Collection** — a table. Fields are columns; relations are foreign keys.
- **User** — a `LOGIN` role. **Group** — a `NOLOGIN` role. Membership lives in `pg_auth_members`.
- **Revision** — a trigger-logged row change, stored in `platform.activity`.
- **platform** — the helper schema owned by `platform_core`. It is the one **system workspace**:
  its tables (`activity`, `installation`) are **system collections**, shown by
  the interface like any other and read under their own row security. Its model is changed by
  migrations, never from the interface.

**Capabilities**

- The interface (`packages/ui/`): a data studio in the manner of a headless CMS — a module bar (Content,
  Data model, Access, Activity, SQL), a navigation pane with the workspace switcher and the
  collections, and a sidebar with the collection's information, the reader's rights and the row
  policies that apply. Records, model inspection, runtime collection and field creation, roles,
  memberships, row policies, activity and one-statement SQL. It reads one workspace at a time:
  the workspace (`?ws=`), the collection (`?c=`) and the record (`?id=`) are part of the address,
  links carry them, and every module presents that workspace alone.
- An access module that reads only what the caller may see (the roles they may use, their
  memberships, the cluster's policies, the grants in the workspace) and composes the GRANT,
  CREATE POLICY, membership and role statements for the caller to run. Every statement that
  changes the model or access is shown before it runs, then runs as the caller's own role in one
  transaction; the interface grants nothing, and PostgreSQL refuses it if they lack the
  authority. Refusals are shown with their SQLSTATE; withheld fields are marked hidden,
  write-only or read-only.
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
- Additive JSON model import, including the CRM model.
- Declarative `apply` of users, groups, workspaces, grants and policies to a deployment, in one
  transaction, with a dry run.
- A deployment CLI for Docker/Podman Compose and Kubernetes, with integration tests and CI
  against PostgreSQL 18 with real token logins.

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
- One authenticated connection per action, always closed. State does not survive an action.
- Raw SQL executes with the caller's native authority. There is no sandbox and no allowlist:
  the `statement_timeout` sent with each login is a session setting, not a resource boundary.
- Role catalogs are visible to every connection by default; `cli harden` hides them from ordinary
  sessions while the interface keeps working.
- The audit table is append-only for ordinary roles, not tamper-proof against database owners,
  `platform_core` members or superusers. RLS is not a substitute for withholding table ownership.
- Every workspace keeps its metadata in its own `item_metadata` collection, under forced row
  security, made with the workspace. A schema made by hand has none until its owner runs
  `platform.create_metadata`.
- Metadata is not audited in `platform.activity`; its rows carry their own `created_by`,
  `updated_by` and `version`, and a dropped collection leaves its metadata behind, unread.
- Writes return counts rather than `RETURNING *`.
- The browser surface: a strict CSP (`default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
  `connect-src` limited to the site, the relay's origin and the issuer, `frame-ancestors 'none'`,
  `base-uri 'none'`), a WebSocket refused with 403 from any Origin but the site's own, a cap
  on the open sessions one role may hold (RELAY_SESSIONS_PER_ROLE), and a cap on the logins
  one client address may have signing in at once (RELAY_SESSIONS_PER_ADDRESS).
- The relay to PostgreSQL leg is plain TCP and must stay on a network the operator trusts.

**Open decisions** (explicitly undecided; do not invent them):

- Pricing, packaging, licensing and the commercial story for delivered customers.
- Which audiences beyond the primary developer the interface should serve first.
- Whether the CLI's output and the `docs/` tree are designed surfaces or only reference material.

## Brand Commitments

One commitment is in force: the interface's visual reference is pinned by the user as "a
combination of Directus and Keystone" — a headless-CMS data studio at that level of craft, light
and dense. Beyond that, no name, voice, asset or personality has been declared binding. The
product currently goes by "Platform"; the interface carries its own title, and
`packages/ui/src/favicon.svg` is the only logo asset in the repository. The written voice across the
README and `docs/` is plain, declarative and technical — a statement of what the system does,
not of how it feels — which future work may keep or replace.

## Evidence on Hand

- Real content: the example manifest the CLI carries (`--example`), `deploy/models/crm.json`,
  the dev-mode seed `examples/newsroom/seed.sql`, the product documents in `docs/`, and the
  generated interface pages in `packages/ui/dist`.
- Real demonstrations: the local stack with its three example accounts; integration tests and CI
  against PostgreSQL 18 with real token logins; the CLI's `doctor`, `token`, `apply --dry-run`,
  `harden` and `deploy` commands.
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
