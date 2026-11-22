# Operations

## Database installation

Install in a dedicated NEW PostgreSQL 18+ database as a trusted administrator able to create
roles, grant database privileges and create schemas. The installer takes a transaction-scoped
advisory lock when run through `bun run cli migrate`. A first-time direct psql installation
must use `-1 -v ON_ERROR_STOP=1`. It revokes PUBLIC database access and public-schema CREATE;
use a dedicated database so this does not disrupt unrelated applications.

The platform_core and platform_users roles are cluster-wide and can be reused across
installation databases. Do not precreate them with elevated attributes or grant untrusted
memberships. Never add ordinary users or model administrators to platform_core. Its owner
privileges exist to install/maintain the audit infrastructure, not serve the interface.
platform_admins holds the administrators who administer roles; its
members keep reading the raw role catalogs, and nobody else does.

`bun run cli migrate` installs what is missing and upgrades an installation that is behind,
in one transaction, under an advisory lock. An installation at an unknown version is refused
rather than modified.

There is one installation script, `migrations/0001_platform.sql`, and it installs 2.3.0 in
an empty database. The platform has not been released, so nothing earlier is brought
forward: a database that holds a development version from before 2.3.0 is refused, and is
made again. The next change to the schema is the next file in `migrations/`, named in
`packages/cli/src/migrations.ts`: the one list `migrate` runs, and the one a PostgreSQL in a
page or in a test is installed from.

The interface and the installation are one version. The interface reads the platform's
schema, and a schema of another version is not one it knows. So an interface built for
2.3.0 against an installation at 2.2.0 refuses to go further and says so:

```
This installation is at version 2.2.0 and the interface at 2.3.0.
Run `bun run cli migrate` to install 2.3.0.
```

The local stack installs and upgrades the database itself: `bun run cli deploy local up`
runs the installer in a one-off container, so running it again after an upgrade is what
brings an existing database up to the version the interface expects.

## Hiding the role catalogs

PostgreSQL publishes the role catalogs to every connected user: `pg_auth_members` says who
belongs to which group, and `pg_roles` says which role is privileged. The platform answers
for itself where it can, but the catalogs themselves belong to the cluster superuser, and
hiding them is an explicit step:

```bash
bun run cli deploy local admin harden k8s   # the local stack, beside its own server
bun run cli harden k8s       # a deployment: needs the token of a cluster superuser
```

The command revokes the public read of `pg_auth_members`, `pg_roles` and `pg_user`, and
grants the whole of them to `platform_core` and `platform_admins`. After it, an ordinary
session can no longer ask who is in which group, and the interface keeps working: it reads the
caller's own roles and memberships through the platform's functions. What it costs:

|                                                   | Before                        | After `harden`                |
| ------------------------------------------------- | ----------------------------- | ----------------------------- |
| `SELECT * FROM pg_auth_members`                   | every member of the group     | permission denied             |
| `SELECT * FROM pg_roles`                          | every role and its attributes | permission denied             |
| `information_schema.applicable_roles`             | the caller's roles            | the caller's roles, unchanged |
| `psql \du`, `pg_dump` as an ordinary user         | works                         | permission denied             |
| `psql \du`, `pg_dump` as an operator or superuser | works                         | works                         |

`--keep-names` leaves role names readable, so that `pg_dump` and GRANT statements keep
working for ordinary users; the membership graph and the privilege attributes stay hidden.
`--restore` puts PostgreSQL's default back.

Two scopes, one caveat: `pg_auth_members` is a shared catalog, so its rule reaches every
database in the cluster, while `pg_roles` and `pg_user` belong to this database alone. Run
`harden` on a cluster that serves this platform alone, or accept that other databases lose
the ability to read role memberships as well.

Bun CLI configuration: DATABASE_HOST/PORT/NAME/SSL, optional DATABASE_CA_FILE,
STATEMENT_TIMEOUT_MS, OIDC_ISSUER (the issuer `cli token` signs in through), OIDC_CLAIM (the
claim that names the role a token logs in as) and who to act as. PGTOKEN or PGTOKEN_FILE holds a
person's token (`bun run cli token` prints one after a browser sign-in through OIDC_ISSUER);
there is no other way to say who: no login has a password, and PGPASSWORD is refused. A
DATABASE_HOST that is a directory is the server's own socket, which only a command running
beside the server can reach; PostgreSQL lets its own superuser in there, and that is how the
local stack installs itself. The CLI can apply models and SQL scripts as any caller with the corresponding
native privileges. SQL files may contain explicit BEGIN/COMMIT. A file passed to `cli sql` is
not a psql script.

## PostgreSQL 18 and sign-in

People sign in through [Dex](https://dexidp.io). Dex federates your sign-in systems (OIDC,
SAML, LDAP, GitHub, Google, Microsoft and others are connectors in its configuration) and is
the single issuer PostgreSQL trusts, so adding a provider never touches the database.
PostgreSQL 18 verifies each token itself through its `oauth` authentication method.

The database server needs three things, all of which deploy/postgres provides as an image
(`docker build -t platform-postgres deploy/postgres`) that you can run or copy from:

1. PostgreSQL 18 or newer. `migrate` and `doctor` refuse anything older.
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
   installs and administers the server with a token from `bun run cli token`, like anyone
   else. An existing cluster is given one over the socket:
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

`bun run cli doctor`, run as a superuser, reads the live rules and fails if any network rule
lets a login in without a token: only `oauth` and `reject` pass. It then says, as notes that
fail nothing, what the deployment has left open: TLS that is off or a `host` rule that takes
a token without it, role catalogs every connection reads (`harden`), collections owned by a
person rather than a group, and tables that write no revisions.

`bun run cli lock ROLE` takes a role's login away and ends its open sessions; `unlock` gives
it back. It is how a person is locked out at once, and how the administrator is kept shut
between the times it is used: a locked role is logged in by no token. A superuser's login is
changed by a superuser, so the administrator is unlocked from beside the server
(`bun run cli deploy local admin unlock ROLE`, or the same command run in the server's
container with DATABASE_HOST naming the socket's directory).

A role and its sign-in are matched by name: the token's `email` claim must equal the role name
exactly, so alice@example.com logs in as the role `"alice@example.com"`. Nothing is mapped or
created automatically; a person with no role cannot log in. Role names are at most 63 bytes.

Dex's configuration is deploy/dex/config.yaml.tmpl, rendered from the environment by the Dex
image. It declares two public clients: `platform-console` (authorization code with PKCE, used by
the interface and redirecting to PUBLIC_URL) and `platform-psql` (device authorization, for psql
and `cli token`). For a real deployment:

- Give Dex one HTTPS URL that browsers and the PostgreSQL server can both open, and use it
  as DEX_ISSUER, PLATFORM_OIDC_ISSUER and OIDC_ISSUER.
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

## Interface configuration

The interface is a static site generated at build time: `bun run build:ui` writes the pages,
the client bundle, the stylesheet, the fonts, `config.json` and `_headers` to `packages/ui/dist`. A
deployment never renders a page at runtime and runs no application server: the files are
published to a CDN. The relay (`packages/relay/src/relay.ts`, the Dockerfile target `relay`) is the only
part of the path that answers on the network.

| Variable                       | Default                   | Purpose                                                                           |
| ------------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| PLATFORM_DOMAIN                | localhost                 | The domain the deployment is named by; each service answers on a sub-domain of it |
| PLATFORM_IDP_HOST              | idp                       | The sub-domain Dex answers on: the issuer                                         |
| PLATFORM_API_HOST              | api                       | The sub-domain the relay answers on                                               |
| PLATFORM_DB_HOST               | db                        | The sub-domain PostgreSQL answers on                                              |
| PLATFORM_PUBLIC_URL            | http://app.localhost:5173 | The address people open; the only origin the relay allows                         |
| PLATFORM_ISSUER                | http://idp.localhost:8080 | Your Dex. The same issuer PostgreSQL trusts                                       |
| PLATFORM_CLIENT_ID             | platform-console          | The public client the interface signs in with                                     |
| PLATFORM_CLAIM                 | email                     | Token claim holding the role name; must match the validator's                     |
| PLATFORM_RELAY_URL             | ws://api.localhost:8080   | The relay the pages open their sessions through                                   |
| PLATFORM_DATABASE_NAME         | platform                  | The database Platform is installed in                                             |
| PLATFORM_STATEMENT_TIMEOUT_MS  | 15000                     | `statement_timeout` sent with each login                                          |
| RELAY_UPSTREAM                 | 127.0.0.1:5432            | host:port of PostgreSQL, for the relay                                            |
| RELAY_PORT                     | 8081                      | The port the relay listens on                                                     |
| RELAY_ORIGINS                  | any                       | Comma-separated origins allowed to open a session; unset or `*` checks none       |
| RELAY_SESSIONS_PER_ADDRESS     | 20                        | Logins one client address may have signing in at once                             |
| RELAY_SESSIONS_PER_ROLE        | 20                        | Open database sessions one role may hold                                          |
| RELAY_SESSIONS_LOGGING_IN      | 64                        | Logins every address together may have signing in at once                         |
| RELAY_LOGIN_SECONDS            | 30                        | How long a session has to log in before it is closed                              |
| RELAY_TRUSTED_PROXIES          | none                      | Addresses or CIDR blocks whose X-Forwarded-For names a client                     |
| RELAY_UPSTREAM_TLS             | off, on this machine only | `verify` reaches PostgreSQL in TLS and checks its certificate; required otherwise |
| RELAY_UPSTREAM_CA              | the system's              | The authority that certificate must come from, as a PEM file                      |
| RELAY_TLS_CERT / RELAY_TLS_KEY | none                      | The certificate the relay serves TLS with                                         |

`bun run build:ui` writes `config.json` and the `_headers` file from these; see
[interface](interface.md) for `config.json`, the headers and the browser surface, and
`deploy/cdn/README.md` for publishing the site.

The page keeps one login open while the reader works, and opens another when two actions run
at the same time. It is not a shared service pool: the login is the reader's own, PostgreSQL
checks the token when it is opened, and `session_user` is the reader's role. The reader's own
statements run on a login of their own, so a transaction or a SET ROLE they leave open cannot
reach the platform's work. Every open WebSocket is one PostgreSQL connection: size PostgreSQL's
`max_connections` and per-role connection limits for the people who use the interface at once.
The relay caps the open sessions per role (RELAY_SESSIONS_PER_ROLE) and the logins signing in,
per client address (RELAY_SESSIONS_PER_ADDRESS) and in all (RELAY_SESSIONS_LOGGING_IN). A
session has no PostgreSQL connection until it has sent a whole startup packet, one that opens
with anything else is refused, and one that has not logged in within RELAY_LOGIN_SECONDS is
closed, so clients that never sign in cannot hold the database's connections for long. A
client that sends a startup packet and then stalls does hold one until that time is up: keep
RELAY_SESSIONS_LOGGING_IN, times the number of relays, well under `max_connections`. The caps are each relay's own: with two replicas, each counts for itself.
A role's own CONNECTION LIMIT is the server's, and counts for all of them: a manifest sets it
with `connections` on a user ([apply](apply.md)).

Behind a proxy every client arrives from the proxy's address, and shares one budget of logins.
Name the proxy in RELAY_TRUSTED_PROXIES (the ingress controller's pods, a load balancer's
range) and the relay counts a session against the client the proxy names in X-Forwarded-For
instead. Only a named proxy is believed, and only for this count: the header is never an
identity, and from any other address it is ignored.

The relay connects to PostgreSQL in TLS with RELAY_UPSTREAM_TLS=verify and in plain TCP with
RELAY_UPSTREAM_TLS=off. It has to be told which unless PostgreSQL is on the relay's own
machine (127.0.0.1, localhost): the stream carries every reader's token, so sending it across
a network in the clear is a choice the deployment makes, and the relay does not start without
it. With `verify` the
relay opens that connection in TLS from its first byte, the way PostgreSQL 17 and later accept
it (libpq's `sslnegotiation=direct`), checks the server's certificate against
RELAY_UPSTREAM_CA or the system's authorities, and checks that it names the host in
RELAY_UPSTREAM. PostgreSQL needs `ssl=on` and a certificate for that name; set
PLATFORM_HBA_HOST=hostssl beside it, so that nothing reaches the server in the clear. Without
it, run the relay next to PostgreSQL or on a private network you trust: the same host, the same
pod network, a service mesh with mTLS, or a tunnel. DATABASE_SSL and DATABASE_CA_FILE apply to
the CLI's connections, not to the interface's. Name the relay's addresses to PostgreSQL
(PLATFORM_TOKEN_ONLY_FROM or your own pg_hba rule), so that the administrator has no login
through the relay.

Connect directly to PostgreSQL for this design's authentication semantics. Do not put it
behind a pooler using a forced backend user: that changes session_user and breaks identity
and row policies. A pooler must preserve authenticated backend users and native role behavior,
and requires deployment-specific verification. The supplied examples use direct connections.

Each login makes PostgreSQL's validator fetch Dex's discovery document and signing keys, cached
only for as long as Dex's Cache-Control allows. If PostgreSQL cannot reach Dex, nobody but the
administrator can log in: treat Dex as part of the database's availability.

## Deployment

The deployment CLI supports Docker/Podman Compose and Kubernetes. `bun run deploy ...`
is shorthand for `bun run cli deploy ...`.

### Local containers

```bash
bun run cli deploy local validate
bun run cli deploy local up
bun run cli deploy local ui
bun run cli deploy local status
bun run cli deploy local logs -f relay
bun run cli deploy local down
```

A checkout carries no configuration: a deployment's settings are its own. The first run that
needs them — `up`, `init`, `build`, `validate`, `ui`, and the Kubernetes actions that render
or apply manifests — writes them to `.env` at the root of the checkout (or wherever
PLATFORM_ENV_FILE says). It asks only for what it cannot work out: the domain the deployment
is named by, the sub-domains its services answer on (idp, api, db), and the three ports,
because those are the ones that depend on the machine. The issuer, the relay's address and
the database's address follow from the domain and the sub-domains, so they are never asked
for.

The site is a question, not a default: the walkthrough asks whether one already exists, and
a site of the operator's own is named by its full URL. Left empty, an interface is deployed
instead, from a folder: any folder that holds a `platform.json`, which is any site built with
`@platform/ui`. PLATFORM_SITE names it, from the root of the checkout or in full
(`PLATFORM_SITE=examples/newsroom`, `PLATFORM_SITE=/srv/sites/desk`). The walkthrough offers
the examples the checkout carries (there is one, `newsroom`) and the platform's own interface
if none is chosen; a folder of your own is named in `.env` or the environment, and is then
not asked for. It is deployed on a sub-domain of the deployment's own domain — `app` unless
another is chosen — and the site's address follows from it. The folder that was chosen is the
one `deploy local ui` builds, and `deploy local up` builds it too and serves it from the stack
itself: a `site` container runs `platform ui serve` over the folder's `.dist`, and the edge
routes `app.<domain>` to it, on the port the edge answers on (`http://app.localhost:8080`).
Without a site nothing is served there. A configuration written before this, which says
`PLATFORM_EXAMPLE=newsroom`, is told to say `PLATFORM_SITE=examples/newsroom`. For Kubernetes it asks for the domain and the image;
the issuer and the database's address follow from the domain. The one
password there is, the break-glass administrator's, is never asked for: it is generated and
saved. What the command line or the environment already gave is kept and not asked for again.
The file holds the pieces the deployment is made of, and nothing else: the domain, the
sub-domains, the ports, the site's folder, and the site's address when one already exists.
The addresses — the issuer, the relay, the database, the deployed site's — are made of
those pieces at runtime, so they are never written down and never fall out of step with the
domain: change the domain and every address follows. A file that holds such an address from
an earlier run has it taken out, and the deployment is told which ones. The environment speaks
last: a value there overrides the file's, and an address that has to be something else is set
there.

The file holds secrets, so it is written with mode 0600, it is added to `.gitignore` if it is
not ignored already, and it is never printed. Without a terminal to ask in, the defaults are
written instead and the secrets are generated, which is what a script or a CI run gets. A file
that is already there is not rewritten: the settings it lacks are added to it, and the
entries it holds are left alone. Nothing is written when a value is wrong, or when a setting
that has no default could not be answered — the deployment then fails with the error that
names what is missing, and the file is not left half written.

The names have to answer in three places: in the browser, which opens the issuer and the
relay; in the PostgreSQL container, which fetches the issuer's keys; and in the operator's own
tools, which connect to the database. The Compose file gives the names to the containers
directly (`extra_hosts`), and `deploy local` gives them to this machine: a name under
`.localhost` is answered by the resolver itself, a name under `.local` is answered by
multicast DNS — which may be another machine on the network, and is said so plainly — and
anything else goes in the hosts file, which the operator is asked about before it is touched.

What answers on the network's usual ports is the deployment's business: here an edge
(Traefik, in deploy/traefik/dynamic.yaml), in Kubernetes an ingress, in a cloud the
provider's own domain settings. The services behind the edge listen on their own ports
(DEX_PORT, RELAY_PORT), which are the edge's backends and reach nothing else. Services that
talk to each other use the default ports: PostgreSQL on 5432, and the relay forwards to it
there.

Locally, the edge answers on ports of the operator's choosing — EDGE_PORT (8080) and
EDGE_TLS_PORT (4433) — and the names carry the port the edge answers on:
`http://idp.<domain>:8080` and `ws://api.<domain>:8080`. Never 80 or 443: a rootless
container cannot bind a port below 1024, and which ports the operator's machine answers on is
the operator's business. A deployment that terminates TLS itself — the ingress, the cloud's
own edge — has no such port in its names at all: `https://idp.<domain>` and
`wss://api.<domain>`.

`up` builds the PostgreSQL, relay and installer images, starts PostgreSQL 18 and Dex, waits
for both, runs the idempotent database installer in a one-off container (`migrate`, image
`platform-cli:local`, Dockerfile target `cli`), installs what the deployment's site applies the same way (`apply k8s --dir=/app/site`, with the
site's folder mounted there; `--administrator` when there is no site or it applies nothing), then
starts the relay and waits for http://api.localhost:8081/health. The installer is given no
credentials, because there are none: it shares the volume PostgreSQL's socket is on, where
PostgreSQL lets its own superuser in, has no network, and is removed when it exits.
`bun run cli deploy local admin <command>` runs any other operator command the same way
(`admin doctor`, `admin harden k8s`, `admin lock ROLE`, `admin unlock ROLE`); it reads no file of yours, so apply your own manifests
with a token. The relay has no PostgreSQL credentials. PostgreSQL and the relay share the
network `relay` (10.89.71.0/24). A build or install failure returns that
tool's exit status and stops the sequence before the relay starts. `init` runs the
database/build portion without starting the relay; `build` builds the images only. `ui`
builds the static interface into `packages/ui/dist` and says what to publish; the interface is
files on a CDN, not a container.

Dex is published at http://idp.localhost:5556 (DEX_PORT), on the deployment's own name
for it. It stands in for a real sign-in
system, and it keeps exactly one account with a password: the break-glass administrator,
PLATFORM_ADMIN — `admin` on the deployment's own domain, so admin@localhost, unless another
address is named — whose PLATFORM_ADMIN_PASSWORD is generated into .env (created with mode
0600, ignored by git and by the image build) and never printed; Dex is given only its bcrypt
hash. Every other account comes from a connector — an identity provider you add to the
stack's Dex (deploy/dex/config.yaml.tmpl) that vouches for the addresses it returns. The
example's roles (the administrator, alice@example.com, bob@example.com) are roles, not
accounts: who may sign in as them is the identity provider's business. The password is Dex's,
not PostgreSQL's: PostgreSQL sees the token Dex issues and nothing else. An issuer has one URL that both the
browser and PostgreSQL must open, and on a developer's machine that is localhost, so the
stack's Dex shares PostgreSQL's network namespace. The stack's data volume is `data18`: a
volume left by an earlier PostgreSQL 16 stack is not touched or upgraded. Move its contents
with pg_dump and pg_restore, and recreate roles under the names people sign in with.

Choose `--engine=docker` or `--engine=podman`, or use automatic detection. Standalone
`docker-compose`/`podman-compose` tools are supported when present. A POSTGRES_PASSWORD left
in .env by an earlier version is no longer read, and a volume made with one keeps a verifier
that no rule accepts. Provision users with
`PGTOKEN=$(bun run --silent cli token) bun run cli apply local FILE`, signed in as
the administrator (see [applying changes](apply.md)), or with psql and the example scripts.

The Compose project name is consistently `platform`. The default relay/SQL host ports are
8081/5432, and Dex's is 5556; override RELAY_PORT/POSTGRES_PORT/DEX_PORT to avoid
conflicts. `--timeout=120` sets the readiness allowance per component. `status`, `logs`, and
`down` generate nothing. `down` preserves data; explicitly passing `--volumes` removes
the volume and its data. The supplied stack binds both published ports to loopback and is for
local development.

### Kubernetes

Build and push the relay image (Dockerfile target `relay`) first, and publish the interface to
a CDN. PostgreSQL 18 with the validator and Dex are yours to run, configured as described
under PostgreSQL 18 and sign-in. Provision the database with `bun run cli migrate` in a
separate operator session/job (the Dockerfile target `cli` is an image for that), and provision
native users/grants. Then configure a pre-existing namespace, HTTPS ingress and network
policies.

```bash
export PLATFORM_IMAGE=your-registry/platform-relay:2.3.0
export PLATFORM_DOMAIN=platform.example.com
export PUBLIC_URL=https://platform.example.com
export OIDC_ISSUER=https://idp.platform.example.com
export DATABASE_HOST=your-postgres.example.com
export DATABASE_NAME=platform
export DATABASE_PORT=5432
bun run cli deploy k8s render --namespace=platform
bun run cli deploy k8s validate --namespace=platform
bun run cli deploy k8s diff --namespace=platform
bun run cli deploy k8s apply --namespace=platform
bun run cli deploy k8s status --namespace=platform
bun run cli deploy k8s logs --namespace=platform -f
```

The deployment is named by a domain: each service answers on its own sub-domain of it, and
the addresses follow — `idp.<domain>` for Dex, `api.<domain>` for the relay, `db.<domain>`
for PostgreSQL. Give the domain (`--domain`, or PLATFORM_DOMAIN) and the issuer, the relay's
address and the database's address are worked out from it; give any of them outright and
they are used as they are. Equivalent flags are --domain, --image, --public-url,
--oidc-issuer, --database-host, --database-port. PUBLIC_URL and OIDC_ISSUER
must be HTTPS. The database itself is the readers' own: they name it when they sign in, so
the deployment does not name it.
`render` is offline. `validate` is a server-side dry run and needs cluster connectivity.
`diff` preserves kubectl's exit 1 for differences; `apply` waits for rollout and propagates
failure. Namespace defaults to `default`, and `--timeout=120` controls the rollout timeout.
`down` deletes only the `platform-relay` deployment and service, not the external PostgreSQL
database. No namespace is created automatically.

The renderer uses deploy/k8s/deployment.yaml, fills endpoint/image values as YAML, adds the
selected namespace and feeds the resulting manifest to kubectl through stdin. The source
template remains unchanged, comments and all. It is one Deployment, `platform-relay`, whose pod runs the relay, and a
Service in front of it. The container holds no database credentials. PUBLIC_URL is the site's
address, and the only origin the relay allows; it is not an HTTPS listener. Supply your own
HTTPS ingress or tunnel: deploy/k8s/ingress.yaml is an example of one, and the address it
names is the one the site's `config.json` must carry (PLATFORM_RELAY_URL).

The manifest sets RELAY_UPSTREAM_TLS=verify: the relay reaches PostgreSQL in TLS and checks its
certificate, so PostgreSQL needs `ssl=on` and a certificate for the name the relay is given.
Set it to `off` only where the pods reach PostgreSQL over a network you trust with a token:
the same cluster network with network policies, a service mesh with mTLS, or a tunnel. Behind an ingress, set
RELAY_TRUSTED_PROXIES to the ingress controller's addresses, or every reader shares one budget
of logins. Name the pods' address range to PostgreSQL with PLATFORM_TOKEN_ONLY_FROM or your
own pg_hba rule, so that the administrator has no login through the relay, and name your
operators' networks with PLATFORM_ADMIN_FROM, so that the administrator has none from anywhere
else. For Azure or another
hosting platform, provision the same endpoint and separate operator installation through that
platform's normal infrastructure tooling.

`/health` proves the relay responds; it intentionally does not assert database health.
Sign in through the interface, or use an external database monitor, for end-to-end readiness.
A login can fail per role even when other roles can connect.

## Testing

Tests create a random database and roles, log in over TCP with tokens, then drop those test
resources. They run their own OpenID Connect issuer in the test process, at TEST_OIDC_ISSUER
(default http://127.0.0.1:54330), and the server under test is the deploy/postgres image
started trusting that issuer. Host networking lets the server fetch the issuer's keys from the
loopback address. The relay in front of the server carries the page's wire client the
way a browser's WebSocket does, at TEST_RELAY_URL (default ws://127.0.0.1:54331):

```bash
docker build -t platform-postgres:test deploy/postgres
docker run -d --name platform-test-pg --network host -e PGPORT=54329 \
  -e PLATFORM_ADMIN=installer@example.com \
  -e PLATFORM_OIDC_ISSUER=http://127.0.0.1:54330 \
  platform-postgres:test postgres -c listen_addresses=127.0.0.1
RELAY_UPSTREAM=127.0.0.1:54329 RELAY_PORT=54331 bun run relay &
bun run check
```

Use a disposable cluster: bootstrap group roles remain cluster-wide. The tests' administrator
is the role the server was started with in PLATFORM_ADMIN, and signs in with a token the
tests' issuer mints for it: the default test URL is
`postgres://installer%40example.com@127.0.0.1:54329/postgres`, and it carries no password.
Override TEST_ADMIN_URL for your test instance; TEST_DATABASE_SSL=require enables verified TLS
for every connection. CI builds the same image and
starts the same relay. Dex itself is not part of the automated tests. `bun run check` builds the
interface, typechecks, lints, checks formatting and runs `bun test`.

The server under test must be PostgreSQL 18 with the OAuth validator, and it must trust the
issuer the tests run in-process: the image above is one way to get that. Any PostgreSQL 18 with
`oauth_validator_libraries=pg_oidc_validator` will do, reached through TEST_ADMIN_URL, with a
superuser role of that URL's name and a `pg_hba.conf` allowing nothing but a token:

```
local   all  all                trust
host   all  "postgres"      all  reject
host   all  all           all  oauth issuer="http://127.0.0.1:54330" scope=""
```

`test/wire.test.ts` covers the page's wire client over TCP and through the relay.
`test/platform.test.ts` and `test/metadata.test.ts` exercise the security properties through the
same client the page uses (`test/page.ts`): actual login identity, forged/expired/foreign
tokens, a token used for another role, role passwords not being a login, the server's
authentication rules, NOLOGIN, impersonation, row and column enforcement, predicates/sorts, live
revocation, role delegation, write-only insert, DDL ownership, atomic modeling, CRM import,
version-guarded updates, trigger metadata, audit privacy/integrity, rollback and TRUNCATE.
`packages/ui/test/filter.test.ts` covers the record filters, `packages/cli/test/unit.test.ts`
the smaller pieces and `packages/cli/test/deploy.test.ts` the deployment CLI. Deployment tests exercise sequencing, failures,
renderer output and CLI dispatch using controlled tool substitutes; they do not provision real
infrastructure. Integration tests fail rather than silently skip when PostgreSQL is unavailable.

Back up database data/schema plus cluster roles (`pg_dumpall --roles-only`) using protected
storage. Restore ownership, memberships, ACLs, RLS policies, functions and triggers along with
data. Verify direct SQL and interface access as low-privilege accounts after restoring. A
role backup holds no password verifiers, because no role has a password. Back up Dex's storage as
well if you rely on its refresh tokens or signing keys surviving a restore.
