# Platform 2.1.0

PostgreSQL is the identity and authorization system. A user is a PostgreSQL `LOGIN` role.
People prove who they are to [Dex](https://dexidp.io), which fronts whatever sign-in systems you
use and is the one issuer PostgreSQL 18 trusts; PostgreSQL itself checks each token and logs its
holder in as their own role. Groups are `NOLOGIN` roles. Permissions are native memberships,
object/column grants and row security policies. They apply equally through the interface,
`psql`, reporting tools and any other database client.

There is no application server. The interface is a static site whose pages speak PostgreSQL's
own wire protocol: each action opens a login to PostgreSQL with the reader's own token, runs
ordinary SQL and closes it. In a browser the bytes travel over a WebSocket to a relay, a stock
WebSocket-to-TCP forwarder that holds no credentials and reads nothing it carries. Nothing
between the page and PostgreSQL holds a **database service account, administrator password,
user table, password hashes, session tokens, policy cache or privileged schema connection**.
`session_user` is the actual authenticated login. No role has a password except the
installer's administrator.

Install into a dedicated PostgreSQL database. Native roles, grants and policies are the single
source of access control. See [importing data](docs/import.md) when bringing in existing records.

## Start locally

Requires Bun 1.4.3+ and PostgreSQL 18+ with an OAuth token validator. The local stack builds
both into one image (deploy/postgres) and runs Dex beside it.

```bash
bun install --frozen-lockfile
cp .env.example .env
# Generates the administrator's and three example people's passwords into .env on first use.
bun run cli deploy local up

# Create the example roles, workspace, grants and policy.
bun run cli apply local examples/newsroom.json
```

The interface is a static site, not a container: build it and open the files.

```bash
bun run cli deploy local ui
bun run dev:ui --relay=127.0.0.1:5432
```

Choose Sign in. Dex asks for an email and password: use
`admin@example.com`, `alice@example.com` or `bob@example.com` with PLATFORM_ADMIN_PASSWORD,
ALICE_PASSWORD or BOB_PASSWORD from .env. There are no built-in credentials. Those three live in
the local stack's Dex and stand in for a real sign-in system; in a deployment you add your
providers to Dex as connectors instead (deploy/dex/config.yaml.tmpl). A person can log in when a
role named after their email exists. The bootstrap administrator is a database user with
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
  oauth_issuer=http://localhost:5556/dex oauth_client_id=platform-psql oauth_scope='openid email'"
```

```sql
INSERT INTO newsroom.articles(title) VALUES ('My draft');
SELECT id,title,status,created_by FROM newsroom.articles;
-- PostgreSQL rejects this: alice has no SELECT on internal_notes.
SELECT internal_notes FROM newsroom.articles;
```

PostgreSQL publishes its role catalogs to every connection, so by default a psql session can
list every role and read who belongs to which group. `bun run cli harden local` (the cluster
superuser) hides them: ordinary sessions keep their own rights and the interface keeps working,
while the graph stays with the operators. See [operations](docs/operations.md).

## The interface in development

The interface is a static site in `packages/ui/`: the pages are generated at build time and the client
speaks to PostgreSQL itself. To work on it without a server, an issuer or a relay, run it on
its own:

```bash
bun run dev:ui     # http://localhost:5173/
```

The development build runs **PostgreSQL 18 inside the page** (PGlite), installed with the real
`migrations/*.sql` and seeded by `packages/ui/src/dev/seed.sql`: the newsroom workspace with its
sections, articles and corrections, the crm workspace owned by the group `sales` with its
accounts, contacts and deals, and their grants, policies, revisions and metadata. The sign-in
page offers the three example people, admin, alice and bob; choosing one logs that role in,
and every grant, row policy and trigger applies to them as it would on a server. The database
is kept in the browser's IndexedDB across reloads. `PORT=8080 bun run dev:ui` chooses the port.

Editing anything under `packages/ui/src` rebuilds the pages and the page picks it up on the next
reload. The in-page database is swapped in when the bundle is built, so it never reaches a
production bundle: `bun run build:ui` writes the real interface, which signs in through the
issuer and reaches PostgreSQL through the relay. `bun run dev:ui --relay=HOST:PORT` serves that
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
- Metadata for workspaces and collections: what an item is, as opposed to what it holds. It
  is stored in the platform schema, and PostgreSQL's own rights decide it — a reader reaches
  the metadata of the items they may reach, and only the owner of an item may change it.
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

| Package          | What it is                                                                    |
| ---------------- | ----------------------------------------------------------------------------- |
| `packages/sql`   | The SQL the platform writes: identifiers, literals, columns, relation names.  |
| `packages/cli`   | The operator's tools: install, apply, harden, deploy. Depends on `pg`, `zod`. |
| `packages/relay` | The WebSocket in front of PostgreSQL's port. No dependencies, no credentials. |
| `packages/ui`    | The interface: a Preact application, its static build and its headers.        |

Each package declares its own dependencies and owns its unit tests; the root holds the
migrations, the deployment files and the integration tests that cross the packages. The
repository root is a Bun workspace, so `bun install` installs all of them.

## Commands

```bash
bun run check          # build the interface, typecheck, lint, format, PostgreSQL integration tests
bun run build:ui       # generate the static interface into packages/ui/dist
bun run dev:ui         # the interface on http://localhost:5173/ with PostgreSQL in the page
bun run dev:ui --relay=127.0.0.1:5432  # the real interface against a real PostgreSQL
bun test               # needs the test server and relay: see docs/operations.md, Testing
bun run cli deploy help
bun run cli deploy local up
bun run cli deploy local status
bun run cli deploy local logs -f relay
bun run cli deploy local down  # keeps the database volume
bun run cli deploy local ui   # build the static interface into packages/ui/dist, for a CDN
bun run relay                # the WebSocket relay in front of PostgreSQL's port
bun run cli --version  # 2.1.0
bun run cli migrate    # installs what is missing, upgrades what is behind; CLI credentials required
bun run cli harden local  # hide the role catalogs from ordinary connections; cluster superuser
bun run cli doctor     # server version, authentication rules, installation
bun run cli token      # sign in through Dex from a terminal; prints a token
bun run cli apply local examples/newsroom.json --dry-run  # users, groups, workspaces, grants
bun run cli apply local examples/newsroom.json deploy/models/crm.json
bun run cli model:apply deploy/models/crm.json
bun run cli sql model.sql
```

Database CLI commands act as a person, with the token in `PGTOKEN` or `PGTOKEN_FILE`, or as the
installer's administrator, with `PGUSER` and `PGPASSWORD` or `PGPASSWORD_FILE`, plus the database
endpoint configuration. These secrets belong in operator sessions and migration jobs, never the
interface or the relay. Tests use `TEST_ADMIN_URL`; see [operations](docs/operations.md).

| Document                             | Contents                                                  |
| ------------------------------------ | --------------------------------------------------------- |
| [Architecture](docs/architecture.md) | Connection identity and database layout                   |
| [Access](docs/access.md)             | Roles, grants, RLS, delegation and revocation             |
| [Interface](docs/interface.md)       | Pages, the relay, configuration and the browser surface   |
| [Publishing](deploy/cdn/README.md)   | The static site on a CDN: config.json, headers, the relay |
| [Security](docs/security.md)         | Boundaries and practical limitations                      |
| [Operations](docs/operations.md)     | Deploying, PostgreSQL 18, Dex, TLS and testing            |
| [Applying changes](docs/apply.md)    | Declaring users, groups, workspaces, grants and policies  |
| [Importing data](docs/import.md)     | Data, identity mappings and native permissions            |
| [Features](docs/features.md)         | Native data and access capabilities                       |

MIT. See [LICENSE](LICENSE).
