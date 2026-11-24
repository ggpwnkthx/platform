# Operations

The operator's tools are standard ones: psql for everything done to a database, Compose and
kubectl for what runs, Vite for the site. `bun run deploy` automates a deployment with them
and does nothing else.

## Database installation

Install into a dedicated, empty PostgreSQL 18 database, as its administrator:

```bash
psql -1 -v ON_ERROR_STOP=1 -f migrations/0001_platform.sql
```

The file makes the reserved roles, the `platform` schema, the revisions, the metadata and the
views of the catalog, and marks the database with the version it holds. The interface is built
for one version and says so when a database holds another. `platform_core` must stay an
unprivileged NOLOGIN group, and must never be granted to workspace administrators.

A site's own schema, a deployment's administrator and the files below are applied the same
way: see [applying SQL](apply.md).

## Hiding the role catalogs, and the guard

PostgreSQL publishes `pg_auth_members`, `pg_roles`, `pg_user` and `pg_group` to every
connection. As the
cluster superuser:

```bash
psql -1 -f deploy/sql/harden.sql -f deploy/sql/guard.sql
```

`harden.sql` revokes the public read and leaves it to the operators (`platform_core`,
`platform_admins`); the file says how to leave role names readable so that pg_dump keeps
working for everyone. psql's `\du` and pg_dump then need an operator or a superuser. The
interface is unchanged: it reads roles through the platform's functions, which answer about
the caller. `guard.sql` installs two event triggers, one before and one after every DDL
command of an ordinary role. They compare each collection before and after, and refuse (42501)
a command that turned its row security off, lost, disabled or changed a trigger that stamps
its rows or writes its history, gave it a rule, or made it the parent of another table. A
collection its owner drops leaves one revision of the drop.
`deploy/sql/restore.sql` puts PostgreSQL's default back. The local stack applies both as it
installs itself.

## PostgreSQL 18 and sign-in

People sign in through [Dex](https://dexidp.io). Dex federates your sign-in systems (OIDC,
SAML, LDAP, GitHub, Google, Microsoft and others are connectors in its configuration) and is
the single issuer PostgreSQL trusts, so adding a provider never touches the database.
PostgreSQL 18 verifies each token itself through its `oauth` authentication method.

The database server needs three things, all of which deploy/postgres provides as an image
(`docker build -t platform-postgres deploy/postgres`) that you can run or copy from:

1. PostgreSQL 18 or newer. The migration refuses anything older.
2. A token validator. PostgreSQL ships none; the image builds
   [pg_oidc_validator](https://github.com/percona/pg_oidc_validator) 1.1.0 from a checksummed
   release and sets `oauth_validator_libraries=pg_oidc_validator` and
   `pg_oidc_validator.authn_field=email`. A managed PostgreSQL service that cannot load a
   validator library cannot host Platform.
3. Authentication rules in which the network accepts tokens only. The image writes:

   ```
   local   all  all                trust      # the container's own socket, as upstream ships it
   host    all  "postgres"    all  reject     # the server's own superuser: the socket alone
   host    all  "admin@example.com"  10.89.71.0/24  reject   # the administrator, never from the relay
   host    all  "admin@example.com"  10.1.0.0/16    oauth issuer="https://idp.platform.example.com" scope=""
   host    all  "admin@example.com"  all            reject   # and from nowhere but the operators' network
   host    "platform"  all    all  oauth issuer="https://idp.platform.example.com" scope=""
   ```

   No login has a password. The image refuses POSTGRES_PASSWORD, and a new cluster's own
   superuser is left without one. PLATFORM_ADMIN names the administrator as the token's claim
   does (`admin@example.com`): a new cluster is given that role, a superuser, and that person
   installs and administers the server with a token, like anyone else: psql signs in through
   Dex itself. An existing cluster is given one over the socket:
   `docker exec <container> psql -U postgres -c 'CREATE ROLE "admin@example.com" LOGIN SUPERUSER'`.
   The socket is also the way in when Dex is not: it needs a shell in the container, which is
   the server's own trust and nobody's credential. Whoever can make Dex issue a token for the
   administrator's address is the administrator, so add only connectors you would trust with
   that.

   Set PLATFORM_OIDC_ISSUER (required), PLATFORM_HBA_HOST=hostssl wherever TLS is configured,
   and PLATFORM_OIDC_CLAIM to match on a claim other than email. `scope=""` is deliberate:
   Dex puts no scope claim in its tokens, so there is none to require.
   PLATFORM_TOKEN_ONLY_FROM (comma-separated CIDR blocks, the third line above) names the
   relay's network: its lines come before the rule that lets everyone in, and the first
   matching rule decides, so from there the administrator does not log in at all. A token
   that names the administrator is not a way in through the interface. The local stack sets
   it to the relay network's 10.89.71.0/24.
   PLATFORM_ADMIN_FROM (comma-separated CIDR blocks, the fourth and fifth lines above) turns
   that around: it names the operators' own networks, and the administrator logs in from
   those and from nowhere else. Without it the administrator is refused only from the
   networks PLATFORM_TOKEN_ONLY_FROM lists, and a network nobody thought of lets that role
   in; set it wherever you know where your operators connect from.
   PLATFORM_HBA_DATABASES (comma-separated names) is the databases a token opens over the
   network, in the last line: POSTGRES_DB when the cluster is made with one, and otherwise
   all. The relay carries whichever database a client names, so a database that is not
   listed is not reached through it. The administrator, from PLATFORM_ADMIN_FROM, reaches
   them all.

   The image also starts PostgreSQL with `log_connections=on` and `log_statement=ddl`, so the
   server's log says who connected and as whom, and holds every statement that changes a
   role, a grant, a policy or a table: what the revisions do not record. Both are given
   before your own settings, so `-c log_statement=...` of yours decides. Send that log
   somewhere the database's own administrators cannot rewrite it.

`psql -f deploy/sql/doctor.sql`, run as a superuser, reads the live rules and reports as a
problem any network rule that lets a login in without a token: only `oauth` and `reject`
pass. It then says what the deployment has left open: TLS that is off, role catalogs every
connection reads, no guard on row security, collections owned by a person rather than a
group, and tables that write no revisions.

To lock a person out at once, take the login away and end their sessions:

```sql
ALTER ROLE "alice@example.com" NOLOGIN;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'alice@example.com';
```

`ALTER ROLE … LOGIN` gives it back. A locked role is logged in by no token. A superuser's
login is changed by a superuser, so the administrator is unlocked from beside the server
(`bun run deploy local psql`, or psql in the server's container).

A role and its sign-in are matched by name: the token's `email` claim must equal the role name
exactly, so alice@example.com logs in as the role `"alice@example.com"`. Nothing is mapped or
created automatically; a person with no role cannot log in. Role names are at most 63 bytes.

Dex's configuration is deploy/dex/config.yaml.tmpl, rendered from the environment by the Dex
image. It declares two public clients: `platform-console` (authorization code with PKCE, used by
the interface and redirecting to the site) and `platform-psql` (device authorization, for psql). For a real deployment:

- Give Dex one HTTPS URL that browsers and the PostgreSQL server can both open, and use it
  as DEX_ISSUER, PLATFORM_OIDC_ISSUER and PLATFORM_ISSUER.
- Give Dex the address of the site as PLATFORM_PUBLIC_ORIGIN: it is the origin Dex allows to
  exchange the code, and the one it redirects to after the sign-in. With the interface on a
  CDN, that is the CDN's address, not the relay's.
- Add your providers under `connectors` and leave DEX_LOCAL_ADMIN unset: the password database
  holds one account, the break-glass administrator, and every other account comes from a
  provider that vouches for it.
- Run this Dex for Platform alone. The validator checks a token's signature, issuer and
  expiry but not its audience, so any client registered with this Dex can obtain tokens that
  PostgreSQL accepts.
- Add only connectors you trust to vouch for the email addresses they return. A connector that
  reports an unverified or arbitrary address can log in as that role.
- Replace the sqlite3 storage with one Dex supports for more than one replica.
- `expiry.idTokens` (DEX_TOKEN_LIFETIME, 1h as shipped) is how long a token works.

psql 18 and other libpq 18 clients sign in with the device flow; on Debian and Ubuntu that
needs the `libpq-oauth` package beside libpq:

```bash
psql "host=db.example.com dbname=platform user=alice@example.com \
  oauth_issuer=https://idp.platform.example.com oauth_client_id=platform-psql oauth_scope='openid email'"
```

libpq refuses an issuer that is not HTTPS unless PGOAUTHDEBUG=UNSAFE is set, which is for the
local stack only.

## The local stack

```bash
PLATFORM_SITE=examples/newsroom bun run deploy local up
```

| Action                   | What it does                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `up`                     | Builds the images, starts PostgreSQL, Dex and the edge, installs the database, starts the relay, builds and serves the site |
| `init`                   | The same, stopping once the database is installed                                                                           |
| `build`, `validate`      | Builds the images; checks the Compose file                                                                                  |
| `status`, `logs`, `down` | `compose ps`, `logs`, `down`, with what follows passed on                                                                   |
| `psql`                   | psql beside the server, through its socket, as its superuser                                                                |

Docker Compose and Podman Compose are detected; `--engine=podman` chooses. Settings come
from the environment, then `.env`; the first run writes `.env` for its owner alone, with
PLATFORM_ADMIN_PASSWORD generated. Only its bcrypt hash is given to Dex.

| Setting                                                       | Default                      |                                                           |
| ------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| PLATFORM_DOMAIN                                               | `localhost`                  | The deployment's name; each service is a sub-domain of it |
| PLATFORM_IDP_HOST, _API_HOST, _DB_HOST, _APP_HOST             | `idp`, `api`, `db`, `app`    | The sub-domains                                           |
| PLATFORM_SITE                                                 | none                         | A site folder to install, build and serve                 |
| PLATFORM_PUBLIC_URL                                           | none                         | The address of a site published elsewhere                 |
| PLATFORM_ADMIN                                                | `admin@<domain>`             | The administrator, as the token names them                |
| EDGE_PORT, EDGE_TLS_PORT, POSTGRES_PORT, DEX_PORT, RELAY_PORT | 8080, 4433, 5432, 5556, 8081 | Ports on this machine                                     |
| DEX_LOCAL_ADMIN                                               | `1` on localhost             | Whether Dex keeps the one password account                |

Installing is one psql transaction beside the server: the migration, the SQL files the
site's `platform.json` lists (or `deploy/sql/administrator.sql` where there is no site),
`harden.sql` and `guard.sql`. A database that is installed already is left as it is. The
command does not edit the hosts file: it prints the line to add.

Each open WebSocket is one database session. The edge holds each address to 20
(`inFlightReq` in deploy/traefik/dynamic.yaml); a role's CONNECTION LIMIT is PostgreSQL's own
count across every relay; PostgreSQL's `authentication_timeout` closes a login that stalls.

## The relay

`bun run relay`, or the `relay` target of the Dockerfile. It reads its environment:

| Setting                                             |                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| RELAY_UPSTREAM                                      | `host:port` of PostgreSQL. Default `127.0.0.1:5432`                                                                        |
| RELAY_UPSTREAM_TLS                                  | `verify` or `off`. Required unless the upstream is on this machine; `off` is for a network you trust with a token          |
| RELAY_UPSTREAM_CA                                   | A certificate authority file, with `verify`                                                                                |
| RELAY_ORIGINS                                       | The origins that may open a session: the site's. Required, unless RELAY_ALLOW_ANY_ORIGIN=1 says the edge checks the origin |
| RELAY_PORT, RELAY_TLS_CERT, RELAY_TLS_KEY           | Where it listens, and its own certificate                                                                                  |
| RELAY_SESSIONS_PER_ADDRESS, RELAY_SESSIONS_PER_ROLE | How many sessions one address, and one role, may hold. 0, no limit, by default                                             |

## Kubernetes

The relay is the only part of the platform that runs in the cluster; PostgreSQL 18 and Dex
are yours to run, and the site is files on a CDN ([deploy/cdn](../deploy/cdn/README.md)).

```bash
bun run deploy k8s apply --domain=platform.example.com \
  --image=registry.example.com/platform-relay:3.0.0 --public-url=https://www.example.com
```

`render` prints the manifests of deploy/k8s/deployment.yaml with the deployment's names in
them; `validate`, `diff` and `apply` hand them to kubectl; `status`, `logs` and `down` are
kubectl's own. The site must be https and the image must be one you built:
`docker build --target relay -t registry.example.com/platform-relay:3.0.0 .`
deploy/k8s/ingress.yaml is an example of an ingress for the relay, with the session cap.

## Publishing the site

```bash
cd examples/newsroom
PLATFORM_ISSUER=https://idp.platform.example.com PLATFORM_RELAY_URL=wss://api.platform.example.com \
  bun --bun x vite build
```

Publish the folder's `.dist` with the headers its `_headers` file lists. `config.json` may be
replaced without rebuilding. See [interface](interface.md).

## Testing

`bun test` needs nothing but Bun: the suites start PostgreSQL in memory (PGlite). They cover
the security properties as each person, the SQL the platform writes, the page's connection
and the relay, the operator's SQL files, and the deployment's settings. `bun run test:e2e`
is Playwright's runner: it builds the dev mode and the published site, serves both with their
own headers, and drives them in Chrome. `bun run check` is everything but the browser.
