# Platform 3.0.0

PostgreSQL is the identity and authorization system. A user is a PostgreSQL `LOGIN` role.
People prove who they are to [Dex](https://dexidp.io), which fronts whatever sign-in systems you
use and is the one issuer PostgreSQL 18 trusts; PostgreSQL itself checks each token and logs its
holder in as their own role. Groups are `NOLOGIN` roles. Permissions are native memberships,
object and column grants and row security policies. They apply equally through the interface,
`psql`, reporting tools and any other database client.

There is no application server. The interface is a static site whose pages speak PostgreSQL's
own wire protocol: the page opens a login to PostgreSQL with the reader's own token, keeps it
open while the reader works, and runs ordinary SQL on it. In a browser the bytes travel over a
WebSocket to a relay, a WebSocket-to-TCP forwarder that holds no credentials and reads nothing
but the first packet, which must be a login. Nothing between the page and PostgreSQL holds a
database service account, an administrator password, a user table, password hashes, session
tokens, a policy cache or a privileged schema connection. No role has a password, the
administrator's included: a token from Dex is the only way in over the network.

Our own code is what no package does: the SQL the platform says, the questions it asks the
catalog, the token login no driver speaks yet, the relay, and thin glue. The interface is
[react-admin](https://marmelab.com/react-admin/) on Material UI over a data provider that runs
on the page's own PostgreSQL connection. See [the remake](docs/remake.md).

## Try it, with no server

Requires Bun 1.4.3+.

```bash
bun install --frozen-lockfile
bun run dev          # http://localhost:5173
```

That is the dev mode of the newsroom example: PostgreSQL 18 runs inside the page (PGlite),
installed with the real migration and the example's own SQL files. Choose who to be —
the administrator, alice or bob — and every grant, row policy and trigger applies to them as
it would on a server.

## Start the local stack

Requires Docker Compose or Podman Compose. The stack builds PostgreSQL 18 with its token
validator (deploy/postgres) and runs Dex, the relay and an edge beside it.

```bash
PLATFORM_SITE=examples/newsroom bun run deploy local up
```

The first run settles the deployment's settings and writes them to `.env`, for you alone, with
the one secret it generates. A deployment is named by a domain (`localhost` by default), and
each service answers on its own sub-domain: `idp` for Dex, `api` for the relay, `db` for
PostgreSQL, `app` for the site. The command prints the hosts-file line to add where the names
do not resolve. It installs the database by running SQL files with psql beside the server,
through PostgreSQL's own socket: the migration, what the site's folder applies, and the guard.

Sign in as `admin@localhost`, the break-glass administrator, with PLATFORM_ADMIN_PASSWORD from
`.env`. It is the one account in Dex with a password; every other account comes from a
connector you add to deploy/dex/config.yaml.tmpl. A person can log in when a role named after
their email exists.

## psql is the operator's tool

Everything done to a database is SQL, run by psql. psql 18 signs in through Dex itself:

```bash
psql "host=db.example.com dbname=platform user=alice@example.com \
  oauth_issuer=https://idp.example.com oauth_client_id=platform-psql oauth_scope='openid email'"
```

| To                                             | Run                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Install the platform in a new database         | `psql -1 -f migrations/0001_platform.sql`                                           |
| Apply a site's schema and demonstration        | `psql -1 -f examples/newsroom/apply/schema.sql -f examples/newsroom/apply/demo.sql` |
| Try a file and change nothing                  | `(echo 'BEGIN;'; cat FILE.sql; echo 'ROLLBACK;') \| psql -v ON_ERROR_STOP=1`        |
| See what a deployment has left open            | `psql -f deploy/sql/doctor.sql`                                                     |
| Hide the role catalogs, and guard row security | `psql -1 -f deploy/sql/harden.sql -f deploy/sql/guard.sql`                          |
| Lock a person out at once                      | `ALTER ROLE "alice@example.com" NOLOGIN`                                            |
| Read the catalog as the interface reads it     | `SELECT * FROM platform.catalog_tables`                                             |

[Operations](docs/operations.md) has the rest.

## The repository

- `migrations/0001_platform.sql` — everything the platform keeps in a database.
- `packages/core` — what the platform says to PostgreSQL and reads back.
- `packages/ui` — the interface. A site folder builds it: `vite build` in the folder.
- `packages/relay` — the WebSocket in front of PostgreSQL's port.
- `packages/cli` — `bun run deploy`: the local stack and Kubernetes, and nothing else.
- `examples/newsroom` — a site folder: `platform.json`, SQL files, and its own renderers.
- `deploy/` — the images, the Compose file, the Kubernetes manifests, the operator's SQL.

## Checks

```bash
bun run check        # builds the site, typechecks, lints, checks formatting and file size, runs the tests
bun run test:e2e     # the interface in Chrome, under the site's own Content-Security-Policy
bun run lines        # our own lines, by area
```

`bun test` needs nothing but Bun: the suites start PostgreSQL in memory. See
[validation](docs/validation.md) for what was and was not verified.

## Documents

[Product](PRODUCT.md) · [Design](DESIGN.md) · [Architecture](docs/architecture.md) ·
[Security](docs/security.md) · [Interface](docs/interface.md) · [Fields](docs/fields.md) ·
[Access](docs/access.md) · [Applying SQL](docs/apply.md) · [Operations](docs/operations.md) ·
[The remake](docs/remake.md) · [Validation](docs/validation.md)

MIT licensed. Free and open-source software.
