# Security boundary

PostgreSQL owns authentication and authorization. Dex vouches for who a person is; PostgreSQL 18
verifies Dex's token on every connection and decides everything else. The transport is the
page and the relay: the page speaks PostgreSQL's protocol with the reader's own token, and the
relay forwards its bytes. Neither is a policy authority, and a bug in a statement the page
builds cannot make PostgreSQL grant a normal user another role's rights. This does not make a
compromised transport harmless: whoever controls the web server, the relay or the network
between the relay and PostgreSQL can read tokens in flight and act with any connected user's
privileges until those tokens expire. Protect the web host, its TLS termination, the relay's
network and the browser assets accordingly.

## Controls exercised by the integration tests

| Boundary              | Enforcement                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Identity              | PostgreSQL verifies each connection's token (signature, issuer, expiry) and logs in the LOGIN role its email claim names  |
| One way in            | Network logins are by token; a role password is not a login; forged, expired and foreign tokens fail                      |
| Revocation            | Native REVOKE and NOLOGIN; no application token cache                                                                     |
| Impersonation         | PostgreSQL checks SET ROLE and SET SESSION AUTHORIZATION                                                                  |
| Workspace             | Native schema USAGE/CREATE, ownership and object grants                                                                   |
| Fields                | Column ACLs apply to projection, predicates, sort and writes                                                              |
| Rows                  | Native RLS USING and WITH CHECK, based on session_user                                                                    |
| Validation            | PostgreSQL types and CHECK/NOT NULL/UNIQUE/FK constraints                                                                 |
| Write-only clients    | Writes return counts rather than RETURNING *                                                                              |
| Revisions             | Database triggers log every write, from the interface or any client, in the same transaction                              |
| Audit confidentiality | Revisions are readable only by workspace-owner members, and in each row only the columns the reader may SELECT            |
| Audit integrity       | Normal users cannot write/delete/truncate audit records or disable table triggers                                         |
| Owner restraint       | The guard refuses the DDL that would turn a collection out of row security, or drop its audit triggers, to ordinary roles |
| SQL construction      | Quoted identifiers; bound data values; escaped DDL literals                                                               |
| Protocol              | The page's wire client logs in by OAUTHBEARER and runs one bound statement per query, directly and through the relay      |
| State leakage         | One authenticated login per page; the reader's own statements run on a login of their own                                 |

The only SECURITY DEFINER helper that acts on the database appends real trigger records to
platform.activity. Its owner is platform_core, with no login or role-administration
privileges. (The guard's helpers are a second pair: they are owned by the cluster superuser
who installed the guard, they answer only about the caller, and they act on nothing.) The logged rows are read through one view of the same owner, platform.revisions,
which shows a workspace's owners its history and cuts each row down to the columns the reader
holds SELECT on in the table it was logged from (`platform.readable_row`); the rows in
platform.activity itself are granted to nobody. Public execution is revoked on the functions that act; the read-only helpers
that answer questions about the caller may be executed by anyone who may connect, and each
answers about the caller alone. Neither application settings nor a user-supplied actor become
identity inputs. Actor names and role OIDs are recorded; PostgreSQL role renaming does not
rewrite historical labels.

## Boundaries that remain administrative

Superusers, BYPASSRLS roles and object owners are trusted administrators, as in native
PostgreSQL. Table owners can alter policies, disable/drop triggers, replace tables and change
ownership. A workspace owner reads its revision history, but owning the workspace is not a
right on a column: a column withheld from them in a collection is withheld in its revisions
too, and the revisions of a table that has been dropped, or of a column that has been dropped
or renamed, show nothing of it to anyone but an operator reading the log itself. The owner of
a table holds every column of it, and reads them all. The audit table is append-only for ordinary roles, not tamper-proof against database owners,
platform_core members or superusers. RLS is not a substitute for withholding table ownership.

Raw SQL executes with the caller's native authority. There is no SQL sandbox or allowlist.
Users can perform expensive queries or use any database functions they are authorized to
call; PostgreSQL timeouts are defaults, not an unchangeable resource sandbox. Restrict native
extension/function grants, connection limits and infrastructure resources as appropriate.

Row triggers log INSERT/UPDATE/DELETE and a TRUNCATE event, not SELECT, failed attempts,
DDL/DCL, authentication events or deleted rows' contents during TRUNCATE. The platform's
PostgreSQL image writes connections and DDL/DCL statements to the server's log
(`log_connections`, `log_statement=ddl`); that log is the server's, and whoever administers
the server can change what it holds. Use pgAudit and an external protected log destination
when more of those events or tamper-resistant retention are required. Tables created manually need the audit/stamp triggers installed by
an owner; the project does not install a superuser event trigger to intercept all DDL.
`bun run cli doctor` names the tables that write no revisions, because they have no audit
trigger or it has been disabled, and the collections owned by a person rather than a group.

What an owner may not do, by PostgreSQL's own rules, is turn a collection out of row security
or drop the triggers that write its history: a table owner may do both. The guard
(`bun run cli harden <deployment> --events`, installed by the local stack as it installs
itself) refuses exactly those two statements to every role but a superuser and the operators
(the members of `platform_core` and `platform_admins`). It is an event trigger: it sees the
DDL as it runs, and says no. Everything else an owner may do — a column, a policy, a comment —
is theirs, and stays theirs.

PostgreSQL metadata normally exposes role and policy names/expressions to connected users.
The platform does not publish the role graph through its own functions:
`platform.visible_roles()` and `platform.visible_memberships()` return the roles and memberships
the caller may use, and the interface reads roles through them alone, so an ordinary session in
the interface is never shown who belongs to which group. Where it must know whether a name in
an ACL or a policy is still a role, it asks PostgreSQL for the role (`to_regrole`) and reads no
catalog, and the policy on the revisions does the same, so the interface keeps working once the
catalogs are hidden. The raw catalogs are PostgreSQL's,
and hiding them from psql is a separate, deliberate step: `bun run cli harden <deployment>`,
run as the cluster superuser; the local stack takes it as it installs itself, and `doctor`
says when it has not been taken. It revokes the public read of `pg_auth_members`, `pg_roles` and
`pg_user`; operators keep them through `platform_admins` and `platform_core`. Policy names and
expressions stay visible, as PostgreSQL publishes them, and so do schema and table names:
hiding the object catalogs is a separate and much wider change that breaks psql's `\d`,
`pg_dump` and most administration tools. RLS also has PostgreSQL's usual unique/FK constraint
side channels.

A folder is code, not data, and applying one runs it. Its `models.ts` is loaded and run by
`apply --dir`, with the operator's own rights. Its `migration.sql` and `demo.sql` are run as
they are, beside the server, and only where the caller is the server's own superuser, so a
folder's SQL carries the server's authority and not the operator's. Its `extensions.tsx` is put
in the place of the interface's own extensions module by `ui build --dir`, and runs in every
reader's browser. Take a folder from a source you would run code from, and keep the folder a
deployment applies one your own trust holds.

## Sign-in and its limits

Dex is the single issuer PostgreSQL trusts, so Dex and everything behind it are part of the
trust boundary:

- A token is a bearer credential. Whoever holds one is that person until it expires (one hour
  as shipped). Removing someone upstream stops new tokens, not ones already issued: use NOLOGIN
  to lock a person out at once (`bun run cli lock ROLE`, which also ends the sessions they
  hold). There is no token revocation list.
- The validator, pg_oidc_validator, checks signature, issuer and expiry. It does not check the
  audience, so a token Dex issues to any of its clients is accepted. Run a Dex for Platform
  alone and register no other clients with it.
- The role is chosen by the token's email claim. Every connector can assert any address it
  likes; a careless or hostile upstream provider can therefore log in as any role, including
  an administrator. Add only providers you would trust with that, and keep email verification
  on.
- One account in Dex may carry a password, and it is the break-glass administrator: the one
  that gets in when the identity providers do not. The local stack keeps exactly that one
  (`DEX_LOCAL_ADMIN`), and every other account comes from a connector. A password database
  with more than one account is a second, weaker sign-in system sitting beside the real one:
  it never rotates with the provider, and it is the one an attacker tries first. Keep the
  break-glass password out of the hands of ordinary use, change it when it has been used, and
  leave it alone otherwise.
- No login has a password, the administrator's included. The administrator is the role the
  server names in PLATFORM_ADMIN, a superuser who signs in with a token like anyone else: so
  whoever can make Dex issue a token for that address administers the server. From the relay's
  network (PLATFORM_TOKEN_ONLY_FROM) that login is refused outright, so a token that names it
  is not a way in through the interface. Name the operators' networks (PLATFORM_ADMIN_FROM)
  and it is refused from everywhere else as well: without that, a token for the administrator
  is good from any network that reaches PostgreSQL and is not listed. The server's own superuser (`postgres`) has no login
  over the network at all.
- An administrator that is reached from anywhere need not be reachable all the time. Locked
  (`lock`), no token logs it in, whoever issued it and wherever it comes from; it is unlocked
  from beside the server, through the socket, for as long as it is needed
  (`bun run cli deploy local admin unlock ROLE`, or the same command in the server's own
  container). A superuser's login is a superuser's to change, so nothing over the network
  gives it back.
- The one way in without a token is the server's own socket, inside its container: it makes
  the cluster, and it is what remains when Dex is unavailable. It needs a shell beside the
  server, which is the host's trust and not a credential. Guard that access as you would have
  guarded a password.
- Tokens are verified by PostgreSQL, not by the page. The page decodes a token only to learn
  which role to ask for and when it expires; a forged claim gets as far as PostgreSQL and fails
  there.
- If PostgreSQL cannot reach Dex's keys, token logins fail closed.

## Credentials and network

Use only the authentication rules in [operations](operations.md): tokens for the network and
nothing else, never a password and never trust, and from the relay's network no
administrator. `bun run cli doctor` checks that no network rule admits a login without a token. Require
HTTPS for the interface and for Dex, and expose the interface only through an HTTPS reverse
proxy or ingress; PUBLIC_URL itself does not enable an HTTPS listener. Do not log WebSocket
payloads or proxy request bodies: the `/pg` stream carries tokens, statements and rows.

The relay connects to PostgreSQL in TLS with RELAY_UPSTREAM_TLS=verify, with which it opens
that connection in TLS from its first byte and checks PostgreSQL's certificate, and in plain
TCP with RELAY_UPSTREAM_TLS=off. Unless PostgreSQL is on the relay's own machine the relay
does not start until it is told which. The
browser cannot negotiate PostgreSQL's TLS inside the stream, so DATABASE_SSL does not apply to
the interface's connections: the relay's own setting does. In the clear, run the relay next to
PostgreSQL or on a private network you trust: the same host, the same pod network, a service
mesh with mTLS, or a tunnel. The encryption between the browser and the relay is the
deployment's WSS. CLI connections are unaffected and still require verified PostgreSQL TLS in
production. `doctor` says when the server's TLS is off, and when a rule takes a token with or
without it (`host`, where `hostssl` would refuse one sent in the clear).

The interface signs in with the authorization code flow and PKCE, as a public client: it has no
client secret. It keeps the token only in JavaScript memory and hands it to PostgreSQL inside
the login. It uses no localStorage or cookies; sessionStorage holds the PKCE verifier across
the redirect to Dex and is cleared when the page returns. XSS or a compromised page can still
read the in-memory token. Reloading or signing out discards it. JavaScript strings cannot be
reliably zeroed from process memory.

The pages are static files generated at build time and published to a CDN, sent with a
content security policy that allows only the site's own scripts, styles, fonts and images, and
connections to the site's own origin, the relay's origin and the issuer's: `frame-ancestors
'none'`, `base-uri 'none'`,
`form-action 'self'`, with nosniff, no-referrer and, on https, HSTS. There is no inline script
and no server-side rendering of interface state, so the only code the browser executes is the
bundled application. The interface sets its own faces from fonts bundled into the build, so it
asks no third party for anything at runtime.

A WebSocket from any Origin but the site's own is refused with 403, so another site's page
cannot open a database session through a visitor's browser. The relay refuses to start at all
without that list, unless RELAY_ALLOW_ANY_ORIGIN=1 says that the edge in front of it checks the
origin itself: an unchecked origin is a decision, and it is said out loud. A CORS policy does
not do it, because a WebSocket handshake is not subject to one. What an unchecked origin gives
another site is small: the token lives in the page's memory and not in a cookie, so a session
opened from elsewhere has nothing to log in with. Each open WebSocket is one database
session, and the relay counts them: RELAY_SESSIONS_PER_ADDRESS and RELAY_SESSIONS_PER_ROLE
say how many one address, and one role, may hold at once. A session has no PostgreSQL
connection until it has sent a startup packet, and one that opens with anything else (a
request for TLS inside the stream, a cancel) is refused. Behind an edge the address the relay
sees is the edge's, so how many sessions an address may hold open is also capped by the edge
in front of the relay (20 in the shipped Traefik and ingress files), how many a role may hold
by the role's CONNECTION LIMIT in PostgreSQL, and a login that stalls is closed by PostgreSQL's
`authentication_timeout`. A relay exposed with no edge in front of it relies on the relay's own
cap: set RELAY_SESSIONS_PER_ADDRESS, and `max_connections` is then the last ceiling.
Each login asks for STATEMENT_TIMEOUT_MS as `statement_timeout`,
which a reader may change on their own session: PostgreSQL lets every role set it, so an
`ALTER ROLE ... SET` is a default too, and not a ceiling. What a reader cannot change is how
many sessions their role holds: a role's CONNECTION LIMIT (`connections` in a manifest's
`users[]`) is PostgreSQL's own count, across every relay. See [interface](interface.md) for the whole
browser surface.

The relay never reads PGTOKEN or an administrator URL, and
hold no database credentials and no OAuth client secret. Keep CLI secrets out of their
environment and manifests. Neither talks to Dex: the page does, from the browser.
