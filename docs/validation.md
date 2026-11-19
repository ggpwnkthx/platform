# Platform 2.2.0 validation

Verified on November 18, 2026 using Bun 1.4.4 and a real PostgreSQL 18.7 server with
pg_oidc_validator 1.1.0 — the pinned, checksummed release the deploy/postgres image builds —
and token-only network logins, and the project's own relay in front of it, as described in
[operations](operations.md#testing). No live project database was accessed.

That run covered 2.1.0. The change from 2.1.0 to 2.2.0 — metadata for fields, secured by the
field's own rights — was checked against PostgreSQL compiled to WebAssembly (PGlite) with the
real migrations and the real seed, but not against the server under test: the suites that need
it were not run here.

The suites live with the packages they belong to — `packages/cli/test`, `packages/relay/test`,
`packages/sql/test`, `packages/ui/test`, `examples/newsroom/test` — and the suites that cross
the packages, and need PostgreSQL, are in `test/`.

| Check                                 | Result                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| TypeScript strict typecheck           | Passed                                                                                  |
| `bun run check`                       | Passed: build, typecheck, lint, formatting and the whole suite                          |
| PostgreSQL 18.7: `bun test`           | 129 tests passed, 0 failed, 459 assertions, across 10 files                             |
| Deployment CLI orchestration          | 20 tests passed, including subprocess stdin delivery                                    |
| The relay                             | 4 tests passed: bytes both ways, the origin check, the session cap                      |
| The SQL the platform writes           | 8 tests passed, and 3 that hold the manifest and the interface to the same column       |
| The headers the site is served with   | 4 tests passed                                                                          |
| Record filters                        | 15 tests passed                                                                         |
| Smaller pieces                        | 6 unit tests passed                                                                     |
| The page's wire client                | 8 tests passed, over TCP and through the relay                                          |
| Security properties through the page  | 46 platform and 15 metadata tests passed, using the page's own client (`test/page.ts`)  |
| Token logins in the integration suite | Real OAUTHBEARER logins verified by the server's validator against an in-process issuer |

Beyond the suite, the model path was checked against the running server: `platform migrate`
installed the database, and `platform apply` applied the example manifest (20 changes) and
`deploy/models/crm.json` (59 changes). The columns carry the defaults their manifests declare
(`'USD'::text`, `false`, `true`) and the checks their options ask for
(`char_length(title) <= 120`, the allowed values of a status), and every relation's constraint
carries the name the interface computes for it — `fk_8325918d8f2048e7a353fd51` for
`crm.notes.contact`, the same name `constraintName('notes', 'contact')` returns.

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
  through the relay, the Origin check, the session cap and browser-enforced CSP were not
  observed in this run. The dev-mode build's in-page PostgreSQL was not exercised by the tests.
- The PostgreSQL-backed suites after the packages were split: `bun test` needs the test
  server of [operations](operations.md#testing), and it was not available where the split was
  made.
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
