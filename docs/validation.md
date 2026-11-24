# Platform 3.0.0 validation

The remake of 3.0.0 — the application layer rebuilt on react-admin, the operator's commands
moved to psql and SQL files — was verified on November 24, 2026 using Bun 1.4.4, Chrome,
Playwright 1.65.1 and PGlite 0.5.17 (PostgreSQL compiled to WebAssembly). No live project
database was accessed, and no container engine was running.

| Check                                | Result                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                      | Passed: both site builds' source typechecks, lints, is formatted, and no file is over 200 lines                                     |
| `bun test`                           | 90 tests passed, 0 failed, 285 assertions, across 17 files                                                                          |
| Security properties, as each person  | Catalog, rows and columns, version-guarded writes, audit privacy, grants and who may grant, metadata, hidden catalogs               |
| The guard                            | Every way round a guard that reads the statement: comments, DO blocks, renamed, disabled and replaced triggers, rules, child tables |
| The SQL the platform writes          | Grants and their differences, policies, roles, fields, constraints, metadata                                                        |
| The page's connection and the relay  | An OAUTHBEARER login, statements both ways, one statement per query, the origin, the first packet, the session caps                 |
| The operator's SQL files             | The migration, the example's schema and records, the CRM model, `harden`, `guard`, `restore`, `doctor`                              |
| The interface's own rules            | No colour or size outside the theme; nothing kept outside memory; the Content-Security-Policy as written                            |
| The interface in Chrome (`test:e2e`) | 22 scenarios passed, under the site's own Content-Security-Policy, with no error reported by the page                               |

Eighteen browser scenarios ran against the dev mode, with PostgreSQL in the page: a field
added; a field's name and where it appears said; a grant narrowed to the difference; a row
policy written; a refusal shown with its SQLSTATE; a collection made, with a relation and
choices; a many-to-many made in one step; a record written, changed under its version and
found in its revisions; a search and a filter in the address; a record linked to another;
the rows that point at a record counted; the search following a relation; a filter by the
rows a record is linked to; chosen rows deleted together and found in the revisions; alice
held to her grants and the policies; a GRANT of hers that changes nothing shown as
PostgreSQL's warning, and her session kept hers; the navigation pane behind its menu button
at 390px; and a write of hers that PostgreSQL refuses, shown as it refused it. Four ran
against the published site: a sign-in through an issuer and back to the page asked for
(openid-client, against a stand-in issuer that signs its token), the records arriving over a
WebSocket through the relay from a real PostgreSQL engine, a reload starting signed out, a
statement on a login of its own, one statement at a time, with a warning arriving beside its
answer, and the published bundle carrying no in-page PostgreSQL.

Every page was then opened in a browser as the administrator and as alice — the sign-in, the
records of a collection, a record, a new record, a workspace, a collection's model, the grant
editor, users and groups, a role, the activity, the SQL page and the system workspace — and
read against DESIGN.md; the records, a record, the menu and a collection's access were also
opened at 390px. The pages reported no error. `docker compose config` accepted the
Compose file with the settings `deploy local` writes, and `deploy k8s render` produced the
manifests.

Not verified here:

- **A token login against PostgreSQL 18.** The page's OAUTHBEARER exchange was checked against
  a stand-in that speaks that part of the protocol, not against the server and its validator.
  Statements, pooling and transactions were checked against a real PostgreSQL engine behind
  the relay, which signs nobody in.
- **Dex itself.** The sign-in redirect ran against a stand-in issuer, not Dex. openid-client
  checks more of an issuer's answer than the library it replaced; Dex's own answer was not
  put to it.
- **`deploy local up` and a Kubernetes rollout.** No container engine was running: the
  images, the `site` image among them, were not built, and the stack was not started. The
  psql steps the stack runs beside the server were not run there; the same SQL files were
  run on PGlite.
- **psql's own sign-in through Dex**, and every command of docs/operations.md that needs a
  PostgreSQL 18 server: they were written from PostgreSQL's documentation and the previous
  release's validated commands, not run.
- **`doctor.sql`'s reading of pg_hba.conf** on a server with real rules, and `harden.sql`'s
  effect on a hardened cluster's interface beyond PGlite.
- The edge's session cap (Traefik `inFlightReq`, ingress `limit-connections`).
- **A bulk delete refused for a stale version, in a browser.** The version guard of a delete
  is tested in core; the browser scenario deletes rows whose versions are current.
- **Backpressure in the relay** from the browser to PostgreSQL: the code pauses the WebSocket
  while the socket is full, and no test fills it.
- Screens between 390px and 1440px other than those two widths.
- A continuous-integration run: the archive held no workflow.

The earlier validation of 2.2.0, against PostgreSQL 18.7 with pg_oidc_validator and Dex, covered
the database and the deployment files. This remake changed the migration (the views of the
catalog), the Compose file (no installer container; a static `site` image) and the Kubernetes
manifest's placeholders, so that validation does not cover them.
