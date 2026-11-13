# Specification

The normative behavior of the console: what it does, what it refuses, and where trust stops. It is for implementers and reviewers; variables are in [configuration.md](configuration.md) and deployment is in [operations.md](operations.md).

The console is the platform's web application: people read and change workspace data, operators administer access, and anyone reads service status. It is a **client** of the gateway, Access and Data and speaks their contracts. Every answer it shows comes from one of those services and is governed by that service's spec.

Status: 1.6.0. Runtime: Bun ≥ 1.4.3. Listener: HTTP on
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
| **ability** | A rendering of the scope and a workspace's grants. It draws what is refused as closed, with the reason; it never allows anything. |
| **right** | A role or a permission, held by a user or a group, somewhere, until a moment: a grant of Access. |
| **the tenant itself** | The place the console reads its keys in: the tenant's slug, where Access holds a workspace (§4.2). |

### 1.1 Invariants

These hold in code and are not configurable:

- The console **never decides access**. It asks Access and renders the answer.
- The console **never reaches a database**. All data comes from a service over its contract.
- The caller's token **never reaches the browser**. The browser holds only a signed session identifier.
- The ability is a **mirror of the data, never an authority of it**: it is an upper bound on what the caller may do, never a lower one (§5).
- The administration is the exception, and it is a guard and not a drawing: the rules of the console decide which credential the console presents to Access, and Access authorises that credential rather than the person behind it (§5, §6).
- The console **fails closed**. An unreadable context opens nothing, and an unreachable service is shown as unreachable.

---

## 2. Requests

Every request passes through four middlewares in this order. When one refuses, the request stops there.

| Middleware | Does | Refuses |
| --- | --- | --- |
| Context | Composes services, reads or generates the request ID, writes the log line. | Never. |
| Headers | Sets response headers: never framed, never sniffed. | Never. |
| Origin | Requires state-changing requests to come from a console page. | `403`, before the session is read. |
| Session | Reads the caller's session, renews its token when it is about to expire (§3.1) and refreshes its cookie. | Never: no session means the caller is not signed in. |

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

### 3.1 The token of the caller

The access token of Access lives five minutes. The console keeps it on the server, in the session of the caller, and **renews it** with the refresh token of the login, so the caller signs in once and reads the data for as long as the session lasts.

| Rule | Behavior |
| --- | --- |
| The margin | The console renews the token when it expires in less than a minute. |
| Where | On the server: the browser is never sent to the provider of the tenant, and it never sees a token. |
| One at a time | Two requests of the same browser renew once: the refresh token is single use, and the second exchange of it is refused. |
| A refusal | A refresh token that Access refuses is spent, and the session cannot renew itself: the caller signs in again when the token expires. |
| A failure | A call that failed is not a refusal: the refresh token is kept, and the next request tries again. |

A refresh token of Access lives twelve hours ([Access spec §7.6](../access/spec.md#76-refresh-token)): a caller that reads the data for twelve hours is asked to sign in again.

The header of every page counts the token down and asks the console to renew it before it dies. A session that cannot renew itself offers the sign-in again.

### 3.2 Login

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

`console.platform` is a capability of the **platform**: it is not relative to a tenant, and only the platform gives it. The console writes it with its platform credential (`CONSOLE_ADMIN_TOKEN`), and only for an operator that already holds it: an operator of a tenant cannot hand the capability of the platform to a colleague, and Access refuses the write of a credential of a tenant in any case ([Access spec §3.3.1](../access/spec.md#331-who-gives-a-capability-of-the-platform)).

Scope is **read, never assumed**. A context is a snapshot: the console keeps it until its `validUntil` and never longer, and reads it again on every page. A revoked right closes administration from the next page on. An unreadable context opens nothing.

The console acts with the operator's **tenant credential** when it holds one (`CONSOLE_TENANT_ADMIN_TOKENS`), and with the **platform credential** (`CONSOLE_ADMIN_TOKEN`) otherwise. Access's audit names the operator of a tenant credential, so changes to a tenant are better signed by that tenant's own operator. What only the platform may write (§4.3) is signed with the platform credential, whoever the operator is.

### 4.1 The address of the caller

The console acts for the operator, and Access's audit names the address the change came from. The console therefore tells Access the address of the caller, in the `x-real-ip` header of its calls.

The address is the one the **gateway** reports: the gateway resolves the address of the caller once, at the edge, and writes it in `x-real-ip` for the services it forwards to. The console passes it on.

The console reads that header only when the deployment is behind an ingress that is the only way in (`CONSOLE_INGRESS_ONLY`): every peer of the console is then the gateway, and the address it reports is the address of the caller. A console that is published reads nothing — a browser that reaches the console directly chooses the header it sends, and an address it chose is not the address of a caller.

### 4.2 Where a right holds

A right holds in a place: a workspace, and a route. Access accepts any place, and a key opens something only in the place its reader asks about.

| Place of a right | Access holds | Read there |
| --- | --- | --- |
| **The tenant itself** | The tenant's slug as the workspace. | The console's keys (§4), and `data.workspace.create`. |
| **Every workspace** | No workspace. | Everything: such a right holds on each workspace of the tenant, the later ones too, and on the tenant itself. |
| **One workspace** | The workspace's identifier. | Data's keys for that workspace: its records, `data.model.read`, `data.model.write`, `data.audit.read`. |

A right that names a route holds on that route only. The console reads its keys on its own route (`CONSOLE_ROUTE_ID`), and Data reads its keys on the route of the request. `data.workspace.create` is read on both — by the console to offer the creation, by Data to allow it — so a right limited to one route creates no workspace from the console.

**A right that holds where its key is never read opens nothing**, and Access accepts it without a word. The console names the three places in the grant form, by those names, and says before the grant what the right opens in the place chosen and which of its permissions open nothing there. It says so only of the keys it knows the meaning of — its own, and the four of Data named above; every other key is the deployment's, and Data's policies decide what it allows.

The check is an explanation and never a decision: the console grants the right as the operator wrote it, and says again what opens nothing once it is granted.

### 4.3 What is the platform's

An operator of the platform holds `console.platform`; an operator of a tenant holds `console.admin`. Four things are the platform's, and the console draws each of them closed to an operator of a tenant, with the reason (§5.2):

| Act | Rule |
| --- | --- |
| Giving a capability of the platform | In every way it is given: the permission granted as it is, a role that holds it — in itself or through a role it includes — granted to somebody, a role written to hold it or to include a role that does, and a member added to a group whose live rights give it. |
| Creating a tenant | A tenant is created by the operator of the platform. |
| The flags of a tenant that move logins across tenants | The shared client and the default tenant ([Access spec §10.1](../access/spec.md#101-common-rules)). The other fields of a tenant are the tenant's operator's. |
| Vouching for a route | The owner of a domain proves it with its record; only the platform vouches for it instead ([Access spec §10.18](../access/spec.md#1018-the-routes-of-the-logins)). |

The console refuses each of them before it calls Access, for the person and not for the credential: the page that receives a form asks the ability again, whatever the form that was drawn. A flag of the platform that an operator of a tenant sends changes nothing: the console sends Access the value the tenant has.

An operator of a tenant does administer what the platform gave: it revokes a right of its tenant whatever the right gives, a capability of the platform included, and it takes a member out of any group.

**A group the console could not read is not a group that gives nothing.** The console reads what a group gives in the live rights and the roles of its tenant, and it reads a bounded number of them. For a tenant that holds more, a new member of a group is signed with the platform credential for an operator of the platform, who may always add one, and with the tenant credential for an operator of a tenant, whom Access answers. A console that holds no credential of that tenant would sign with the platform credential, which Access never refuses: it refuses the new member itself, and says that it could not read the tenant.

---

## 5. Ability

The ability renders the scope and a workspace's grants. Access decides who holds a permission; Data decides what a permission grants.

Every ability rule must be an **upper bound**, never a lower one: the console refuses what the services refuse and allows what they allow, and it says why. A refusal is drawn as a disabled action with the reason of it, so a reader learns what is missing instead of finding an absence. A button that is offered and then refused by Data is an annoyance; a button that is hidden although it is allowed is a fault.

The ability library has two wildcards, the action `manage` and the subject `all`. The console uses neither: every rule names its action and subject, and the wildcards match no rule.

### 5.1 What the ability knows

A page asks the ability one question: an action, on a subject. A rule that refuses carries the **reason** the page shows, and no page writes a refusal of its own.

| Subject | Actions | Built from |
| --- | --- | --- |
| The console | `status`, `admin`, `platform` | The keys of the scope (§4). |
| A tenant, by its slug | `administer`, `create`, `flag` | The scope. An operator of a tenant administers the tenant of its own slug and no other. An operator of the platform administers every one (§4.3). |
| A permission, by its key | `give` | The scope. An operator gives every permission but a capability of the platform, which only its holder gives. |
| A route of the logins | `vouch` | The scope (§4.3). |
| A workspace of the tenant | `create` | `data.workspace.create` in the scope. |
| The model and the audit of a workspace | `read`, `update` | The keys Access gives the caller on the workspace, on the route Data serves it on. |
| A collection and its fields | `read`, `create`, `update`, `delete` | The actions and the fields Data's schema names for the caller. |

The keys of a workspace are the answer to the question Data asks before it serves a request, so the console asks Access the same question. A context the console cannot read tells it nothing about a workspace: the model and the audit are drawn as plain tabs, and Data answers the caller that follows one. That is the upper bound at work, and it opens nothing: the administration is the console's own to close, and it stays closed without a context (§4). When Data has answered on the page — it served the model or the audit, or refused it — its answer replaces the keys.

### 5.2 How a refusal is drawn

| What is refused | Drawn as |
| --- | --- |
| An action of a page | A disabled control that carries a lock, with the reason on hover and on keyboard focus. |
| The model or the audit of a workspace | A tab that carries a lock and stays a link: the page it leads to says which key is missing and who grants it. |
| A field of a record | Its value, read-only, with the reason under it. |
| A choice of a form of the administration | The choice named with its reason — a permission, a role, a cell of the grid of the roles — and a form that is not sent with it. |
| A new member of a group that gives a capability of the platform | The reason above the members of the group, and a picker that offers nobody new and still takes a member away. On the page of a user, the group is named under the picker as not offered. |
| A place of the console | No link in the page header. Opened by its address, the place answers `403` and says what is missing and who grants it. |

The page header names what the caller administers, beside its tenant: `operator` for a tenant, `platform operator` for the platform.

---

## 6. Pages

### 6.1 Console endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | `200` while the process is up. Always available. |
| `GET /readyz` | `200` when Access serves its discovery document, else `503`: a console that cannot sign anyone in is not ready. |
| `GET /auth/login` | Starts a login. |
| `GET /auth/callback` | Completes a login. |
| `POST /auth/renew` | Renews the token of the session and answers when it expires. It holds no token. |
| `POST /auth/logout` | Ends the session. A `GET` only redirects to `/`. |

### 6.2 Places

| Place | Shows | Calls |
| --- | --- | --- |
| `/` | The places and service state. | The three services' probes. |
| `/workspaces` | Workspaces named by the caller's grants, plus ones it opened. A workspace can also be opened by ID. The creation of a workspace is offered to a caller that holds `data.workspace.create`, and drawn disabled to any other (§5.2). | The caller's grants, read with its tenant's credential; `GET /ws/{id}/v1/me` per workspace. |
| `/workspaces/new` | The creation of a workspace of the tenant: its slug and its name. The caller that creates one is given the administration of it, by the role `admin` of the tenant. A role `admin` that holds a capability of the platform is the platform's to grant (§4.3): the workspace is created, and a creator who is not an operator of the platform is told that its rights were not. | `POST /v1/workspaces`, and the grant of the role `admin` on the workspace. |
| `/workspaces/{id}` | Collections the policies open to the caller, and the four actions on the records of each, the refused ones named too. The tabs of the model and of the audit are closed to a caller that holds no key of theirs (§5.1). | `/me`, `/schema`, and the access context of the caller |
| `/workspaces/{id}/access` | What the caller may do with each collection, field by field, and with the model and the audit, with the reason of every refusal; and the permissions Access gives it there, each with what it opens when the console knows. | `/me`, `/schema`, and the access context of the caller |
| `/workspaces/{id}/collections/{key}` | Records: searched, filtered (by rows or as JSON), sorted, cursor-paged. | `/schema/{key}`, `/items/{key}` |
| `/workspaces/{id}/collections/{key}/new` | Record creation. The form carries an idempotency key, so submitting twice creates one record. | `POST /items/{key}` |
| `/workspaces/{id}/collections/{key}/records/{id}` | A record: form, history, deletion. Changes carry the validator of the version the caller read. | `/items/{key}/{id}`, `PATCH`, `DELETE`, `/versions` |
| `/workspaces/{id}/collections/{key}/records/{id}/versions/{n}` | One version beside the current record, and rollback to it. | `/versions/{n}`, `/rollback` |
| `/workspaces/{id}/collections/{key}/aggregate` | Records grouped, counted and measured. | `/aggregate/{key}` |
| `/workspaces/{id}/model` | The workspace data model: collections, fields, rules, relations, and changes to them. A caller that reads the model and may not change it reads it without its forms. | `/model` and its writes (`data.model.read`, `data.model.write`), and the access context of the caller |
| `/workspaces/{id}/audit` | Mutations committed in the workspace. | `/audit` (`data.audit.read`), and the access context of the caller |
| `/operators` | Platform tenants, and tenant creation. A single-tenant operator is sent to its tenant. | Access administration. |
| `/operators/tenants/{slug}` | The tenant: who administers it, counts, latest changes, form, the providers it signs its people in at, the accounts of its local providers, and the routes that name the tenant. | Same. |
| `/operators/tenants/{slug}/users` | Users, each with what it holds, filtered by e-mail and status; registering one user, or a team in one batch. | Same. |
| `/operators/tenants/{slug}/users/{id}` | A user: the permissions it holds in effect, what the console opens to it, its rights (direct and through groups), its groups, a check of one workspace, and its registration (including disabling). The page grants a right, changes the groups, and makes the user an administrator of the tenant in one step. | Same, and the access context of the user. |
| `/operators/tenants/{slug}/groups` | Groups, members and rights. | Same. |
| `/operators/tenants/{slug}/rights` | Every right of the tenant, live or ended, with its place in words (§4.2); filtered by holder, by what a right gives in effect and by place; granting to a user or group, and revoking. | Same; `GET /ws/{id}/v1/me` for the name of a workspace a right names, a few per page. |
| `/operators/tenants/{slug}/roles` | The tenant's roles, as a list or as a grid of the roles against the permissions: an operator ticks and clears cells, and one save writes the roles that changed. | Same. |
| `/operators/tenants/{slug}/roles/{key}` | One role of the tenant: the permissions it holds in effect with what each opens, the roles it includes, and who holds it. | Same. |
| `/operators/tenants/{slug}/audit` | Administration audit, exportable as CSV or JSONL. | Same. |
| `/status` | State of the three services. | Each service's `/healthz` and `/readyz`. |
| `/docs` | Platform documentation, arranged around the reader's role (§6.4): a choice of roles, or the chosen role's map, then every area. `?role=` records or clears the choice. | Nothing: docs are in the console build. |
| `/me` | The caller: subject, tenant, the scope keys it holds and the ones it does not, each with what it opens. | The caller's access context. |

A Data refusal is shown as it came: status, code, message, named fields and request ID.

Every page header links the places the caller may reach: the overview, the workspaces and the operators. The status and documentation places sit in every page's footer instead, and every caller may open both.

**The name of a workspace.** Access names a workspace by its identifier. On the pages of the administration the console shows the name Data gave the workspace to the caller, asked once per workspace and per session; a workspace Data does not open to the caller keeps its identifier. The name is a courtesy of the page: nothing is decided with it, and a page does not wait for it. A name that does not come in time is there for the next page, and a Data that does not answer is not asked again for half a minute.

**The grid of the roles.** The grid is read as what the operator changed: a cell the page drew closed is not written, whatever the form says, and a role whose cells did not change is not written at all. Each role that changed is written on its own, and the page says what happened to each one.

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
