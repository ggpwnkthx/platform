# What the remake replaced

Platform 2.3.0 was rebuilt from the ground up on packages other people maintain. The database
is the same — `migrations/0001_platform.sql` is unchanged, so an installation of 2.3.0 needs no
migration — and so are the premise, the commands and the pages. What changed is whose code
does the work.

| What the platform wrote itself                                   | What does it now                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A PostgreSQL wire client for the page (`packages/pg-client`)     | Neon's serverless driver: node-postgres over a WebSocket, and its pool                                      |
| The token login, twice (page and CLI)                            | One forty-line addition to both drivers (`packages/core/src/token-client.ts`)                               |
| SQL quoting, filters, record queries (`vocabulary`, `data`)      | Kysely, with no driver behind it                                                                            |
| The sign-in: discovery, PKCE, the code exchange                  | oidc-client-ts in the page, openid-client in the CLI                                                        |
| Widgets: grid, form, drawer, toasts, pickers; 3,600 lines of CSS | Mantine, mantine-datatable, lucide; a theme and 200 lines of CSS                                            |
| Routing, loading and reloading what is read                      | React Router, TanStack Query                                                                                |
| A bundler script, a prerenderer, a dev server with rebuilds      | Vite                                                                                                        |
| Argument parsing and help                                        | citty                                                                                                       |
| A relay that counted sessions per address and per role           | A relay that forwards, and counts them only when told to: the edge and PostgreSQL count as well (see below) |
| A terminal layer for questions and progress                      | clack                                                                                                       |

## What behaves differently

- **Session caps are layered, and the edge's are the ones that count.** Sessions per client
  address are capped by the edge (Traefik `inFlightReq` in the local stack,
  `limit-connections` on the ingress), sessions per role by PostgreSQL's `CONNECTION LIMIT`, and
  stalled logins by `authentication_timeout`. The relay keeps its own caps as well, read from
  `RELAY_SESSIONS_PER_ADDRESS` and `RELAY_SESSIONS_PER_ROLE`; both are 0 — no limit — unless a
  deployment sets them, so a relay with no edge in front of it has no per-address cap of its own.
  `RELAY_SESSIONS_LOGGING_IN`, `RELAY_LOGIN_SECONDS` and `RELAY_TRUSTED_PROXIES` are gone.
- **Styles may be inline.** The Content-Security-Policy's `style-src` gained `'unsafe-inline'`,
  which Mantine needs. `script-src` is still `'self'`.
- **Pages are copies of one document** rather than prerendered one by one. Every address is
  still a real file.
- **A relation's constraint carries PostgreSQL's own name** (`<table>_<field>_fkey`) instead of
  a computed one. Existing constraints are found by their column, whatever their name.
- **A row policy's expression is checked by PostgreSQL alone.** The interface no longer parses
  it first; every statement is still sent as one prepared statement, so nothing can ride along.
- **`deploy local` does not edit the hosts file.** It prints the line to add.
- **Not carried over:** editors for an installation's own metadata keys
  (`registerMetadataKeyEditor`), and the reserved keys' editors under a row of
  `platform.item_metadata` in the record form. Renderers and field types are still registered
  from a site's extensions, now from `@platform/ui/extensions`.
- **The suite is smaller and needs no server.** See [validation](validation.md) for what was
  and was not verified.
