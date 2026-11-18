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

| Boundary              | Enforcement                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity              | PostgreSQL verifies each connection's token (signature, issuer, expiry) and logs in the LOGIN role its email claim names |
| One way in            | Network logins are by token; a role password is not a login; forged, expired and foreign tokens fail                     |
| Revocation            | Native REVOKE and NOLOGIN; no application token cache                                                                    |
| Impersonation         | PostgreSQL checks SET ROLE and SET SESSION AUTHORIZATION                                                                 |
| Workspace             | Native schema USAGE/CREATE, ownership and object grants                                                                  |
| Fields                | Column ACLs apply to projection, predicates, sort and writes                                                             |
| Rows                  | Native RLS USING and WITH CHECK, based on session_user                                                                   |
| Validation            | PostgreSQL types and CHECK/NOT NULL/UNIQUE/FK constraints                                                                |
| Write-only clients    | Writes return counts rather than RETURNING *                                                                             |
| Revisions             | Database triggers log every write, from the interface or any client, in the same transaction                             |
| Audit confidentiality | Full revisions are readable only by workspace-owner members                                                              |
| Audit integrity       | Normal users cannot write/delete/truncate audit records or disable table triggers                                        |
| SQL construction      | Quoted identifiers; bound data values; escaped DDL literals                                                              |
| Protocol              | The page's wire client logs in by OAUTHBEARER and runs one bound statement per query, directly and through the relay     |
| State leakage         | A fresh authenticated connection per action, always closed                                                               |

The only SECURITY DEFINER helper that acts on the database appends real trigger records to
platform.activity. Its owner is platform_core, with no login or role-administration
privileges. Public execution is revoked on the functions that act; the read-only helpers
that answer questions about the caller may be executed by anyone who may connect, and each
answers about the caller alone. Neither application settings nor a user-supplied actor become
identity inputs. Actor names and role OIDs are recorded; PostgreSQL role renaming does not
rewrite historical labels.

## Boundaries that remain administrative

Superusers, BYPASSRLS roles and object owners are trusted administrators, as in native
PostgreSQL. Table owners can alter policies, disable/drop triggers, replace tables and change
ownership. A workspace owner can read its full revision history, including private columns.
The audit table is append-only for ordinary roles, not tamper-proof against database owners,
platform_core members or superusers. RLS is not a substitute for withholding table ownership.

Raw SQL executes with the caller's native authority. There is no SQL sandbox or allowlist.
Users can perform expensive queries or use any database functions they are authorized to
call; PostgreSQL timeouts are defaults, not an unchangeable resource sandbox. Restrict native
extension/function grants, connection limits and infrastructure resources as appropriate.

Row triggers log INSERT/UPDATE/DELETE and a TRUNCATE event, not SELECT, failed attempts,
DDL/DCL, authentication events or deleted rows' contents during TRUNCATE. Use PostgreSQL
logging/pgAudit and an external protected log destination when those events or tamper-resistant
retention are required. Tables created manually need the audit/stamp triggers installed by
an owner; the project does not install a superuser event trigger to intercept all DDL.

PostgreSQL metadata normally exposes role and policy names/expressions to connected users.
The platform does not publish the role graph through its own functions:
`platform.visible_roles()` and `platform.visible_memberships()` return the roles and memberships
the caller may use, and the interface reads roles through them alone, so an ordinary session in
the interface is never shown who belongs to which group. The raw catalogs are PostgreSQL's,
and hiding them from psql is a separate, deliberate step: `bun run cli harden <deployment>`,
run as the cluster superuser. It revokes the public read of `pg_auth_members`, `pg_roles` and
`pg_user`; operators keep them through `platform_admins` and `platform_core`. Policy names and
expressions stay visible, as PostgreSQL publishes them, and so do schema and table names:
hiding the object catalogs is a separate and much wider change that breaks psql's `\d`,
`pg_dump` and most administration tools. RLS also has PostgreSQL's usual unique/FK constraint
side channels.

## Sign-in and its limits

Dex is the single issuer PostgreSQL trusts, so Dex and everything behind it are part of the
trust boundary:

- A token is a bearer credential. Whoever holds one is that person until it expires (one hour
  as shipped). Removing someone upstream stops new tokens, not ones already issued: use NOLOGIN
  to lock a person out at once. There is no token revocation list.
- The validator, pg_oidc_validator, checks signature, issuer and expiry. It does not check the
  audience, so a token Dex issues to any of its clients is accepted. Run a Dex for Platform
  alone and register no other clients with it.
- The role is chosen by the token's email claim. Every connector can assert any address it
  likes; a careless or hostile upstream provider can therefore log in as any role, including
  an administrator. Add only providers you would trust with that, and keep email verification
  on.
- The installer's administrator is the one login with a password, kept for installation and for
  when Dex is unavailable. Guard it accordingly and keep it out of the interface and the relay.
  From the relay's network (PLATFORM_TOKEN_ONLY_FROM) it is not accepted at all.
- Tokens are verified by PostgreSQL, not by the page. The page decodes a token only to learn
  which role to ask for and when it expires; a forged claim gets as far as PostgreSQL and fails
  there.
- If PostgreSQL cannot reach Dex's keys, token logins fail closed.

## Credentials and network

Use only the authentication rules in [operations](operations.md): tokens for the network, a
password for the named administrator alone, never trust, and from the relay's network tokens
only. `bun run cli doctor` checks that no network rule admits a login without a token. Require
HTTPS for the interface and for Dex, and expose the interface only through an HTTPS reverse
proxy or ingress; PUBLIC_URL itself does not enable an HTTPS listener. Do not log WebSocket
payloads or proxy request bodies: the `/pg` stream carries tokens, statements and rows.

The relay connects to PostgreSQL in plain TCP. The browser cannot negotiate PostgreSQL's TLS
inside the stream, and websocat does not speak PostgreSQL's SSLRequest, so DATABASE_SSL does not
apply to the interface's connections. Run the relay next to PostgreSQL or on a private network
you trust: the same host, the same pod network, a service mesh with mTLS, or a tunnel. The
encryption between the browser and the web server is the deployment's HTTPS (wss). CLI
connections are unaffected and still require verified PostgreSQL TLS in production.

The interface signs in with the authorization code flow and PKCE, as a public client: it has no
client secret. It keeps the token only in JavaScript memory and hands it to PostgreSQL inside
the login. It uses no localStorage or cookies; sessionStorage holds the PKCE verifier across
the redirect to Dex and is cleared when the page returns. XSS or a compromised page can still
read the in-memory token. Reloading or signing out discards it. JavaScript strings cannot be
reliably zeroed from process memory.

The pages are static files generated at build time, sent with a content security policy that
allows only the site's own scripts, styles, fonts and images, and connections to the site's own
origin, its WebSocket origin and the issuer's: `frame-ancestors 'none'`, `base-uri 'none'`,
`form-action 'self'`, with nosniff, no-referrer and, on https, HSTS. There is no inline script
and no server-side rendering of interface state, so the only code the browser executes is the
bundled application. The interface sets its own faces from fonts bundled into the build, so it
asks no third party for anything at runtime.

A WebSocket to `/pg` from any Origin but PUBLIC_URL's is refused with 403, so another site's page
cannot open a database session through a visitor's browser. Each open WebSocket is one database
session; nginx caps how many one client address may hold (SESSIONS_PER_ADDRESS, 20), and the
relay caps its own total (256). Each login asks for STATEMENT_TIMEOUT_MS as `statement_timeout`,
which a reader may change on their own session. See [interface](interface.md) for the whole
browser surface.

The web server and the relay never read PGTOKEN, PGUSER/PGPASSWORD or an administrator URL, and
hold no database credentials and no OAuth client secret. Keep CLI secrets out of their
environment and manifests. Neither talks to Dex: the page does, from the browser.
