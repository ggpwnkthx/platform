# Platform 2.1.0 validation

Verified on November 18, 2026 using Bun 1.4.4 and a real PostgreSQL 18.7 server built from
deploy/postgres, with pg_oidc_validator 1.1.0 and token-only network logins, and a websocat
v1.14.2 relay in front of it as described in [operations](operations.md#testing). No live
project database was accessed.

| Check                                 | Result                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| TypeScript strict typecheck           | Passed                                                                                  |
| PostgreSQL 18.7: `bun test`           | 110 tests passed, 0 failed, 403 assertions, across 6 files                              |
| The page's wire client                | 8 tests passed, over TCP and through the websocat relay                                 |
| Security properties through the page  | 46 platform and 15 metadata tests passed, using the page's own client (`test/page.ts`)  |
| Token logins in the integration suite | Real OAUTHBEARER logins verified by the server's validator against an in-process issuer |
| Record filters and smaller pieces     | 15 filter and 6 unit tests passed                                                       |
| Deployment CLI orchestration          | 20 tests passed, including subprocess stdin delivery                                    |

An earlier run, on November 17, 2026, against the architecture that preceded the interface,
covered what the interface did not change. Dex v2.46.1 ran end to end under podman-compose with
the Compose file's own PostgreSQL and Dex services: scripts playing the browser signed the three
example people in through Dex's password form; the authorization code flow with PKCE and a
cross-origin code exchange yielded a token PostgreSQL logged in as the right role; row and column
rules held per person; a password and a tampered token were refused; `cli token` and psql 18's
own device flow logged in as the role named by the token; `cli doctor` reported the
authentication rules as token-only; `cli apply` with a person's token was limited by PostgreSQL
to that person's rights. The role catalogs were hardened against a live PostgreSQL 18.7: after
the platform's own statements, an ordinary connection could no longer read `pg_auth_members`,
`pg_roles` or `pg_user`, an operator still could, the caller's own roles and memberships were
still answered through the platform's functions, `information_schema.applicable_roles` and
`pg_has_role` were unaffected, and PostgreSQL's default was restored by the same statements.

Not verified here:

- The interface in a real browser: rendering, the sign-in redirect round trip, the WebSocket
  through nginx, the Origin check, the session cap and browser-enforced CSP were not observed
  in this run. The development build's in-page PostgreSQL was not exercised by the tests.
- `bun run build:ui`, Biome lint and formatting, which are part of `bun run check` and were not
  part of this record.
- `deploy local up` from start to finish; its sequencing is covered by the orchestration tests
  with controlled command substitutes.
- Docker Compose, Kubernetes rollout, TLS, an upstream Dex connector, and Dex storage other
  than sqlite3.
- The GitHub Actions workflow.

Deployment tests use controlled command substitutes to verify build/install/start sequencing,
failure propagation, Podman detection, readiness timeouts, Kubernetes rendering, rollout,
namespace selection and secret isolation. They do not claim a live container or cluster rollout.
The import guide describes identity mapping and data loading. Trigger audit does not claim to
cover SELECT, DDL/DCL, authentication or privileged-owner tampering.
