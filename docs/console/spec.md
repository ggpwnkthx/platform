# Specification

The normative behavior of the console: what it does, what it refuses, and where trust stops. It is for implementers and reviewers; variables are in [configuration.md](configuration.md) and deployment is in [operations.md](operations.md).

The console is the platform's web application: people read and change workspace data, operators administer access, and anyone reads service status. It is a **client** of the gateway, Access and Data and speaks their contracts. Every answer it shows comes from one of those services and is governed by that service's spec.

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
| **scope** | What an operator may do: the keys Access holds for the caller on the console's route. |
| **ability** | A rendering of the scope and a workspace's grants. It hides what is refused; it never allows anything. |

### 1.1 Invariants

These hold in code and are not configurable:

- The console **never decides access**. It asks Access and renders the answer.
- The console **never reaches a database**. All data comes from a service over its contract.
- The caller's token **never reaches the browser**. The browser holds only a signed session identifier.
- The ability is a **mirror, never an authority**: it is an upper bound on what the caller may do, never a lower one (§5).
- The console **fails closed**. An unreadable context opens nothing, and an unreachable service is shown as unreachable.

---

## 2. Requests

Every request passes through four middlewares in this order. When one refuses, the request stops there.

| Middleware | Does | Refuses |
| --- | --- | --- |
| Context | Composes services, reads or generates the request ID, writes the log line. | Never. |
| Headers | Sets response headers: never framed, never sniffed. | Never. |
| Origin | Requires state-changing requests to come from a console page. | `403`, before the session is read. |
| Session | Reads the caller's session and refreshes its cookie. | Never: no session means the caller is not signed in. |

### 2.1 Request ID

The request ID is the caller's `x-request-id` when it matches `^[A-Za-z0-9._-]{1,128}$`, and a fresh UUID otherwise. The console returns it in the `x-request-id` response header and writes it to the request's log line.

### 2.2 Origin of state-changing requests

A request that may change something (any method other than `GET`, `HEAD` and `OPTIONS`) must come from a console page. The browser's `Origin` must be the console's public origin or the origin of the address the request reached; otherwise the console answers `403` before reading the session.

A request without `Origin` is accepted when it carries no `Sec-Fetch-Site`, or a `Sec-Fetch-Site` of `same-origin`. A `Sec-Fetch-Site` that names another site is refused even without an `Origin`. A client that sends neither header is not a browser, and the console is not a public API.

`GET`, `HEAD` and `OPTIONS` are not guarded, because they change nothing.

### 2.3 Response headers

| Header | Value |
| --- | --- |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | Set when served over https. |

A **production** console sends a content security policy that allows only its own scripts (`script-src 'self'`) and refuses all framing (`frame-ancestors 'none'`), base URLs (`base-uri 'none'`) and objects (`object-src 'none'`). A development console sends no policy, because the Vite dev server injects inline scripts.

### 2.4 Logs

The console writes one JSON line per request with the ID, method, path, status and duration. Probe requests (`/healthz`, `/readyz`) are not logged, since the status board polls them every ten seconds.

---

## 3. Sessions

The browser holds only the **signed identifier** of a session (32 random bytes), in the `console_session` cookie.

| Attribute | Value |
| --- | --- |
| `HttpOnly` | Yes: the browser never reads it. |
| `SameSite` | `Lax`. |
| `Path` | `/`. |
| `Secure` | When served over https, or when `CONSOLE_COOKIE_SECURE=true`. |
| `Max-Age` | The session's remaining life. The cookie never outlives its session. |

A session ends after `CONSOLE_SESSION_TTL_MS` without use (8 hours) or `CONSOLE_SESSION_MAX_AGE_MS` in total (24 hours), whichever comes first. A login replaces the browser's existing session.

**Sessions live in process memory.** Run one replica, or pin each browser to a replica; the console holds no shared state.

### 3.1 Login

Sign-in uses the authorization code flow with PKCE (`S256`), a `state` and a `nonce`.

| Step | What happens |
| --- | --- |
| `GET /auth/login?redirect=<path>` | The server records the pending login, binds it to the browser with the `console_login` cookie (`Path=/auth/callback`), and redirects to Access's authorization endpoint. |
| Provider | Access signs the caller in at the tenant's provider and redirects back to `GET /auth/callback`. |
| `GET /auth/callback` | The pending login is consumed (once), the code is exchanged with the console's credential, the ID token is verified against Access's keys, and a **session** is created. |

A pending login is single-use and lives ten minutes. The post-login redirect target must be a **console path**, never a URL, because redirecting to another site would carry the caller's session there.

`POST /auth/logout` destroys the session and clears its cookie; it is a state-changing request, so the origin rule of §2.2 applies.

---

## 4. Operator scope

The console asks Access for the caller's **access context** on the console's route (`CONSOLE_ROUTE_ID`, default `console`), for the workspace named after the caller's tenant, and reads the keys it holds.

| Key | Opens |
| --- | --- |
| `console.status` | Service status detail: versions, readiness, latencies. |
| `console.admin` | Administration of the caller's tenant. |
| `console.platform` | Administration of every tenant. |

Scope is **read, never assumed**. A context is a snapshot: the console keeps it until its `validUntil` and never longer, and reads it again on every page. A revoked right closes administration from the next page on. An unreadable context opens nothing.

The console acts with the operator's **tenant credential** when it holds one (`CONSOLE_TENANT_ADMIN_TOKENS`), and with the **platform credential** (`CONSOLE_ADMIN_TOKEN`) otherwise. Access's audit names the operator of a tenant credential, so changes to a tenant are better signed by that tenant's own operator.

---

## 5. Ability

The ability renders the scope and a workspace's grants. Access decides who holds a permission; Data decides what a permission grants.

Every ability rule must be an **upper bound**, never a lower one: the console hides what services refuse and shows what they allow. A button that is shown but refused by Data is an annoyance; a button that is hidden although allowed is a fault.

The ability library has two wildcards, the action `manage` and the subject `all`. The console uses neither: every rule names its action and subject, and the wildcards match no rule.

---

## 6. Pages

### 6.1 Console endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | `200` while the process is up. Always available. |
| `GET /readyz` | `200` when Access serves its discovery document, else `503`: a console that cannot sign anyone in is not ready. |
| `GET /auth/login` | Starts a login. |
| `GET /auth/callback` | Completes a login. |
| `POST /auth/logout` | Ends the session. A `GET` only redirects to `/`. |

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
| `/operators` | Platform tenants, and tenant creation. A single-tenant operator is sent to its tenant. | Access administration. |
| `/operators/tenants/{slug}` | The tenant: counts, latest changes, form. | Same. |
| `/operators/tenants/{slug}/users` | Users, filtered by e-mail and status; registering one user, or a team in one batch. | Same. |
| `/operators/tenants/{slug}/users/{id}` | A user's rights (direct and through groups), groups, and registration (including disabling). | Same. |
| `/operators/tenants/{slug}/groups` | Groups, members and rights. | Same. |
| `/operators/tenants/{slug}/rights` | Every right of the tenant, live or ended; granting to a user or group, and revoking. | Same. |
| `/operators/tenants/{slug}/roles` | The tenant's roles. | Same. |
| `/operators/tenants/{slug}/audit` | Administration audit, exportable as CSV or JSONL. | Same. |
| `/status` | State of the three services. | Each service's `/healthz` and `/readyz`. |
| `/docs` | Platform documentation, arranged around the reader's role (§6.4): a choice of roles, or the chosen role's map, then every area. `?role=` records or clears the choice. | Nothing: docs are in the console build. |
| `/me` | The caller: subject, tenant and scope keys. | The caller's access context. |

A Data refusal is shown as it came: status, code, message, named fields and request ID.

Every page header links the places the caller may reach: the overview, the workspaces and the operators. The status and documentation places sit in every page's footer instead, and every caller may open both.

### 6.3 Platform map

The status page includes the **platform map**: request participants drawn as lanes, and a request's exchanges drawn as rows that cross them. Picking a request (a record, a sign-in, a grant change) highlights the exchanges it crosses, in order.

The map's facts are a copy of the [atlas](../platform/atlas.html) facts, and the docs check fails if the two diverge.

### 6.4 Documentation

The console renders the repository's `docs/` tree as written. It keeps no separate copy and changes nothing. The docs are read at build time and shipped in the build; the console image holds only the server build, which includes them.

Pages are grouped by directory: the top-level `docs/README.md`, then `platform/`, one directory per service, and the remaining directories such as the role and task guides. Within a group, the console sorts each page into a tier by its file name:

| Tier | Pages | Shown |
| --- | --- | --- |
| Overview | The directory's `README.md` | As the group's index. |
| Guides | Every page no other tier names (operations, user guides, quickstarts and similar) | In the reading path. |
| Reference | `spec.md`, `api.md`, `configuration.md` | In the reading path. |
| Internals | `internals.md`, `decisions.md` | Collapsed in the navigation and kept out of the reading path. |

A page's title is its first-level heading and its summary is the paragraph that follows it; the index lists every page by both. A page that has a `Contents` section of its own gets no generated outline.

Links are rewritten to their targets' addresses:

- a link to another doc becomes that doc's console address;
- a link to a heading becomes that heading's address;
- a link to any other repository file points to the repository at the tag of the console's version (tags don't move).

A heading's anchor is its text lowercased, punctuation removed and spaces replaced by hyphens: the same anchor a rendered Markdown file uses and the docs check resolves.

**Reading by role.** The roles are the pages of `docs/roles/` other than its `README.md`, in the order that index links them. A role's title and summary are its page's; its sections are the page's second-level headings, and the entries of a section are the list items and table rows under it that link to a doc or a file of the docs tree. A table row whose first cell is plain text is labelled by that text, so a task reads as the task. Links to the repository, to the web and to other role pages are not entries. A role's reading order is its page, then every doc its sections link to, once, in the order they appear.

| Reader | Home | Sidebar | Page |
| --- | --- | --- | --- |
| Without a role | One card per role, with its summary and first tasks; then the task guides and every area | The roles as choices, then the areas | The roles that read the page, each a choice; previous and next follow the directories |
| With a role | The role's sections; then the task guides and every area | The role's map, with every area folded under "All documentation"; on a page the role does not read, the areas come first, open on the page's area | The same roles, the reader's marked; previous and next follow the role's reading order, with the position in it |

`GET /docs?role=<role>` records the choice in the `console_docs_role` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/docs`, one year, `Secure` as for the session cookie) and answers `303`; `role=all` clears it, and an unknown role changes nothing. The optional `to` names the doc to show next; any value that is not a doc's path sends the reader to `/docs`, so the choice never redirects off the console. The cookie names a role page and nothing else: it grants nothing, and the docs are the same for every reader.

The documentation place reads only the docs and calls no service. Anyone may read it, and a missing doc is a console "not found", like any other missing page.

---

## 7. Service calls

The console calls the three services over their contracts. It never calls a database, and it has no service of its own.

| Service | Called for |
| --- | --- |
| Access | Login code exchange, the caller's access context, tenant administration. |
| Gateway | Workspace data, with the caller's token. The console reaches Data **through** the gateway, like any client. |
| Data | Probes only, for the status board. Data is never read from it directly. |

Every call carries the request ID, so console and service traces share one search key.

A call that takes longer than `CONSOLE_REQUEST_TIMEOUT_MS` (10 seconds) fails, and the page shows the service failure instead of an empty page.

---

## 8. Environment

The console validates its environment once at startup and reports **every** problem before it refuses to start. The variables, their defaults and bounds are listed in [configuration.md](configuration.md#variables).

A production console must refuse to start unless `CONSOLE_PUBLIC_URL` is https or the deployment explicitly accepts plain http with `CONSOLE_COOKIE_SECURE=false`, because serving cookies in the clear would expose operator sessions.

A production console must refuse to start when a credential is a value the repository publishes — the example of the console holds the values of its client secret and of its session secret — or is shorter than the rule of its kind (16 characters for the client secret and the credentials of the administration, 32 for the session secret). Every value of the repository is public, and a deployment that keeps one of them runs with a credential that anybody may use.

---

## 9. Out of scope

The console does not:

- decide access (it asks Access and renders the answer);
- hold the gateway's identity-signing credential (with it, the console could impersonate the gateway);
- reach any platform database;
- sign identities of its own (every data request carries the caller's token);
- keep decisions (a revoked right closes administration from the next page on, and the service refuses anyway).

How the code is organized is described in the [workspace README](../../packages/console/README.md#layout).
