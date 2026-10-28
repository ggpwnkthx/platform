# Architecture

The data service is a **headless, permission-aware data API**: versioned HTTP endpoints over a
workspace's records, with every answer filtered by deployment policies and access-service grants.

It is a modular monolith with an optional worker process and no user interface. A studio, website,
script or other service are all clients of the same API; none has a privileged database connection.

## Platform

| Project | Owns |
| --- | --- |
| **Access service** | Principal identities, tenants, groups, permission keys and grants. |
| **Gateway** | Browser sessions, workspace admission, gateway limits, and signing the caller's identity. |
| **Data service** | Workspaces, registered collections, data policies, records, audit history and committed events. |
| **Studio** | A separate project; just an API client. |

Separation rules:

- The backend never reads access-service tables and never keeps a second directory of identities or
  grants.
- The backend never mints an identity: it verifies the gateway's signature with the gateway's
  **public** key.
- The backend never creates a session or runs a login flow; forwarded credentials are not a source of
  data permissions.

## Request flow

```
clients ──▶ the gateway ──▶ data backend ──▶ PostgreSQL
                │              │
                │              └──▶ the access service (the access context)
                └─────────────────▶ the access service (the login and the decisions)
```

1. **Gateway forwards.** It signs the caller's identity and forwards the request with the
   `x-gateway-signature` header.
2. **Backend verifies the signature.** It rebuilds the gateway's canonical payload from method, path,
   query, host and headers and verifies it with the route's public key. The transmitted payload never
   feeds the decision.
3. **Backend resolves the workspace.** A narrow reader reads the workspace registry and, in the same
   statement, the workspace catalog (collections and policy bundle).
4. **Backend asks the access service for the context.** The request carries the subject, the
   workspace's tenant, the workspace and the route; the answer is the principal's permission keys or a
   refusal.
5. **Backend enforces policies.** The scope is set on the transaction, the statement projects only
   policy-granted fields, and a write is authorized by one complete policy.
6. **Backend commits.** Record, audit entry, domain event and creation receipt commit in one
   transaction.

The order is fixed. No business operation starts without a verified principal and a resolved
workspace, and the access context is fetched outside the business-data transaction.

## Storage

Deployments run PostgreSQL 15 or later, with row-level security isolating tenants and workspaces.
Local development, tests and CI use PostgreSQL 18.

- Every business table carries `tenant_id` and `workspace_id`; the scope is set per transaction with
  `set_config(…, true)`. A pooled connection never carries another request's scope, and table
  policies refuse a statement run without a scope.
- Privilege separation is the core of the design: migration owner, API runtime role, narrow registry
  reader, delivery role and maintenance role are five roles, and the API never holds the other four's
  credentials. Roles are described in [Operations](operations.md).
- Tables come only from the repository's reviewed migrations. The running service never creates or
  alters a table.
- Collection history is optional. The versions table mirrors the collection table, and the statement
  making a change also writes the version image, so both commit together and a write the guard
  refuses writes no image. History is read under deployment policies like a record. The audit keeps
  its own rule: changed field names, never values. See [spec](spec.md) §11.

## Workspace catalog

A workspace's **catalog** is what it serves: its registered collections and the policy bundle that
applies to it ([spec](spec.md) §7.5). The catalog is a **logical registry**: the physical schema
stays global and reviewed, the logical schema is per workspace. The registry is read in one
statement and nothing from the database is cached, so a published bundle is visible on the next
request.

## Workspace model

A workspace's **model** is the logical shape of its collections: labels, constraints, relations and
the fields it does not serve. It overlays the deployment manifest and is applied when the workspace
catalog is resolved.

The model applies in realtime: a model change is a workspace schema change for every later request,
named by the schema version ([spec](spec.md) §7.6). The model domain owns the model rules and the
ports it uses: the model store, the table column reader and the workspace collection registrar.

## Events and worker

Every committed mutation writes a domain event in the record's transaction. Events go to the
subscribers registered in the composition root, at least once and possibly out of order.

Workers claim deliveries with leases, so several can run at once. A subscriber needing current data
reads it through an authorized domain read with a fresh context for the worker's service principal;
the user who started the chain is an attribution, never a credential.

## Code boundaries

| Layer | Owns |
| --- | --- |
| `src/main.ts` | Process entry point. |
| `src/app/` | Routes, parsing, context establishment, failure mapping. |
| `src/domains/<domain>/` | A domain's rules, use cases, ports and public entry point. |
| `src/domains/<domain>/adapters/` | Concrete port implementations. |
| `src/platform/bun/` | Listener and transport. |
| `src/platform/postgres/` | Connections, scoped transactions, statements, migrations. |
| `src/runtime/` | Configuration, composition root, subscribers, readiness, drain. |
| `src/observability/` | Logs and metrics. |
| `test/` | Test suites. |

Allowed domain imports:

| Domain | May import |
| --- | --- |
| `gateway-context`, `workspaces`, `schema`, `audit`, `events` | nothing |
| `authorization` | `gateway-context`, `workspaces`, `schema` |
| `catalog` | `schema`, `authorization`, `workspaces`, `model` |
| `model` | `schema` |
| `records` | `gateway-context`, `workspaces`, `schema`, `authorization`, `audit`, `events` |

A domain core imports no framework, runtime or adapter; only the composition root builds concrete
adapters. `bun run architecture` refuses violations and cycles, including type-only cycles.

## Process roles

One binary with three roles, selected by `DATA_PROCESS_ROLE`:

| Role | Does |
| --- | --- |
| `api` | Endpoints and probes. |
| `worker` | Delivery claims. |
| `all` | Both. Default for local development. |

An `api` process needs the gateway bindings and the cursor key. A worker needs the delivery
credentials and its service principal.
