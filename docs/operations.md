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
platform_admins, installed with 2.0.1, holds the administrators who administer roles; its
members keep reading the raw role catalogs, and nobody else does.

`bun run cli migrate` installs what is missing and upgrades an installation that is behind,
in one transaction, under an advisory lock. An installation at an unknown version is refused
rather than modified.

The interface and the installation are one version. The interface reads the platform's
schema, and a schema of another version is not one it knows — a field's metadata, for
instance, is a column the platform added in 2.2.0. So an interface built for 2.2.0 against
an installation at 2.1.0 refuses to go further and says so:

```
This installation is at version 2.1.0 and the interface at 2.2.0.
Run `bun run cli migrate` to install 2.2.0.
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
bun run cli harden local     # the local stack, whose administrator is the superuser
bun run cli harden k8s       # a deployment: needs PGUSER/PGPASSWORD of the cluster superuser
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
PGUSER with PGPASSWORD or PGPASSWORD_FILE is the installer's administrator, the only login that
has a password. The CLI can apply models and SQL scripts as any caller with the corresponding
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
   host    all  all  10.89.71.0/24 oauth issuer="https://sso.example.com/dex" scope=""
   host    all  "postgres"    all  scram-sha-256   # the installer's administrator
   host    all  all           all  oauth issuer="https://sso.example.com/dex" scope=""
   ```

   Set PLATFORM_OIDC_ISSUER (required), PLATFORM_HBA_HOST=hostssl wherever TLS is configured,
   and PLATFORM_OIDC_CLAIM to match on a claim other than email. `scope=""` is deliberate:
   Dex puts no scope claim in its tokens, so there is none to require.
   PLATFORM_TOKEN_ONLY_FROM (comma-separated CIDR blocks, the second line above) names the
   relay's network: its token-only lines come before the administrator's password line, and
   the first matching rule decides, so from there nobody, not even the administrator, logs in
   with a password. The local stack sets it to the relay network's 10.89.71.0/24.

`bun run cli doctor`, run as a superuser, reads the live rules and fails if any network rule
lets a login in without a token: only `oauth`, `reject`, and `scram-sha-256` for explicitly
named logins pass.

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
- Add your providers under `connectors` and leave DEX_LOCAL_USERS unset.
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
  oauth_issuer=https://sso.example.com/dex oauth_client_id=platform-psql oauth_scope='openid email'"
```

libpq refuses an issuer that is not HTTPS unless PGOAUTHDEBUG=UNSAFE is set, which is for the
local stack only.

## Interface configuration

The interface is a static site generated at build time: `bun run build:ui` writes the pages,
the client bundle, the stylesheet, the fonts, `config.json` and `_headers` to `packages/ui/dist`. A
deployment never renders a page at runtime and runs no application server: the files are
published to a CDN. The relay (`packages/relay/src/relay.ts`, the Dockerfile target `relay`) is the only
part of the path that answers on the network.

| Variable                       | Default                   | Purpose                                                       |
| ------------------------------ | ------------------------- | ------------------------------------------------------------- |
| PLATFORM_PUBLIC_URL            | http://localhost:5173     | The address people open; the only origin the relay allows     |
| PLATFORM_ISSUER                | http://localhost:5556/dex | Your Dex. The same issuer PostgreSQL trusts                   |
| PLATFORM_CLIENT_ID             | platform-console          | The public client the interface signs in with                 |
| PLATFORM_CLAIM                 | email                     | Token claim holding the role name; must match the validator's |
| PLATFORM_RELAY_URL             | ws://localhost:8081       | The relay the pages open their sessions through               |
| PLATFORM_DATABASE_NAME         | platform                  | The database Platform is installed in                         |
| PLATFORM_STATEMENT_TIMEOUT_MS  | 15000                     | `statement_timeout` sent with each login                      |
| RELAY_UPSTREAM                 | 127.0.0.1:5432            | host:port of PostgreSQL, for the relay                        |
| RELAY_PORT                     | 8081                      | The port the relay listens on                                 |
| RELAY_ORIGINS                  | any                       | Comma-separated origins allowed to open a session             |
| RELAY_SESSIONS_PER_ADDRESS     | 20                        | Open database sessions one client address may hold            |
| RELAY_TLS_CERT / RELAY_TLS_KEY | none                      | The certificate the relay serves TLS with                     |

`bun run build:ui` writes `config.json` and the `_headers` file from these; see
[interface](interface.md) for `config.json`, the headers and the browser surface, and
`deploy/cdn/README.md` for publishing the site.

The page keeps one login open while the reader works, and opens another when two actions run
at the same time. It is not a shared service pool: the login is the reader's own, PostgreSQL
checks the token when it is opened, and `session_user` is the reader's role. The reader's own
statements run on a login of their own, so a transaction or a SET ROLE they leave open cannot
reach the platform's work. Every open WebSocket is one PostgreSQL connection: size PostgreSQL's
`max_connections` and per-role connection limits for the people who use the interface at once.
The relay caps the open sessions per role (RELAY_SESSIONS_PER_ROLE) and the logins signing in
per client address (RELAY_SESSIONS_PER_ADDRESS); behind a proxy all users share its address, so
set that cap for that or limit at the edge. Neither the relay nor PostgreSQL trusts X-Forwarded-For for
identity.

The relay connects to PostgreSQL in plain TCP: the browser cannot negotiate PostgreSQL's TLS
inside the stream. Run it next to PostgreSQL or on a private network you trust: the same host,
the same pod network, a service mesh with mTLS, or a tunnel. DATABASE_SSL and
DATABASE_CA_FILE apply to the CLI's connections, not to the interface's. Restrict PostgreSQL's
rules to tokens only from the relay's addresses (PLATFORM_TOKEN_ONLY_FROM or your own pg_hba
rule).

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

`up` builds the PostgreSQL, relay and installer images, starts PostgreSQL 18 and Dex, waits
for both, runs the idempotent database installer in a one-off container (`migrate`, image
`platform-cli:local`, Dockerfile target `cli`), then starts the relay and waits for
http://localhost:8081/health. The installer receives the operator password only in
its own environment and is removed when it exits. The relay has no
PostgreSQL credentials. PostgreSQL and the relay share the network `relay` (10.89.71.0/24),
from which PostgreSQL takes tokens and nothing else. A build or install failure returns that
tool's exit status and stops the sequence before the relay starts. `init` runs the
database/build portion without starting the relay; `build` builds the images only. `ui`
builds the static interface into `packages/ui/dist` and says what to publish; the interface is
files on a CDN, not a container.

Dex is published at http://localhost:5556/dex (DEX_PORT) and keeps three example people,
admin@example.com, alice@example.com and bob@example.com. Their passwords are
PLATFORM_ADMIN_PASSWORD, ALICE_PASSWORD and BOB_PASSWORD, generated into .env like the
administrator's; Dex is given only their bcrypt hashes. An issuer has one URL that both the
browser and PostgreSQL must open, and on a developer's machine that is localhost, so the
stack's Dex shares PostgreSQL's network namespace. The stack's data volume is `data18`: a
volume left by an earlier PostgreSQL 16 stack is not touched or upgraded. Move its contents
with pg_dump and pg_restore, and recreate roles under the names people sign in with.

Choose `--engine=docker` or `--engine=podman`, or use automatic detection. Standalone
`docker-compose`/`podman-compose` tools are supported when present. Set POSTGRES_PASSWORD_FILE
instead of POSTGRES_PASSWORD for a mounted/local secret file. When neither is set in the
environment or in .env, `up`, `init`, `build` and `validate` generate a random administrator
password and append it to .env (created with mode 0600, ignored by git and by the image build),
so later runs reuse it; the value is never printed. The same administrator password
must match an existing PostgreSQL volume: changing the variable does not reset existing
PostgreSQL credentials. Provision users with `bun run cli apply local FILE` (see
[applying changes](apply.md)) or with psql and the example scripts.

The Compose project name is consistently `platform`. The default relay/SQL host ports are
8081/5432, and Dex's is 5556; override RELAY_PORT/POSTGRES_PORT/DEX_PORT to avoid
conflicts. `--timeout=120` sets the readiness allowance per component. `status`, `logs`, and
`down` work without a password. `down` preserves data; explicitly passing `--volumes` removes
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
export PLATFORM_IMAGE=your-registry/platform-relay:2.2.0
export PUBLIC_URL=https://platform.example.com
export OIDC_ISSUER=https://sso.example.com/dex
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

Equivalent flags are --image, --public-url, --oidc-issuer, --database-host, --database-name,
--database-port. PUBLIC_URL and OIDC_ISSUER must be HTTPS.
`render` is offline. `validate` is a server-side dry run and needs cluster connectivity.
`diff` preserves kubectl's exit 1 for differences; `apply` waits for rollout and propagates
failure. Namespace defaults to `default`, and `--timeout=120` controls the rollout timeout.
`down` deletes only the `platform-relay` deployment and service, not the external PostgreSQL
database. No namespace is created automatically.

The renderer uses deploy/k8s/deployment.yaml, fills endpoint/image values, adds the selected
namespace and feeds the resulting manifest to kubectl through stdin. The source template
remains unchanged. It is one Deployment, `platform-relay`, whose pod runs the relay, and a
Service in front of it. The container holds no database credentials. PUBLIC_URL is the site's
address, and the only origin the relay allows; it is not an HTTPS listener. Supply your own
HTTPS ingress or tunnel: deploy/k8s/ingress.yaml is an example of one, and the address it
names is the one the site's `config.json` must carry (PLATFORM_RELAY_URL).

The relay reaches PostgreSQL in plain TCP, so the pods must reach it over a network you trust:
the same cluster network with network policies, a service mesh with mTLS, or a tunnel. Restrict
PostgreSQL's rules to the pods' address range with PLATFORM_TOKEN_ONLY_FROM or your own pg_hba
rule, so that from there PostgreSQL accepts tokens and nothing else. For Azure or another
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
  -e POSTGRES_PASSWORD=test-admin-password -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
  -e PLATFORM_OIDC_ISSUER=http://127.0.0.1:54330 \
  platform-postgres:test postgres -c listen_addresses=127.0.0.1
RELAY_UPSTREAM=127.0.0.1:54329 RELAY_PORT=54331 bun run relay &
bun run check
```

Use a disposable cluster: bootstrap group roles remain cluster-wide. The default test URL is
`postgres://postgres:test-admin-password@127.0.0.1:54329/postgres`. Override TEST_ADMIN_URL for
your test instance; TEST_DATABASE_SSL=require enables verified TLS for per-user connections
and the administrator URL should also specify its TLS settings. CI builds the same image and
starts the same relay. Dex itself is not part of the automated tests. `bun run check` builds the
interface, typechecks, lints, checks formatting and runs `bun test`.

The server under test must be PostgreSQL 18 with the OAuth validator, and it must trust the
issuer the tests run in-process: the image above is one way to get that. Any PostgreSQL 18 with
`oauth_validator_libraries=pg_oidc_validator` will do, reached through TEST_ADMIN_URL, with its
`pg_hba.conf` allowing the administrator's password and nothing else but a token:

```
local   all  all                trust
host   all  "postgres"      all  scram-sha-256
host   all  all           all  oauth issuer="http://127.0.0.1:54330" scope=""
```

`test/wire.test.ts` covers the page's wire client over TCP and through the relay.
`test/platform.test.ts` and `test/metadata.test.ts` exercise the security properties through the
same client the page uses (`test/page.ts`): actual login identity, forged/expired/foreign
tokens, a token used for another role, role passwords not being a login, the server's
authentication rules, NOLOGIN, impersonation, row and column enforcement, predicates/sorts, live
revocation, role delegation, write-only insert, DDL ownership, atomic modeling, CRM import,
version-guarded updates, trigger metadata, audit privacy/integrity, rollback and TRUNCATE.
`test/filter.test.ts` covers the record filters, `test/unit.test.ts` the smaller pieces and
`test/deploy.test.ts` the deployment CLI. Deployment tests exercise sequencing, failures,
renderer output and CLI dispatch using controlled tool substitutes; they do not provision real
infrastructure. Integration tests fail rather than silently skip when PostgreSQL is unavailable.

Back up database data/schema plus cluster roles (`pg_dumpall --roles-only`) using protected
storage. Restore ownership, memberships, ACLs, RLS policies, functions and triggers along with
data. Verify direct SQL and interface access as low-privilege accounts after restoring. The
administrator's password verifier in a role backup is sensitive. Back up Dex's storage as
well if you rely on its refresh tokens or signing keys surviving a restore.
