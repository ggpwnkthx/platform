# Specification

The normative behavior of the console: what it does, what it refuses, and where trust stops. Credentials are covered in [security.md](security.md); deployment in [operations.md](operations.md).

The console is the platform's web application: people read and change workspace data, operators administer access, and anyone reads service status. It is a **client** of the gateway, access service and data service, speaking their contracts. Every answer it shows comes from a service, under that service's spec.

Status: 1.0.0. Runtime: Bun ≥ 1.4.3. Listener: HTTP on
`CONSOLE_HOST:CONSOLE_PORT` (default `0.0.0.0:8083`).

---

## 1. Terms

| Term | Meaning |
| --- | --- |
| **caller** | The browser of a person using the console. |
| **operator** | A caller who administers a tenant or the platform. |
| **tenant** | A platform customer. The tenant's slug identifies its operators. |
| **session** | State the console keeps for a signed-in caller between requests. |
| **scope** | What an operator may do: the keys the access service holds for the caller on the console's route. |
| **ability** | A rendering of the scope and a workspace's grants. It hides what is refused; it never allows anything. |

Invariants, enforced in code and not configurable:

- The console **never decides access**. It asks the access service and renders the answer.
- The console **never reaches a database**. All data comes from a service over its contract.
- The caller's token **never reaches the browser**. The browser holds only a signed session identifier.
- The ability is a **mirror, never an authority**: an upper bound on what the caller may do, never a lower one (§5).
- The console **fails closed**. An unreadable context opens nothing; an unreachable service is shown as unreachable.

---

## 2. Requests

Every request passes through four middlewares in this order; one that refuses stops the request.

| Middleware | Does | Refuses |
| --- | --- | --- |
| Context | Composes services, reads or generates the request ID, writes the log line. | Never. |
| Headers | Sets response headers: never framed, never sniffed. | Never. |
| Origin | Requires state-changing requests to come from a console page. | `403`, before the session is read. |
| Session | Reads the caller's session and refreshes its cookie. | Never: no session means the caller is not signed in. |

### 2.1 Request ID

The request ID is the caller's `x-request-id` if it matches `^[A-Za-z0-9._-]{1,128}$`, otherwise a fresh UUID. It is returned in the `x-request-id` response header and written to the request's log line. Invalid IDs are replaced because the value ends up in logs and headers.

### 2.2 Origin of state-changing requests

Every `POST` must come from a console page: the browser's `Origin` must be the console's origin, or the request is refused with `403` before the session is read. A request with no `Origin` is accepted only if it also has no `Sec-Fetch-Site`; a client sending neither is not a browser, and the console is not a public API.

`GET`, `HEAD` and `OPTIONS` are not guarded: they change nothing.

### 2.3 Response headers

| Header | Value |
| --- | --- |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | Set when served over https. |

A **production** console sends a content security policy allowing only its own scripts (`script-src 'self'`) and refusing all framing (`frame-ancestors 'none'`), base URLs (`base-uri 'none'`) and objects (`object-src 'none'`). A development console sends none, because the Vite dev server injects inline scripts.

### 2.4 Logs

One JSON line per request: ID, method, path, status, duration. Probes (`/healthz`, `/readyz`) are not logged; the status board polls them every ten seconds.

---

## 3. Sessions

The browser holds only the **signed identifier** of a session (32 random bytes) in the `console_session` cookie.

| Attribute | Value |
| --- | --- |
| `HttpOnly` | Yes: the browser never reads it. |
| `SameSite` | `Lax`. |
| `Path` | `/`. |
| `Secure` | When served over https, or when `CONSOLE_COOKIE_SECURE=true`. |
| `Max-Age` | The session's remaining life. The cookie never outlives its session. |

A session ends after `CONSOLE_SESSION_TTL_MS` idle (8 hours) or `CONSOLE_SESSION_MAX_AGE_MS` total (24 hours). A login replaces the browser's existing session.

**Sessions live in process memory.** Run one replica, or pin each browser to a replica. The console holds no shared state.

### 3.1 Login

Sign-in uses the authorization code flow with PKCE (`S256`), a `state` and a `nonce`.

| Step | What happens |
| --- | --- |
| `GET /auth/login?redirect=<path>` | The server records the pending login, binds it to the browser with the `console_login` cookie (`Path=/auth/callback`), and redirects to the access service's authorization endpoint. |
| Provider | The access service signs the caller in at the tenant's provider and redirects back to `GET /auth/callback`. |
| `GET /auth/callback` | The pending login is consumed (once), the code is exchanged with the console's credential, the ID token is verified against the access service's keys, and a **session** is created. |

A pending login is single-use and lives ten minutes. The post-login redirect target is a **console path**, never a URL: redirecting to another site would carry the caller's session there.

`GET /auth/logout` destroys the session and clears its cookie.

---

## 4. Operator scope

The console asks the access service for the caller's **access context** on the console's route (`CONSOLE_ROUTE_ID`, default `console`), for the workspace named after the caller's tenant, and reads its keys.

| Key | Opens |
| --- | --- |
| `console.status` | Service status detail: versions, readiness, latencies. |
| `console.admin` | Administration of the caller's tenant. |
| `console.platform` | Administration of every tenant. |

Scope is **read, never assumed**. A context is a snapshot: the console keeps it until its `validUntil`, never longer, and rereads it on every page. A revoked right closes administration from the next page on. An unreadable context opens nothing.

The console acts with the operator's **tenant credential** when it holds one (`CONSOLE_TENANT_ADMIN_TOKENS`), otherwise with the **platform credential** (`CONSOLE_ADMIN_TOKEN`). The access service's audit names the operator of a tenant credential, so tenant changes are better signed by the tenant's own operator.

---

## 5. Ability

The ability renders the scope and a workspace's grants. The access service decides who holds a permission; the data service decides what a permission grants.

Every ability rule is an **upper bound**, never a lower one: the console hides what services refuse and shows what they allow. A button shown but refused by the data service is an annoyance; a button hidden but allowed is a fault.

The library has two wildcards, the action `manage` and the subject `all`. The console uses neither: every rule names its action and subject, and the wildcards match no rule.

---

## 6. Pages

### 6.1 Console endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | `200` while the process is up. Always available. |
| `GET /readyz` | `200` when the access service serves its discovery document, else `503`: a console that cannot sign anyone in is not ready. |
| `GET /auth/login` | Starts a login. |
| `GET /auth/callback` | Completes a login. |
| `GET /auth/logout` | Ends the session. |

### 6.2 Places

| Place | Shows | Calls |
| --- | --- | --- |
| `/` | The places and service state. | The three services' probes. |
| `/workspaces` | Workspaces named by the caller's grants, plus ones it opened. A workspace can also be opened by ID. | The caller's grants, read with its tenant's credential; `GET /ws/{id}/v1/me` per workspace. |
| `/workspaces/{id}` | Collections the policies open to the caller, and what it may do with them. | `/me`, `/schema` |
| `/workspaces/{id}/collections/{key}` | Records: searched, filtered (by rows or as JSON), sorted, cursor-paged. | `/schema/{key}`, `/items/{key}` |
| `/workspaces/{id}/collections/{key}/new` | Record creation. The form carries an idempotency key, so submitting twice creates one record. | `POST /items/{key}` |
| `/workspaces/{id}/collections/{key}/records/{id}` | A record: form, history, deletion. Changes carry the validator of the version the caller read. | `/items/{key}/{id}`, `PATCH`, `DELETE`, `/versions` |
| `/workspaces/{id}/collections/{key}/records/{id}/versions/{n}` | One version beside the current record, and rollback to it. | `/versions/{n}`, `/rollback` |
| `/workspaces/{id}/collections/{key}/aggregate` | Records grouped, counted and measured. | `/aggregate/{key}` |
| `/workspaces/{id}/model` | The workspace data model: collections, fields, rules, relations, and changes to them. | `/model` and its writes (`data.model.read`, `data.model.write`) |
| `/workspaces/{id}/audit` | Mutations committed in the workspace. | `/audit` (`data.audit.read`) |
| `/operators` | Platform tenants, and tenant creation. A single-tenant operator is sent to its tenant. | Access service administration. |
| `/operators/tenants/{slug}` | The tenant: counts, latest changes, form. | Same. |
| `/operators/tenants/{slug}/users` | Users, filtered by e-mail and status; registering one user, or a team in one batch. | Same. |
| `/operators/tenants/{slug}/users/{id}` | A user's rights (direct and through groups), groups, and registration (including disabling). | Same. |
| `/operators/tenants/{slug}/groups` | Groups, members and rights. | Same. |
| `/operators/tenants/{slug}/rights` | Every right of the tenant, live or ended; granting to a user or group, and revoking. | Same. |
| `/operators/tenants/{slug}/roles` | The tenant's roles. | Same. |
| `/operators/tenants/{slug}/audit` | Administration audit, exportable as CSV or JSONL. | Same. |
| `/status` | State of the three services. | Each service's `/healthz` and `/readyz`. |
| `/docs` | Platform documentation: shared docs, each service's contract, and the console's contract. | Nothing: docs are in the console build. |
| `/me` | The caller: subject, tenant and scope keys. | The caller's access context. |

A data service refusal is shown as-is: status, code, message, named fields, and request ID.

### 6.3 Platform map

The status page includes the **platform map**: request participants as lanes, and a request's exchanges as rows crossing them. Pick a request (a record, a sign-in, a grant change) and the map highlights the exchanges it crosses, in order.

The map's facts are a copy of the [atlas](../platform/atlas.html) facts; the docs check fails if the two diverge.

### 6.4 Documentation

The console renders the repository's `docs/` as written: it keeps no separate copy and changes nothing. Docs are read at build time and shipped in the build; the console image holds only the server build, which includes them.

Links are rewritten to their targets' addresses:

- a link to another doc becomes that doc's console address;
- a link to a heading becomes that heading's address;
- a link to any other repository file points to the repository at the tag of the console's version (tags don't move).

A heading's anchor is its text lowercased, punctuation removed, spaces replaced by hyphens: the same anchor a rendered Markdown file uses and the docs check resolves.

A quote that opens with a marker (`> [!NOTE]`, `> [!WARNING]`) is a callout: it carries its kind, the label of the kind and the tone of it. A quote without a marker stays a quote.

The page of a document is a frame around the document: the sidebar names every page of every group, the outline follows the reader down the document, and the previous page and the next page are at the foot of it. The index of the documentation opens with the pages to start with, and shows every page of every group as a card of its own. The frame needs no script: the copy button of a code block, the entry of the outline that is being read and the filter of the index are added by the browser, and the page is complete without them.

The place reads only the docs, no service. Anyone can read it; a missing doc is a console "not found", like any other missing page.

---

## 7. Service calls

The console calls the three services over their contracts, never a database and never a service of its own.

| Service | Called for |
| --- | --- |
| Access service | Login code exchange, the caller's access context, tenant administration. |
| Gateway | Workspace data, with the caller's token. The console reaches the data service **through** the gateway, like any client. |
| Data service | Probes only, for the status board. Data is never read from it directly. |

Every call carries the request ID, so console and service traces share one search key.

A call that takes longer than `CONSOLE_REQUEST_TIMEOUT_MS` (10 seconds) fails, and the page shows the service failure rather than an empty page.

---

## 8. Environment

The console reads its environment once at startup and validates it as a whole, reporting **every** problem before refusing to start, so an operator fixes them all in one pass. Variables, defaults and meanings: [operations.md](operations.md#environment).

A production console refuses to start unless `CONSOLE_PUBLIC_URL` is https or the deployment explicitly accepts plain http (`CONSOLE_COOKIE_SECURE=false`): serving cookies in the clear would expose operator sessions.

---

## 9. Out of scope

The console does not:

- decide access (it asks the access service and renders the answer);
- hold the gateway's identity-signing credential (with it, the console could impersonate the gateway);
- reach any platform database;
- sign identities of its own (every data request carries the caller's token);
- keep decisions (a revoked right closes administration from the next page on, and the service refuses anyway).

---

## 10. Code organization

| Directory | Contents |
| --- | --- |
| `src/domains/` | Rules: ability, access, authentication, data, documentation, operators, session, status, map. |
| `src/app/` | Wiring: routes, middleware, components, islands. |
| `src/runtime/` | Composition: configuration, services, logging. |

A domain holds rules, never transport; the app holds routes, never rules. The workspace's architecture check rejects imports that break this direction, and CI runs it.

---

## 11. Decision log

The console takes no decisions of its own: as a client, its decisions are those of the services it talks to. They are recorded in the [platform decisions](../platform/decisions.md) and the [gateway decisions](../gateway/decisions.md).
