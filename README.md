# Platform 2.3.0

PostgreSQL is the identity and authorization system. A user is a PostgreSQL `LOGIN` role.
People prove who they are to [Dex](https://dexidp.io), which fronts whatever sign-in systems you
use and is the one issuer PostgreSQL 18 trusts; PostgreSQL itself checks each token and logs its
holder in as their own role. Groups are `NOLOGIN` roles. Permissions are native memberships,
object/column grants and row security policies. They apply equally through the interface,
`psql`, reporting tools and any other database client.

There is no application server. The interface is a static site whose pages speak PostgreSQL's
own wire protocol: the page opens a login to PostgreSQL with the reader's own token, keeps it
open while the reader works, and runs ordinary SQL on it. In a browser the bytes travel over a
WebSocket to a relay, a stock WebSocket-to-TCP forwarder that holds no credentials and reads
nothing but the role PostgreSQL reports. Nothing
between the page and PostgreSQL holds a **database service account, administrator password,
user table, password hashes, session tokens, policy cache or privileged schema connection**.
`session_user` is the actual authenticated login. No role has a password, the administrator's
included: a token from Dex is the only way in over the network.

Install into a dedicated PostgreSQL database. Native roles, grants and policies are the single
source of access control. See [importing data](docs/import.md) when bringing in existing records.

## Start locally

Requires Bun 1.4.3+ and PostgreSQL 18+ with an OAuth token validator. The local stack builds
both into one image (deploy/postgres) and runs Dex beside it.

```bash
bun install --frozen-lockfile
# Installs the database and the example roles, workspace, grants and policy. PostgreSQL is
# given no password; what Dex asks the break-glass administrator for is generated into .env.
# There is no .env in a checkout: the first run asks for the settings it does not know and
# writes them down, with the secrets it generated in it. The file is yours alone and is kept
# out of git. The deployment is named by a domain: each service answers on its own
# sub-domain of it (idp for Dex, api for the relay, db for PostgreSQL), and the names are put
# where they can be resolved.
bun run cli deploy local up
```

The interface is a static site, not a container: build it, or serve it against the stack.

```bash
bun run cli deploy local ui                     # build it into packages/ui/dist
bun run examples:newsroom:dev --relay=127.0.0.1:5432   # or serve it on http://localhost:5173/
```

Choose Sign in. The local stack's Dex keeps exactly one account with a password: the
break-glass administrator, `admin@localhost` (`PLATFORM_ADMIN`: `admin` on the deployment's
own domain unless another is named), with PLATFORM_ADMIN_PASSWORD from .env. Every
other account comes from a connector — an identity provider that vouches for the addresses it
returns — so in the local stack you add one to Dex (deploy/dex/config.yaml.tmpl) to sign in as
anybody else. There are no built-in credentials. A person can log in when a role named after
their email exists. The bootstrap administrator is a database user with
`CREATEROLE` and permission to create schemas; it has no application administrator flag.
The deploy command builds the images, starts PostgreSQL and Dex, installs the database, then
starts the relay. In a deployment the interface is published to a CDN and the relay is the only
part of the path that answers on the network. Docker Compose and Podman Compose are detected
automatically; use `--engine=podman` to choose. Local HTTP and disabled database TLS are for
loopback development only.

Connect directly with the **same** identity and rules. psql 18 signs you in through Dex itself:
it prints an address and a code to enter there.

```bash
# PGOAUTHDEBUG=UNSAFE is needed only because the local stack's Dex is plain HTTP.
PGOAUTHDEBUG=UNSAFE psql "host=127.0.0.1 dbname=platform user=alice@example.com \
  oauth_issuer=http://idp.localhost:5556/dex oauth_client_id=platform-psql oauth_scope='openid email'"
```

```sql
INSERT INTO newsroom.articles(title) VALUES ('My draft');
SELECT id,title,status,created_by FROM newsroom.articles;
-- PostgreSQL rejects this: alice has no SELECT on internal_notes.
SELECT internal_notes FROM newsroom.articles;
```

PostgreSQL publishes its role catalogs to every connection, so by default a psql session can
list every role and read who belongs to which group. `bun run cli harden k8s` (as the cluster
superuser; `bun run cli deploy local admin harden k8s` on the local stack) hides them: ordinary sessions keep their own rights and the interface keeps working,
while the graph stays with the operators. See [operations](docs/operations.md).

## The interface in dev mode

The interface is a static site in `packages/ui/`: the pages are generated at build time and the client
speaks to PostgreSQL itself. To work on it without a server, an issuer or a relay, run it in
dev mode:

```bash
bun run examples:newsroom:dev     # http://localhost:5173/
```

The dev mode is the example: `examples/newsroom/platform.json` says what the folder is — the
files it applies to a database, and the module that holds its own renderers — and every tool
reads it.
The dev mode runs **PostgreSQL 18 inside the page** (PGlite), installed with the real
`migrations/*.sql` and then with the three files the example applies, as a deployment installs
them — `models.json` (the schema), `migration.sql` (what a manifest cannot say) and `demo.sql`
(records and their history): the newsroom workspace with its
sections, articles and corrections, the crm workspace owned by the group `sales` with its
accounts, contacts and deals, and their grants, policies, revisions and metadata. The sign-in
page offers the three example people, admin, alice and bob; choosing one logs that role in,
and every grant, row policy and trigger applies to them as it would on a server. There is no
issuer and no password here: the page is the identity provider, and nobody signs in with a
secret. The database
is kept in the browser's IndexedDB across reloads. `PORT=8080 bun run examples:newsroom:dev` chooses the port.

Editing anything under `packages/ui/src` — or under `examples/newsroom` — rebuilds the pages and the page picks it up on the next
reload. The in-page database is swapped in when the bundle is built, so it never reaches a
production bundle: `bun run build:ui` writes the real interface, which signs in through the
issuer and reaches PostgreSQL through the relay. `bun run examples:newsroom:dev --relay=HOST:PORT` serves that
real build and forwards its WebSockets to a real PostgreSQL. See [interface](docs/interface.md).

## What is included

- An interface for records, the data model, runtime collection creation, native roles,
  memberships, row policies, activity and SQL, laid out as a data studio: a module bar
  (Content, Data model, Access, Activity, SQL), a navigation pane with the workspace switcher
  and the collections, and a sidebar with the collection's information, the reader's rights
  and the row policies that apply. The access pages read the cluster's own truth: what your
  role may do, who belongs to what, which rows a policy allows. Every statement that changes
  the model or access is shown before it runs and then runs as you, in one transaction, with
  PostgreSQL the only judge. It reads one workspace at a time: the workspace in view
  (`?ws=`), the collection (`?c=`) and the record (`?id=`) are part of the address. The record
  browser searches every readable column, filters on named operators, sorts by any column,
  pages with a row count and keeps its state in the address. It is a static site: TypeScript
  and Preact with `preact-iso` routing, generated at build time and served as files.
- Typed collection/field builders; real CHECK, NOT NULL, UNIQUE, indexes and foreign keys.
  Use native ALTER TABLE for other schema changes and native views/joins for relationships.
  A field may have any type the database holds — `geometry` and `geography` where PostGIS is
  installed, an enum or a domain of your own — named with its schema and with the modifiers
  it takes.
- Metadata for workspaces, collections and fields: what an item is, as opposed to what it
  holds. It is stored in the platform schema, and PostgreSQL's own rights decide it — a reader
  reaches the metadata of the items they may reach, and only the owner of an item may change it.
  Three keys are reserved: a workspace or a collection may carry a display name, an icon and a
  primary colour, and the interface draws them as the item's mark wherever it appears. A field
  carries metadata too, secured by the field's own rights: whoever holds a right on the column
  reaches its metadata, and a field's display name is the label the interface shows for it.
  Every field carries its own views — where it appears in the records grid, the record form
  and the filter builder — and the owner of a collection may name views of their own beside
  them, and say whether the field appears in those. A column PostgreSQL computes itself is
  shown and never offered as an input.
- Record reads and writes as parameterized SQL on the reader's own login: inserts and updates
  without RETURNING, and updates guarded by the version the reader saw.
- A one-statement SQL page executing as the signed-in reader. Native PostgreSQL checks every
  GRANT, REVOKE, CREATE ROLE, CREATE POLICY and DDL statement.
- Transactional row revisions from database triggers, including direct SQL writes and
  TRUNCATE events. Owners can read full revisions; ordinary readers cannot use the audit log
  to bypass column permissions. Database statement auditing is a separate operator concern.
- Additive JSON model import, including the CRM model. Its `owner` fields hold
  PostgreSQL role names.
- Declarative `apply` of users, groups, workspaces, grants and policies to a deployment, in one
  transaction, with a dry run. See [applying changes](docs/apply.md).
- Deployment CLI for Docker/Podman Compose and Kubernetes, plus integration tests and CI
  against PostgreSQL 18 with real token logins.

New collections have RLS enabled with **no policies**. Grants alone do not make their rows
visible to non-owners. Owners administer their tables; ordinary users must never own them.
See [access control](docs/access.md) for concrete policies and delegation.

## The packages

| Package               | What it is                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `packages/vocabulary` | The vocabulary the platform speaks: the SQL it writes, the tokens and versions it reads. |
| `packages/data`       | The questions the platform asks PostgreSQL: the catalog, the records, the access.        |
| `packages/pg-client`  | The PostgreSQL client the platform speaks with: the protocol, and the logins it keeps.   |
| `packages/cli`        | The operator's tools: install, apply, harden, deploy, and build the interface.           |
| `packages/relay`      | The WebSocket in front of PostgreSQL's port. No dependencies, no credentials.            |
| `packages/ui`         | The interface: a Preact application, and the pages it renders itself into.               |
| `examples/newsroom`   | The newsroom example, running: the dev mode, its in-page PostgreSQL and its people.      |

Each package declares its own dependencies and owns its unit tests; the root holds the
migrations, the deployment files and the integration tests that cross the packages. The
repository root is a Bun workspace — `packages/*` and `examples/*` — so `bun install` installs
all of them.

The interface's own source is laid out by domain: `content/`, `model/`, `access/`,
`activity/`, `metadata/`, `sql/`, `workspace/`, `identity/` and `fields/` each hold their page
and what they draw — and little else. The SQL they run is the platform's own, in
`packages/data` (the questions, asked of any source of statements) and `packages/vocabulary` (the
vocabulary they are written in); the protocol is the client's, in `packages/pg-client`. Two folders
are shared by all of them — `ui/` holds the interface's own widgets, `pg/` the one seam that
reaches the database — and the root of `packages/ui/src` holds the shell of the
application: the router, the session, the layout, the routes, the configuration, the address
and the formatting. The PostgreSQL that runs inside the page in dev mode is an example, not
a part of the interface: it is the package `examples/newsroom`, which depends on the interface
through its published entry points and owns the files it installs and the people who sign in.

## Commands

```bash
bun run check                       # build the interface, typecheck, lint, format, PostgreSQL integration tests
bun run build:ui                    # generate the static interface into packages/ui/dist
bun run examples:newsroom:build     # generate the dev-mode interface into examples/newsroom/.dist
bun run examples:newsroom:dev       # dev mode: the interface on http://localhost:5173/, PostgreSQL in the page
bun run examples:newsroom:dev --relay=127.0.0.1:5432  # the real interface against a real PostgreSQL
bun run cli ui build                # the published interface: no configuration, the relay and the issuer
bun run cli ui dev --dir=examples/newsroom  # the same server, named by the example's configuration
bun test               # needs the test server and relay: see docs/operations.md, Testing
bun run cli deploy help
bun run cli deploy local up
bun run cli deploy local status
bun run cli deploy local logs -f relay
bun run cli deploy local down  # keeps the database volume
bun run cli deploy local ui   # build the static interface into packages/ui/dist, for a CDN
bun run relay                # the WebSocket relay in front of PostgreSQL's port
bun run cli --version  # 2.3.0
bun run cli migrate    # installs what is missing, upgrades what is behind; needs a token
bun run cli deploy local admin harden k8s  # hide the role catalogs from ordinary connections
bun run cli deploy local admin doctor      # the same checks, as the stack's own superuser
bun run cli doctor     # server version, authentication rules, installation, what is left open
bun run cli token      # sign in through Dex from a terminal; prints a token
bun run cli token --out=$HOME/.platform-token  # the same, into a file of your own (0600), for PGTOKEN_FILE
bun run cli lock alice@example.com    # no login, whatever token names it; unlock gives it back
bun run cli apply local --example=newsroom --dry-run  # users, groups, workspaces, grants
bun run cli apply local team.json                    # a manifest of your own
bun run cli model:apply deploy/models/crm.json
bun run cli sql model.sql
```

Database CLI commands act as a person, with the token in `PGTOKEN` or `PGTOKEN_FILE`
(`PGTOKEN=$(bun run --silent cli token)`), plus the database endpoint configuration. There is
no password to give them: the administrator signs in with a token like everyone else. Tokens
belong in operator sessions and migration jobs, never the interface or the relay. The local
stack's own server is administered beside it, through its socket: `bun run cli deploy local
admin <command>`. Tests use `TEST_ADMIN_URL`; see [operations](docs/operations.md).

| Document                             | Contents                                                        |
| ------------------------------------ | --------------------------------------------------------------- |
| [Architecture](docs/architecture.md) | Connection identity and database layout                         |
| [Access](docs/access.md)             | Roles, grants, RLS, delegation and revocation                   |
| [Interface](docs/interface.md)       | Pages, the relay, configuration and the browser surface         |
| [Fields](docs/fields.md)             | What a field is: its type, its cell, its input and its filter   |
| [Views](docs/views.md)               | Where a field appears: the defaults, your own views, the saying |
| [Renderers](docs/renderers.md)       | How a field's values are drawn, in each place it appears        |
| [Publishing](deploy/cdn/README.md)   | The static site on a CDN: config.json, headers, the relay       |
| [Security](docs/security.md)         | Boundaries and practical limitations                            |
| [Operations](docs/operations.md)     | Deploying, PostgreSQL 18, Dex, TLS and testing                  |
| [Applying changes](docs/apply.md)    | Declaring users, groups, workspaces, grants and policies        |
| [Importing data](docs/import.md)     | Data, identity mappings and native permissions                  |
| [Features](docs/features.md)         | Native data and access capabilities                             |

MIT. See [LICENSE](LICENSE).
