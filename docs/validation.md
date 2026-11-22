# Platform 2.3.0 validation

The remake of 2.3.0 — the same database, rebuilt on other people's packages — was verified on
November 22, 2026 using Bun 1.4.4, Chrome and PGlite 0.5.17 (PostgreSQL compiled to
WebAssembly). No live project database was accessed.

| Check                                | Result                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| TypeScript strict typecheck          | Passed                                                                                       |
| Lint and formatting (Biome)          | Passed                                                                                       |
| `bun test`                           | 37 tests passed, 0 failed, 137 assertions, across 4 files                                    |
| Security properties, as each person  | 10 tests: catalog, rows and columns, version-guarded writes, audit privacy, grants, metadata |
| The SQL the platform writes          | 13 tests: grants and their differences, policies, roles, fields, metadata, manifests         |
| The page's connection and the relay  | 5 tests: an OAUTHBEARER login, statements both ways, one statement per query, the origin     |
| The operator's commands              | 9 tests: migrate, apply, dry run, doctor, lock, addresses, Kubernetes manifests              |
| The interface in Chrome (`test:e2e`) | 9 scenarios passed, under the site's own Content-Security-Policy                             |
| Both site builds                     | The published interface and the dev mode build; the published one carries no PGlite          |

The browser scenarios ran against the newsroom example with PostgreSQL in the page: a field
added, a field's name, views and renderers said, a grant narrowed, a row policy written, a
refusal shown with its SQLSTATE, a collection created, a record written and changed under
its version and found in the revisions, a search and a filter in the address, and a second
person held to her grants and policies. Three more ran against the published interface: a
sign-in through an issuer and back to the page asked for (oidc-client-ts, against a stand-in
issuer), the records arriving over a WebSocket through the relay from a real PostgreSQL engine,
a reload starting signed out, and a statement on a login of its own, one statement at a time.
`docker compose config` accepted the Compose file with the settings `deploy local` writes.

Not verified here:

- **A token login against PostgreSQL 18.** The page's OAUTHBEARER exchange was checked against
  a stand-in that speaks that part of the protocol, not against the server and its validator.
  Statements, pooling and transactions were checked against a real PostgreSQL engine behind
  the relay, which signs nobody in.
- **Dex itself.** The sign-in redirect ran against a stand-in issuer, not Dex.
- **`deploy local up` and a Kubernetes rollout.** No container engine was available: the
  Compose file, the images and the rollout were not started. The Kubernetes manifests were
  rendered and checked as text.
- **`cli token`** (openid-client's device flow) and **`harden`'s effect on a hardened
  cluster's interface**: the statements ran, on PGlite.
- The edge's session cap (Traefik `inFlightReq`, ingress `limit-connections`).

The earlier validation of 2.2.0, against PostgreSQL 18.7 with pg_oidc_validator and Dex, covered
the database and the deployment files, which this remake did not change apart from the session
caps moving from the relay to the edge and to PostgreSQL. It did not cover this code.
