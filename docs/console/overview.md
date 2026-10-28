# The console — overview

The console is one application with four places: the **overview**, the
**workspaces**, the **operators** and the **status**. Every place is a
page rendered on the server; the islands of HonoX make some of them
live in the browser.

## The sign-in

The console is a client of the tenant at the access service, like the
gateway is. The sign-in is the authorization code flow with PKCE
(`S256`), a `state` and a `nonce`:

1. `GET /auth/login?redirect=<path>` records the login in flight on the
   server, binds it to the browser with the cookie `console_login`, and
   sends the browser to the authorization endpoint of the access
   service.
2. The access service signs the caller in at the provider of its tenant
   and sends the browser back to `GET /auth/callback`.
3. The console takes the login in flight — once — exchanges the code
   with its own credential, verifies the id token against the keys of
   the access service, and creates a **session** of its server.

The browser holds the signed identifier of the session in the cookie
`console_session`, and nothing else. The access token of the caller stays
on the server of the console, and the console forwards it to the gateway
as a bearer token for the calls of the data.

The access token lives five minutes and there is no refresh token. The
clock in the masthead says how long the access to the data is left; a
page of the data that finds the token expired sends the caller to the
login again, which the provider of the tenant answers without a question
while the caller is signed in there.

## The workspaces

| Page | What it shows | What it calls |
| --- | --- | --- |
| `/workspaces` | The workspaces the rights of the caller name, and the ones it opened. A workspace is opened by its identifier too. | The grants of the caller, read with the credential of its tenant; `GET /ws/{id}/v1/me` for each workspace. |
| `/workspaces/{id}` | The collections the policies open to the caller, and what it may do with them. | `/me`, `/schema` |
| `…/collections/{key}` | The records: searched, filtered (with rows, or as json), sorted and paged by cursor. | `/schema/{key}`, `/items/{key}` |
| `…/collections/{key}/new` | The creation of a record. The form carries its idempotency key: a form sent twice creates one record. | `POST /items/{key}` |
| `…/records/{id}` | A record, its form, its history, and its deletion. A change carries the validator of the record the caller read. | `/items/{key}/{id}`, `PATCH`, `DELETE`, `/versions` |
| `…/records/{id}/versions/{n}` | One version beside the record as it is now, and the rollback to it. | `/versions/{n}`, `/rollback` |
| `…/collections/{key}/aggregate` | The records grouped, counted and measured. | `/aggregate/{key}` |
| `/workspaces/{id}/model` | The data model of the workspace: the collections it serves, their fields, rules and relations, and the changes of them. | `/model` and its writes (`data.model.read`, `data.model.write`) |
| `/workspaces/{id}/audit` | The mutations committed in the workspace. | `/audit` (`data.audit.read`) |

A refusal of the data service is shown as it is: its status, its code,
its message, the fields it names and the identifier of its request.

## The operators

The administration speaks the words of an operator: a **user** is a
principal of the access service and a **right** is a grant of it.

| Page | What it shows |
| --- | --- |
| `/operators` | The tenants of the platform, and the creation of one. An operator of one tenant goes to its tenant. |
| `/operators/tenants/{slug}` | The tenant, its counts, its latest changes and its form. |
| `…/users` | The users, filtered by e-mail and status; the registration of one, and of a team in one batch. |
| `…/users/{id}` | The rights a user holds by itself and through its groups, its groups, and its registration (and its disabling). |
| `…/groups`, `…/groups/{key}` | The groups, their members and their rights. |
| `…/rights` | Every right of the tenant, live or ended; the grant of a right to a user or a group, and its revocation. |
| `…/audit` | The audit of the administration, and its export as CSV or JSONL. |

### The scope of an operator

The scope of an operator is **read, never assumed**. On every page the
console asks the contract of the access context for the keys the access
service holds for the caller on the route of the console
(`CONSOLE_ROUTE_ID`, `console` by default), for the workspace that is the
slug of its tenant:

| Key | What it opens |
| --- | --- |
| `console.status` | The detail of the status: the versions, the latencies and the answers of the probes. |
| `console.admin` | The administration of the tenant of the caller. |
| `console.platform` | The administration of every tenant of the platform. |

The console acts with the credential of the tenant of the operator when
it holds one (`CONSOLE_TENANT_ADMIN_TOKENS`), so that the audit of the
access service names the operator, and with the credential of the
platform (`CONSOLE_ADMIN_TOKEN`) otherwise. A context that cannot be read
is a scope that opens nothing.

## The status

`/status` is read by anybody: the state of the gateway, of the access
service and of the data service, from their `/healthz` and `/readyz`.
The operators who hold `console.status` read their versions, their
latencies and what the probes answered. The board reads the probes again
every ten seconds.

The page also carries the **map of the platform**: the participants of a
request in lanes, and the exchanges of a request as the rows that cross
them. A reader picks a request — a record, a sign-in, a change of a
grant — and the map lights the exchanges it crosses, in order. The facts
of the map are the facts of the [atlas](../platform/atlas.html), in their
own copy, and the check of the documentation refuses the two when they
part company.
