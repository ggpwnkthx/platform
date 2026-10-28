# The console — Specification

The console is the web application of the platform: the one interface
through which people read and change the data of their workspaces,
operators administer the access to it, and anybody reads the state of the
services.

The console is a **client** of the three services. It speaks the
contracts of the gateway, of the access service and of the data service,
it reaches none of their databases, and it decides nothing. Every answer
it shows is the answer of a service, and the contract of that answer is
the specification of that service.

This document is normative for the behavior of the console. It describes
what the console does, what it refuses, and where the trust stops. The
[security.md](security.md) document says which credentials it holds and
what they may do; the [operations.md](operations.md) document says how to
deploy and run it.

Status: 1.0.0. Runtime: Bun ≥ 1.4.3. Listener: HTTP on
`CONSOLE_HOST:CONSOLE_PORT` (default `0.0.0.0:8083`).

---

## 1. Terms

| Term | Meaning |
| --- | --- |
| **caller** | The browser of a person who uses the console. |
| **operator** | A caller that administers a tenant or the platform. |
| **tenant** | The customer of the platform. The slug of the tenant is the identity of its operator. |
| **session** | The state the console keeps for a signed-in caller between two requests. |
| **scope** | What an operator may do: the keys the access service holds for the caller on the route of the console. |
| **ability** | The drawing of the scope and of the grants of a workspace. It hides what is refused; it never allows it. |

Invariants. All of them are enforced in the code and none of them is
configurable:

- The console **never decides an access**. It asks the access service
  what the caller may do, and it draws the answer.
- The console **never reaches a database**. Every datum it shows comes
  from a service, over its contract.
- The token of the caller **never reaches the browser**. The browser holds
  the signed identifier of a session and nothing else.
- The ability is a **mirror and never an authority**: it is an upper
  bound of what the caller may do, and never a lower one (§5).
- The console **fails closed**. A context that cannot be read opens
  nothing, and a service that cannot be reached is shown as such.

---

## 2. The requests

Every request of the console goes through the same four middlewares, in
this order. A middleware that refuses the request stops it there.

| Middleware | What it does | When it refuses |
| --- | --- | --- |
| The context | It composes the services, reads or generates the identifier of the request, and writes the log line. | Never. |
| The headers | It writes the headers of the answer: the page is never framed and never sniffed. | Never. |
| The origin | A request that changes something comes from a page of the console. | `403`, before the session is read. |
| The session | It reads the session of the caller and refreshes its cookie. | Never: a request without a session is a request of a caller that is not signed in. |

### 2.1 The identifier of the request

The identifier of the request is the `x-request-id` the caller presented
when it matches `^[A-Za-z0-9._-]{1,128}$`, and a UUID otherwise. It is
written in the header `x-request-id` of the answer and in the log line of
the request. An identifier that is not valid is replaced: it ends up in a
log line and in a header, so it may not carry anything else.

### 2.2 The origin of a request that changes something

Every `POST` — every request that changes something — comes from a page
of the console. The `Origin` the browser names is the origin of the
console, or the request is refused with `403` before it reaches the
session. A request that names no `Origin` is accepted only when it names
no `Sec-Fetch-Site` either: a browser that sends neither is a client
that is not a browser, and the console is not a public API.

`GET`, `HEAD` and `OPTIONS` are not guarded: they change nothing.

### 2.3 The headers of the answer

| Header | The value |
| --- | --- |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | Set when the console is served over https. |

A **production** console answers with a policy of the content that allows
the scripts of the console and nothing else (`script-src 'self'`), and
that refuses every framing (`frame-ancestors 'none'`), every base
(`base-uri 'none'`) and every object (`object-src 'none'`). A development
console has no policy of the content: the server of the development
injects the scripts of Vite inline.

### 2.4 The logs

One line per request, in JSON, carrying the identifier, the method, the
path, the status and the duration. The probes (`/healthz` and `/readyz`)
are not logged: they are read every ten seconds by the board of the
status.

---

## 3. The sessions

The browser holds the **signed identifier** of a session — 32 random
bytes — in the cookie `console_session`, and nothing else. The token of
the caller never reaches the browser.

| Property | The value |
| --- | --- |
| `HttpOnly` | Yes: the browser never reads it. |
| `SameSite` | `Lax`. |
| `Path` | `/`. |
| `Secure` | When the console is served over https, or when `CONSOLE_COOKIE_SECURE=true`. |
| `Max-Age` | The life that is left of the session. The cookie never outlives the session it names. |

A session ends after `CONSOLE_SESSION_TTL_MS` without use (8 hours) and
after `CONSOLE_SESSION_MAX_AGE_MS` in all (24 hours). A login replaces
the session the browser had.

**The sessions live in the memory of the process.** A deployment of the
console runs one replica, or pins a browser to a replica. The console
holds no shared state of its own.

### 3.1 The login

The sign-in is the authorization code flow with PKCE (`S256`), a `state`
and a `nonce`.

| Step | What happens |
| --- | --- |
| `GET /auth/login?redirect=<path>` | The login in flight is recorded on the server, bound to the browser by the cookie `console_login` (`Path=/auth/callback`), and the browser is sent to the authorization endpoint of the access service. |
| The provider | The access service signs the caller in at the provider of its tenant and sends the browser back to `GET /auth/callback`. |
| `GET /auth/callback` | The login in flight is taken — once — the code is exchanged with the credential of the console, the id token is verified against the keys of the access service, and a **session** is created. |

The login in flight is single use, lives ten minutes, and the target of
the redirect after a login is a **path of the console**, never a url: a
redirect to another site is a redirect that carries the session of the
caller to another site.

`GET /auth/logout` destroys the session and removes its cookie.

---

## 4. The scope of an operator

The console asks the access service for the **access context** of the
caller on the route of the console (`CONSOLE_ROUTE_ID`, `console` by
default), for the workspace that is the tenant of the caller, and it
reads the keys of that context.

| Key | What it opens |
| --- | --- |
| `console.status` | The detail of the status of the services: their versions, their readiness, their latencies. |
| `console.admin` | The administration of the tenant of the caller. |
| `console.platform` | The administration of every tenant of the platform. |

The scope is **read, never assumed**. The context of a caller is a
snapshot of the moment it was read: the console keeps it until its
`validUntil` and never longer, and it reads it again on every page. A
right that is revoked closes the administration from the next page on.

A context that cannot be read is a scope that opens nothing: the console
fails closed.

The console acts with the **credential of the tenant** of the operator
when it holds one (`CONSOLE_TENANT_ADMIN_TOKENS`), and with the
**credential of the platform** (`CONSOLE_ADMIN_TOKEN`) otherwise. The
audit of the access service names the operator of a tenant credential, and
a change of a tenant is better signed by its own operator.

---

## 5. The ability

The ability is the drawing of the scope and of the grants of a workspace.
The access service decides who holds a permission, and the data service
decides what a permission grants.

Every rule of the ability is an **upper bound** of what the caller may do
and never a lower one. The console hides what the services refuse, and it
shows what they allow. A button that the console shows and the data
service refuses is an annoyance; a button that the console hides and the
data service allows is a fault.

The library knows two wildcards: the action `manage` and the subject
`all`. The console has neither. The action and the subject of a rule are
always named, and the wildcards of the library point at a name that no
rule carries.

---

## 6. The pages

### 6.1 The endpoints of the console

| Endpoint | Behaviour |
| --- | --- |
| `GET /healthz` | `200` when the process is up. Always available. |
| `GET /readyz` | `200` when the access service answers its discovery document, `503` otherwise: a console that cannot sign anybody in is not ready to be reached. |
| `GET /auth/login` | Begins a login. |
| `GET /auth/callback` | Completes a login. |
| `GET /auth/logout` | Ends the session. |

### 6.2 The places

| Place | What it shows | What it calls |
| --- | --- | --- |
| `/` | The places, and the state of the services. | The probes of the three services. |
| `/workspaces` | The workspaces the grants of the caller name, and the ones it opened. A workspace is opened by its identifier too. | The grants of the caller, read with the credential of its tenant; `GET /ws/{id}/v1/me` for each workspace. |
| `/workspaces/{id}` | The collections the policies open to the caller, and what it may do with them. | `/me`, `/schema` |
| `/workspaces/{id}/collections/{key}` | The records: searched, filtered (with rows, or as json), sorted and paged by cursor. | `/schema/{key}`, `/items/{key}` |
| `/workspaces/{id}/collections/{key}/new` | The creation of a record. The form carries its idempotency key: a form sent twice creates one record. | `POST /items/{key}` |
| `/workspaces/{id}/collections/{key}/records/{id}` | A record, its form, its history, and its deletion. A change carries the validator of the record the caller read. | `/items/{key}/{id}`, `PATCH`, `DELETE`, `/versions` |
| `/workspaces/{id}/collections/{key}/records/{id}/versions/{n}` | One version beside the record as it is now, and the rollback to it. | `/versions/{n}`, `/rollback` |
| `/workspaces/{id}/collections/{key}/aggregate` | The records grouped, counted and measured. | `/aggregate/{key}` |
| `/workspaces/{id}/model` | The data model of the workspace: the collections it serves, their fields, rules and relations, and the changes of them. | `/model` and its writes (`data.model.read`, `data.model.write`) |
| `/workspaces/{id}/audit` | The mutations committed in the workspace. | `/audit` (`data.audit.read`) |
| `/operators` | The tenants of the platform, and the creation of one. An operator of one tenant goes to its tenant. | The administration of the access service. |
| `/operators/tenants/{slug}` | The tenant, its counts, its latest changes and its form. | The same. |
| `/operators/tenants/{slug}/users` | The users, filtered by e-mail and status; the registration of one, and of a team in one batch. | The same. |
| `/operators/tenants/{slug}/users/{id}` | The rights a user holds by itself and through its groups, its groups, and its registration (and its disabling). | The same. |
| `/operators/tenants/{slug}/groups` | The groups, their members and their rights. | The same. |
| `/operators/tenants/{slug}/rights` | Every right of the tenant, live or ended; the grant of a right to a user or a group, and its revocation. | The same. |
| `/operators/tenants/{slug}/roles` | The roles of the tenant. | The same. |
| `/operators/tenants/{slug}/audit` | The audit of the administration, and its export as CSV or JSONL. | The same. |
| `/status` | The state of the three services. | `/healthz` and `/readyz` of each of them. |
| `/docs` | The documentation of the platform: the documents of the platform, the contract of each of the three services and the contract of the console. | Nothing: the documents are in the build of the console. |
| `/me` | The caller: the subject, the tenant and the keys of its scope. | The access context of the caller. |

A refusal of the data service is shown as it is: its status, its code,
its message, the fields it names and the identifier of its request.

### 6.3 The map of the platform

The page of the status carries the **map of the platform**: the
participants of a request in lanes, and the exchanges of a request as the
rows that cross them. A reader picks a request — a record, a sign-in, a
change of a grant — and the map lights the exchanges it crosses, in
order.

The facts of the map are the facts of the [atlas](../platform/atlas.html),
in their own copy, and the check of the documentation refuses the two when
they part company.

### 6.4 The documentation

The console shows the documentation of the platform. The documents are
the documents of the repository — the ones of `docs/` — and the console
shows them as they are written: it holds no copy of them and it
changes none of them.

The documents are read when the console is built, and the build holds
them. The image of the console holds the build of the server and nothing
else, and the documentation is a part of that build.

Every link of a document is rewritten to the address of its target: a
link that names another document of the documentation is the address of
that document in the console, a link that names a place of a document is
the address of that place, and a link that names a file of the
repository is a link to the repository, at the tag of the version the
console carries. A tag is a name that does not move.

The name of a place is the name of its heading: the text of the heading,
in lower case, without its punctuation, with the spaces replaced by
hyphens. It is the name the reader sees in the address of a rendered
document, and it is the name the check of the documentation resolves. A
link that names a heading reaches it in the console as it does in a
rendered document.

The place reads the documentation and no service: anybody reads it, and
a document that is not there is a refusal of the console, as any other
page that is not there.

---

## 7. The calls to the services

The console calls the three services over their contracts. It never calls
a database, and it never calls a service of its own.

| Service | What the console calls it for |
| --- | --- |
| The access service | The exchange of the code of a login, the access context of the caller, and the administration of the tenants. |
| The gateway | The data of the workspaces, with the token of the caller. The console reaches the data service **through** the gateway, like any other client. |
| The data service | Only its probes, for the board of the status. The data itself is never read from it directly. |

Every call carries the identifier of the request, so a trace of the
console and a trace of the service are found with the same search.

A call that does not answer within `CONSOLE_REQUEST_TIMEOUT_MS` (10
seconds) fails, and the page shows the failure of the service rather than
an empty page.

---

## 8. The environment

The environment is read once, at the start of the process, and it is
validated as a whole: **every** problem is collected before the refusal,
because an operator who fixes one variable and starts the process again
to learn about the next one is an operator who loses an afternoon.

| Variable | Default | Why |
| --- | --- | --- |
| `CONSOLE_ENVIRONMENT` | `production` | `development` or `production`. It decides the policy of the content and the cookie of the session. |
| `CONSOLE_HOST` | `0.0.0.0` | The listener. |
| `CONSOLE_PORT` | `8083` | The listener. |
| `CONSOLE_PUBLIC_URL` | — | The url the callers use. It is required, and it has to be https in production. |
| `CONSOLE_ACCESS_URL` | — | The base url of the access service. Required. |
| `CONSOLE_GATEWAY_URL` | — | The base url of the gateway. Required. |
| `CONSOLE_DATA_URL` | — | The base url of the data service, for the probes of the board of the status. |
| `CONSOLE_CLIENT_ID` | — | The client of the console at the access service. Required. |
| `CONSOLE_CLIENT_SECRET` | — | The secret of that client. Required. |
| `CONSOLE_SESSION_SECRET` | — | The signature of the cookies. Required, and at least 32 characters. |
| `CONSOLE_ROUTE_ID` | `console` | The route of the console at the access service: the scope of an operator is read on it. |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | — | The credential that reads the access context. It is read only. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | — | The credential of the administration of a tenant, by slug. |
| `CONSOLE_ADMIN_TOKEN` | — | The credential of the administration of the platform. |
| `CONSOLE_SESSION_TTL_MS` | `28800000` (8 hours) | The idle lifetime of a session. |
| `CONSOLE_SESSION_MAX_AGE_MS` | `86400000` (24 hours) | The maximum age of a session. |
| `CONSOLE_PROBE_TIMEOUT_MS` | `2000` | The budget of a probe of a service. |
| `CONSOLE_REQUEST_TIMEOUT_MS` | `10000` | The budget of a call to a service. |
| `CONSOLE_COOKIE_SECURE` | the protocol of the public url | The `Secure` attribute of the cookie of the session. |
| `CONSOLE_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

A production console that serves its cookies in the clear sends the
session of an operator in the clear: the console refuses to start unless
`CONSOLE_PUBLIC_URL` is https, or the deployment says it accepts it.

---

## 9. What the console does not do

- It does not decide an access. It asks the access service and draws the
  answer.
- It does not hold a credential of the identity signature of the gateway.
  A console that could sign an identity could impersonate the gateway.
- It does not reach a database of the platform.
- It does not sign an identity of its own. Every request it makes to the
  data carries the token of the caller.
- It does not keep a decision. A right that is revoked closes the
  administration from the next page on, and the service refuses it anyway.

---

## 10. The organization of the code

| Directory | What it holds |
| --- | --- |
| `src/domains/` | The rules: the ability, the access, the authentication, the data, the documentation, the operators, the session, the status and the map. |
| `src/app/` | The wiring: the routes, the middleware, the components and the islands. |
| `src/runtime/` | The composition: the configuration, the services and the log. |

A domain holds a rule and never a transport. An app holds a route and
never a rule. The check of the architecture of the workspace refuses an
import that breaks the direction, and it runs in the CI.

---

## 11. The decision log

The decisions of the console are in the [decisions of the
platform](../platform/decisions.md) and in the [decisions of the
gateway](../gateway/decisions.md), where they are shared with the
services of the platform. The console decides nothing of its own: it is a
client, and its decisions are the decisions of the services it speaks to.
