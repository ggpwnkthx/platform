# Specification

The normative contract of Data release: what the service owns, how it trusts the
gateway and Access, and the rules for schema, authorization, mutations, events and
operations.

Status: 1.0.0.

**Runtime:** TypeScript on Bun; Hono at the HTTP boundary; PostgreSQL in production.
**Delivery:** a standalone backend repository and deployable. Studio is a separate project.

MUST, MUST NOT, SHOULD, SHOULD NOT and MAY carry their RFC 2119 meaning. A behavior described as
deferred is outside the release and MUST NOT be advertised as available.

The examples are illustrative configuration and protocol fixtures. They do not describe features
that already exist in the gateway or Access.

## 1. Purpose and authority

The backend provides reusable, permission-aware data APIs for applications behind the gateway.
Access is its authority for principals, tenants, groups and grants. The backend owns
workspaces, registered collections, record operations, data policies, audit history and committed
domain events.

### 1.1 Integration baseline

<!-- compatibility-baseline:start -->

The baseline of the integration is the one of `compatibility.json`: the
one file of the platform that owns the workspaces of the three services
and the revision of the repository that is tested against them.

| Workspace | Path | The revision it is tested against |
| --- | --- | --- |
| The gateway | `packages/gateway` | `dc3d421a5f490594fe012d04eaaef21733736563` |
| Access | `packages/access` | `dc3d421a5f490594fe012d04eaaef21733736563` |
| Data | `packages/data` | the tree of the run |

<!-- compatibility-baseline:end -->

The baseline is a repository revision and is immutable: changing it means changing the manifest
and rerunning the compatibility harness. References to earlier baselines are historical evidence of
Data releases; they stay in the release notes and are not the active baseline.

### 1.2 Ownership

| Owner | Responsibility |
| --- | --- |
| Identity provider | Authenticating the external identity. |
| Access | Login, principals, tenants, groups, permission keys and scoped grants. |
| Gateway | Sessions, caller credentials, workspace admission, gateway limits, and forwarding with the signed identity. |
| Backend | Verifying the upstream identity, tenant and workspace scope, current grants, record and field policies, and the data APIs. |
| Studio (separate project) | The browser application: navigation, forms, tables, dashboards and preview. |
| Other clients | Websites, application servers and scripts that consume the headless API. |

Access's tables stay private to it. The backend MUST NOT query or mutate them, expose
them as collections, or keep a second directory of identities and grants.

### 1.3 Headless boundary

The service MUST:

- expose versioned HTTP APIs and machine-readable schema metadata,
- work without Studio installed, running or reachable,
- serve independent clients through the same domain operations and authorization rules,
- publish an OpenAPI description and a small typed client package.

The service MUST NOT serve a studio application, login page, dashboard, form renderer, theme
system, visual workflow editor or web preview. It MUST NOT depend on any Studio repository,
package, origin or release.

Collection metadata may hold semantic labels and descriptions. Widget identifiers, component
implementations, layouts, navigation state and presentation preferences belong to Studio; policy
validation and evaluation MUST NOT depend on them.

## 2. Scope and invariants

### 2.1 Release capabilities

| Capability | Required behavior |
| --- | --- |
| Gateway | Verify `v5` gateway identities with the gateway's public key and map verified requests to trusted route bindings. The legacy `v4` format is a migration path: a deployment that still uses it declares it with `DATA_LEGACY_IDENTITY`; the service refuses it by default. |
| Access | A current, authoritative access context through the §5 contract. |
| Workspaces | Workspace ownership and enabled or disabled state. |
| Collections | Declarative collection manifests backed by reviewed SQL migrations. |
| Catalog | The collections a workspace serves and the policy bundle that applies to it, without changing the physical schema. |
| Metadata | Collection, field, relation and action metadata, filtered by policy. |
| Records | Create, list, read, update and delete, with bounded queries and optimistic concurrency. |
| Aggregates | Groups over the rows a list would read, with the same predicates and filter. |
| Authorization | Tenant and workspace isolation, action permissions, row predicates, field visibility and write checks. |
| Audit | Committed mutations, in an append-only log. |
| Events | An outbox event per mutation, delivered to the subscribers the deployment registered. |
| Client | OpenAPI, versioned errors and a typed client that uses the caller's credentials and fetch. |
| Operations | Probes, bounded resources, metrics, logs, migrations, backups and drain. |

### 2.2 Deferred capabilities

| Capability | Integration boundary |
| --- | --- |
| Files and media | An asset domain: bytes in object storage, metadata and authorization here. |
| Drafts, publication, editorial revisions, translations | A content domain using the same authorization and transactions. The audit is not a revision store. Record version history is not deferred: it is a bounded backend capability (§11.6). |
| Public realtime subscriptions | A subscription domain over committed events, with continuing authorization and revocation. |
| Webhooks, schedules, workflows | Delivery and job domains over outbox events, with the explicit authority of a service principal. |
| GraphQL | Another transport over the same query and command services. |
| Bulk writes and exports | Bounded operations with the same row and field rules and no privileged query path. Aggregates and searches are the exceptions: they are bounded and use the same rules. |
| Runtime schema editing | A versioned schema-management contract and a reviewed migration workflow. The catalog is a logical registry: it never creates or alters a table. |
| Policy editing over HTTP | Publishing a bundle is an operator command. An endpoint that writes policies would be an authority that bypasses Access. |
| Marketplace extensions | An explicit execution and trust model. Only code the deployer registered is allowed. |
| MCP and AI features | Clients and adapters that invoke the authorized domain operations. |
| Other database engines | Storage adapters, once their transaction, isolation and query semantics are specified. |
| Studio and visual analytics | An external client project, outside the implementation and the release criteria. |

A deferred endpoint MUST be absent, not a successful placeholder. The service MUST NOT claim
Directus parity.

### 2.3 Invariants

1. No business data operation starts without a trusted principal and a resolved workspace and
   tenant context.
2. A workspace belongs to exactly one tenant of Access. Ownership is immutable.
3. Authentication, workspace admission and data authorization are three separate checks.
4. An enabled workspace and Access grant do not imply access to every collection or
   action.
5. Forwarded roles and e-mail addresses are never authoritative data permissions.
6. A missing context, an unavailable dependency, an unknown policy and an incomplete capabilities
   answer fail closed.
7. Every business record query is scoped by tenant and workspace, including relation lookups and
   validation queries.
8. Client input cannot choose a tenant, change a workspace's owner, choose a SQL identifier, supply
   server audit fields, or execute SQL.
9. A committed business record mutation carries its audit entry and outbox event in the same
   PostgreSQL transaction.
10. Clients, internal subscribers and future transports use the same authorization services.
11. A runtime role cannot bypass the isolation policies.
12. Background execution has its own explicit authority: a user's headers are not reusable
    credentials.

## 3. Topology

~~~mermaid
flowchart TD
    Clients["Studio or other API clients"] --> Gateway["The gateway"]
    Gateway -->|"Login and workspace admission"| Access["Access"]
    Gateway -->|"Signed request"| Backend["Data Backend"]
    Backend -->|"Current scoped access context"| Access
    Backend --> Database["PostgreSQL"]
    Database -->|"Outbox deliveries"| Worker["Subscriber worker"]
    Worker -->|"Authorized domain commands"| Backend
~~~

A straightforward deployment has tenant-specific gateway deployments pointing to a shared Access and a shared backend. Access's shared-client topology is compatible when it is
configured explicitly and covered by the compatibility tests.

The backend does not change how the gateway selects an identity provider. Ingress to the data
endpoints MUST be restricted to the gateway's configured trust boundary; TLS termination is the
deployment's responsibility.

Workspace paths are `/ws/{workspaceId}/v1/...`. The gateway preserves the request path, and the
backend MUST accept all of it: it MUST NOT assume the gateway strips `/ws/{workspaceId}` or an
upstream base path. A deployment with an upstream base path includes it in its router and binding,
and the signature is verified against the path as received.

Probes and metrics use their own endpoints. There is no public login, logout, password or token
endpoint.

## 4. Gateway trust contract

### 4.1 Trusted route bindings

The deployer provides an immutable configuration for every accepted gateway route:

| Field | Meaning |
| --- | --- |
| `id` | Local route name, for diagnostics. |
| `host` | The exact signed public authority, with the port when there is one. |
| `upstreamPathPattern` | The path the backend receives, with the workspace parameter. |
| `routeId` | Access route scope for this route. |
| `identity` | How the route's signatures are verified: version, algorithm and key file. |
| `expectedTenantId` | Optional restriction for a tenant-specific gateway. |

`identity` names three values that belong together:

| Version | Algorithm | Key file | Meaning |
| --- | --- | --- | --- |
| `v5` | `ES256` | `publicKeyFile` | The gateway's P-256 public key. The gateway holds the private key. |
| `v4` | `HS256` | `identityKeyFile` | The gateway's legacy derived key. It is a signing-capable secret and a migration path only. |

Version, algorithm and key file MUST agree: a binding whose algorithm does not belong to its
version, or whose key file is the wrong kind, is refused. The backend MUST NOT infer the version,
algorithm or key from a request, a header, or a fallback after a failed verification. A `v5` route
MUST refuse `v4`, and a legacy route MUST NOT accept a public key as its secret.

Bindings MUST be unambiguous over signed host, received path and verifying key. An ambiguity stops
startup.

The file shape is `{"version":2,"bindings":[...]}`, with at most 100 bindings. `host` is a lowercase
ASCII DNS authority, with the port when required. `upstreamPathPattern` holds literal path segments,
exactly one `{workspaceId}` segment and a terminal `/*`; it accepts no executable regex and no other
substitution. A UUID segment cannot hold encoded separators, backslashes or dot segments. The
backend verifies the original signed bytes before it uses normalized routing values.

A version 1 file held one derived identity key per binding. It is read as legacy mode, and a
deployment that reads it declares it with `DATA_LEGACY_IDENTITY`. The service refuses the legacy
format by default, and version `2.0.0` removes it.

The gateway does not forward a signed `routeId` or tenant identifier. The backend MUST derive the
route from the matching binding. It MUST NOT accept a client-supplied route, a tenant header or an
unverified claim instead.

### 4.2 Identity verification

For every data request, the backend MUST:

1. identify candidate bindings from the received path and the signed forwarded host,
2. reject missing, duplicated, malformed and conflicting identity headers,
3. require `x-gateway-signature` with the route's `v5=` prefix, and refuse every other version,
4. rebuild that version's exact canonical payload from the received method, received path, raw
   query string, forwarded host, subject, workspace, optional e-mail and sorted roles,
5. verify the detached JWS with the route's public key, allowing only `ES256` and type
   `gateway-identity` in the protected header. The signature payload MUST be detached, and an
   unknown critical header MUST be refused,
6. only after verification, validate and normalize the principal and workspace identifiers,
7. require the signed workspace to be the path's workspace,
8. match exactly one binding, and reject any host, path and identity combination outside it.

Canonical serialization, field order, role handling and signature fixtures MUST match the pinned
gateway contract. Values MUST NOT be normalized before the signed bytes are rebuilt.

The release `1.0.0` gateway writes the identity **subject** as is: it never rewrites it, and
refuses with a `500` a subject that cannot be written into a header. The backend MUST read the
header as is and MUST NOT trim or normalize the subject: the signed bytes are the header bytes, and
signature verification refuses any subject other than the one the gateway wrote. The Access's identity subject is a UUID, and the backend requires one: the principal is the Access principal's UUID, so the two services never disagree about the caller.

The backend receives the gateway's **public** key, never `GATEWAY_SESSION_SECRET` and never the
gateway's private key. A backend that can verify an identity cannot mint one: the trust boundary is
the key, not the network. Each route key is loaded and validated at startup; a key that cannot be
loaded stops the service.

The legacy `v4` format is symmetric: its key is derived from the gateway's session secret and is a
signing-capable secret that belongs only inside the gateway boundary. A deployment that configures
it has an upstream that can mint identities, and replacing the key is a coordinated deployment
operation. The service refuses it by default, and version `2.0.0` removes it.

The pinned gateway no longer signs the legacy format: platform release `1.0.0` removed it because
its key was shared with upstreams. It remains a backend migration path for deployments with an
older gateway, and the compatibility harness proves the backend refuses it, using a signature the
harness builds itself.

The signature binds the request target and the identity. It does not bind the body and has no
timestamp or nonce. The backend MUST NOT present it as an anti-replay mechanism or a substitute for
a protected transport.

### 4.3 Credential handling

The backend MUST NOT create a second browser session or reimplement Access login. The
caller's headers and cookies are not used to resolve data permissions.

Gateway routes SHOULD set `forwardAuthorization: false` when the upstream does not need the
caller's bearer token. The backend MUST NOT log forwarded credentials.

The principal is Access principal UUID that the gateway carries as its subject. The
e-mail is an optional display value. Forwarded roles are optional diagnostic context and MUST NOT
determine data access.

A missing or invalid gateway proof is `401 UNAUTHENTICATED`. A mismatch between the path workspace
and the signed workspace, and an ambiguous binding, get the same generic refusal, with no policy or
tenant detail.

## 5. Access context contract

**Integration status:** implemented. Access has carried both endpoints since
`4cedcfc48e9bb4eb556d2316eb502e1ab87d3105`, and the §1.1 baseline is a repository revision. The
change lives in the Access workspace, not in a copy here; the compatibility harness proves
the contract against the real Access.

The backend MUST NOT substitute Access admin API, direct SQL, forwarded roles or the
boolean answer of `/v1/decisions` for this contract. The gateway keeps using its own decisions
endpoint.

### 5.1 Authentication and discovery

Both `/v1/access-context` methods require a dedicated read-only service credential over a protected
transport:

`Authorization: Bearer <the service credential of the access context>`

Access MUST restrict that credential to an explicit set of tenants. A platform-wide
credential is allowed for a shared backend; that scope is a deployment choice, not the default for a
tenant credential. These credentials do not authorize Access administration or grant
creation.

`GET /v1/access-context` returns:

~~~json
{
  "versions": [1],
  "maxPermissionKeys": 4096,
  "maxLifetimeMs": 5000
}
~~~

The backend uses this authenticated discovery for compatibility and readiness checks. An unknown
contract version stops readiness.

### 5.2 Context request

`POST /v1/access-context` accepts:

~~~json
{
  "version": 1,
  "subject": "11111111-1111-4111-8111-111111111111",
  "tenantId": "22222222-2222-4222-8222-222222222222",
  "workspaceId": "33333333-3333-4333-8333-333333333333",
  "routeId": "data-api"
}
~~~

| Field | Source |
| --- | --- |
| `subject` | The verified gateway identity, or an explicitly configured internal service principal. |
| `tenantId` | The backend registry. |
| `workspaceId` | The verified request and the resolved registry entry. |
| `routeId` | A trusted binding, or the worker configuration. |

The body is bounded to 64 KiB; unknown fields and invalid types are rejected.

Access MUST evaluate one consistent policy snapshot and require that:

1. the service credential may ask about the requested tenant,
2. the principal exists, is active and belongs to that tenant,
3. the tenant is enabled,
4. at least one enabled, unrevoked and unexpired grant applies to the principal or a current group
   membership,
5. every returned permission comes from a grant whose workspace and route scope matches the request,
   or is unrestricted.

In the baseline, Access owns no workspace catalog; the tenant-workspace relationship is
the backend's responsibility. Access MUST still verify the principal's tenant, not
merely echo the requested one.

### 5.3 Context response

A successful allowance returns:

~~~json
{
  "version": 1,
  "allow": true,
  "subject": "11111111-1111-4111-8111-111111111111",
  "tenantId": "22222222-2222-4222-8222-222222222222",
  "workspaceId": "33333333-3333-4333-8333-333333333333",
  "routeId": "data-api",
  "permissionKeys": ["content.editor", "content.reader"],
  "evaluatedAt": "2026-10-21T16:00:00.000Z",
  "validUntil": "2026-10-21T16:00:05.000Z"
}
~~~

`permissionKeys` MUST be the complete, sorted, deduplicated set of permission keys from the enabled
grants of the user and of its live groups. It MUST NOT inherit the token's role truncation.

The response limit is 4096 keys and 512 KiB. Exceeding either is an error, never a partial
allowance.

`validUntil` MUST be no later than `evaluatedAt + 5000 ms` and no later than the earliest expiry of
the contributing grants. Expiring early is acceptable. It does not promise that a grant cannot be
revoked sooner.

A denial uses status `200`, echoes the bound context fields, sets `allow: false` and
`permissionKeys: []`, and omits `validUntil`. It does not disclose whether the cause was an unknown
principal, another tenant, a disabled state or a missing grant.

| Status | Meaning |
| --- | --- |
| `400` | Unsupported version or invalid request. |
| `401` | Invalid service credential. |
| `403` | The credential cannot ask about that tenant. |
| `503` | Policies cannot be evaluated completely, including timeout and oversized response. |

Before using a response, the backend MUST validate its version, bound identifiers, types and key
count, timestamp bounds and completeness. A dependency error is `503 AUTHORIZATION_UNAVAILABLE` for
the API client; a valid negative context is `403 FORBIDDEN`.

### 5.4 Freshness and revocation

By default, the context is not cached between requests. Every mutation and background command MUST
obtain a fresh context. A read-only cache MAY be configured explicitly, from 0 to 5000 ms.

The cache key holds the credential scope, principal, tenant, workspace and route. Cached data MUST
expire at the earlier of the validity Access announced and the local lifetime. A
failure MUST NOT extend a cached allowance or fall back to stale roles.

No transaction may start with an expired context, and no business SQL may run after the known
authorization deadline. Immediately before `COMMIT`, a mutation checks the deadline again; an
expired context rolls the transaction back. A commit already in progress may complete after that
instant and cannot be undone: the service MUST resolve the committed or unknown outcome correctly
rather than report a durable effect as rolled back.

Authorization is evaluated when Access decides. A revocation after that may leave an
operation in flight. The documented bound is the configured read-cache lifetime plus the bounded
in-flight operation duration, subject to the grants' known expiry. This is not a distributed
transaction with Access.

Servers MUST keep clocks synchronized within one second. A response evaluated more than one second in
the future, an expired response, and a response whose validity exceeds the contractual maximum are
unusable. The client also bounds validity with a local monotonic deadline that starts when its
request to Access starts.

## 6. Workspaces, context and isolation

### 6.1 Workspace registry

| Field | Type | Rule |
| --- | --- | --- |
| `id` | UUID | Globally unique and immutable. |
| `tenant_id` | UUID | Access tenant reference, immutable. |
| `slug` | text | Unique within a tenant: 1 to 63 lowercase letters, digits, underscores or hyphens, starting with a letter. |
| `display_name` | text | 1 to 200 characters. |
| `status` | enum | `active` or `disabled`. |
| `created_at`, `updated_at` | timestamp | Server UTC values. |

Creating and disabling a workspace are operator commands, not generic collection CRUD. The operator
supplies an existing Access tenant. A workspace authorizes nobody until Access
confirms the tenant and the user's grants.

The registry stores external identifiers. It grants no access by itself.

### 6.2 Request context

~~~typescript
interface RequestContext {
  principalId: string;
  tenantId: string;
  workspaceId: string;
  routeId: string;
  permissionKeys: readonly string[];
  requestId: string;
  source: 'gateway' | 'worker';
  policyBundleVersion: string;
  authorizationDeadline: number;
}
~~~

The deadline is an internal monotonic-time value, never a client credential. The application builds
the context only after the §4–§6 checks.

Every domain operation receives the context explicitly. Ambient tenant state and caller-built
contexts are forbidden. E-mail and roles are not domain inputs.

### 6.3 Establishing scope

In order:

1. verify the gateway proof,
2. look up the exact workspace UUID in the registry, together with the workspace catalog,
3. reject an unknown or disabled workspace with `404 NOT_FOUND`,
4. check the binding's tenant restriction,
5. ask Access for the context, using the registry's tenant,
6. resolve the schema and policy bundle,
7. execute the scoped domain operation.

The registry lookup before the context is a narrow bootstrap exception. Its SQL role may select only
`id`, `tenant_id`, `status`, `slug` and `display_name` from the registry — the labels of a resource
the reader already reaches — and a reader policy allows that projection before tenant scope is
established. Its adapter exposes only lookup by exact UUID: it cannot enumerate or run arbitrary
queries, and it has no access to business tables.

The workspace catalog is read in the same statement as the workspace registry: the registry is on
every request's path, and a second round trip would double the work of the deployment's smallest
pool. The catalog is workspace configuration, not business data.

A binding tenant mismatch is `404 NOT_FOUND`. A connection or registry failure is
`503 DATABASE_UNAVAILABLE`, not a fabricated missing workspace.

### 6.4 PostgreSQL isolation

Workspace rows MUST hold `tenant_id` and `workspace_id`. PostgreSQL MUST enforce tenant and
workspace row-level security matching for reads and writes, including `WITH CHECK` behavior.

Every data transaction sets these transaction settings:

- `data.tenant_id`
- `data.workspace_id`
- `data.principal_id`

Missing or invalid settings deny access. The context MUST NOT survive the end of a transaction or
leak through the connection pool.

Tables MUST enable and force row-level security. The runtime role MUST NOT be a superuser, MUST NOT
have `BYPASSRLS`, MUST NOT own the protected tables and MUST NOT have DDL privileges. The migration
owner, registry reader, runtime role, delivery role and maintenance role are separate privileges,
even when their credentials point at the same server.

The delivery role may claim delivery metadata for every workspace. It MUST NOT read or mutate a
business record. A worker's business operation uses the ordinary scoped role, after a fresh Access authorization.

Relations require composite tenant and workspace foreign keys, or equivalent constraints that reject
references into another scope. A business reference is not authorized just because a UUID exists.

The query engine reaches only registered business collections. The registry, policies, audit,
outbox, deliveries and receipts are not exposed as generic collections.

## 7. Schema and collections

### 7.1 Managed schema

Collections are registered by trusted code or deployment configuration and backed by explicit SQL
migrations. A manifest defines:

- the collection's stable key and table mapping,
- fields, types, nullability, defaults and bounds,
- relations and the query behavior they allow,
- semantic labels and descriptions,
- the collection's search fields and the database text-search configuration,
- the collection's versions table, when it keeps a history (§11.6),
- a schema version and policy references.

It holds no client executable script and no Studio component implementation. Manifests and policies
are UTF-8 JSON, at most 1 MiB each, validated against strict versioned schemas. A bundle holds at
most 1000 policies; unknown properties are rejected.

Collection and table keys match `^[a-z][a-z0-9_]{0,62}$`. Physical mappings are controlled by the
deployment. Request parameters may select a registered key, never a schema, table, expression or SQL
identifier.

### 7.2 Server-maintained fields

| Field | Behavior |
| --- | --- |
| `id` | Server UUID, immutable. |
| `tenant_id`, `workspace_id` | Filled from the verified context, immutable. |
| `created_by`, `created_at` | Principal UUID and UTC creation time, immutable. |
| `updated_by`, `updated_at` | Principal UUID and UTC time of the last committed change. |
| `version` | Positive integer, starts at 1, incremented by every successful update. |

Clients MUST NOT set server fields. A server field in a write is `422 VALIDATION_FAILED`, not
silently ignored.

Scope columns are internal. The API representation always holds `id` and `version`; other server
metadata requires read permission. Deletions keep the audit identifiers without a foreign key to the
deleted record.

### 7.3 Types and validation

Supported types: bounded string and text, boolean, safe integer, decimal, UUID, timestamp, JSON and
string enumeration.

- Decimals are decimal strings in JSON, to avoid floating-point conversion.
- Integers MUST stay in JavaScript's safe integer range; a big integer type needs an explicit string
  contract.
- Timestamps are RFC 3339 UTC on output. Input requires an explicit offset and is normalized to UTC.
- `required` means a value MUST be present on create, unless a server default supplies it.
- `nullable` independently controls whether an explicit `null` is accepted.
- A field omitted from a PATCH stays unchanged; an explicit `null` asks for a nullable value.
- Unknown fields, wrong types, excessive lengths and depths, and invalid enum values are refused.
  String length bounds count code points.
- Defaults and business validation run on the server. Client validation is advisory.

A record body is at most 256 KiB after JSON normalization. A JSON field has a depth of at most 10.
Application validation cannot execute a caller's function or regular expression.

### 7.4 Schema lifecycle

The migration command runs with the schema owner's credentials and an exclusive lock. API and worker
startup validate migration checksums and compare the manifests with the deployed physical schema.

A missing column, an incompatible type, an invalid relation constraint, or an unprotected
registered table prevents readiness. The service MUST NOT create or alter a table during a request,
and MUST NOT silently repair drift.

The schema and policy bundle are immutable per process generation, with versions derived from their
content. A deployment changes them through a reviewed release. Mixed-version replicas require
backward-compatible SQL and API behavior; an incompatible schema rollout requires draining the old
replicas.

### 7.5 Workspace catalog

The catalog is what a workspace serves: its registered collections and the policy bundle that
applies to it. The deployment holds a default catalog, and a workspace may hold its own.

The catalog is a **logical registry**: it never creates or alters a table. Tables come from the
deployment's reviewed migrations, which also define their isolation, and the API role may never
alter them. A registration names a collection in the deployment manifest and the table the
deployment declares for it. A registration naming an unknown collection or another table is
refused, and a catalog that cannot be built MUST NOT serve a partial answer.

Rules:

- A workspace that registered nothing serves every collection in the deployment manifest. This is
  the default for a deployment that has not used the registry yet.
- A workspace that registered something serves exactly its registered, enabled collections. A
  collection it does not serve answers `404 NOT_FOUND`.
- A relation to a collection the workspace does not serve is absent from its manifest and never
  expanded.
- The narrow reader reads the catalog registry with the workspace registry, in one statement. The
  tables keep row-level security, and the API role reads them within its transaction scope.
- Publishing a bundle is an operator command: a local administrative entry point, not an HTTP route
  that bypasses Access.
- Registering a collection is also an operator command, and a workspace administrator may write it
  through the API with capability `data.model.write`. That route goes through the gateway and the
  Access like every other route and never bypasses them.

A workspace's schema is the deployment schema restricted to its collections. Its schema version is
the deployment's, and cursors bind it: a cursor from a workspace whose catalog changed is stale.

### 7.6 Workspace model

The deployment holds the **physical** model: its migrations' tables and the manifest that names
them. Each workspace holds its own **logical** model: an overlay describing how the deployment's
collections look in that workspace (labels, constraints, relations, and the fields it does not hold).

The model is applied to the deployment manifest when a workspace catalog is resolved, **in
realtime**: a model change changes the workspace schema for every following request. The workspace
schema version names the model it serves, and cursors bind it.

Rules:

- The model never creates or alters a table. Tables come from the deployment's reviewed migrations,
  and the API role may never alter them.
- A model field is a **column of the collection's table**. A field that names no column is refused.
- A field's **type** is its column's type and never changes. A type change is refused.
- A model **relation** points at a collection the workspace serves and an identifier that collection
  holds.
- A field the model does not hold is a field the workspace does not serve. The column stays, and the
  model may hold it again.
- Model writes require capability `data.model.write`, granted on its own: it is not a side effect of
  editing records.
- Model reads require `data.model.read` or `data.model.write`. Every other caller reads the schema
  metadata instead.
- A model write carries the version it was read at. If the model changed in between, the write is
  `409 CONFLICT` and the client reads it again.
- Publishing a policy bundle remains an operator command: the model never holds a predicate or
  grants a capability.
- Model writes are not audit log entries: the audit holds record mutations, and the model is
  workspace configuration.

## 8. Data authorization

### 8.1 Policies and capabilities

Access owns capability assignment. The backend owns what a capability means for a
collection.

A policy holds a stable identifier, the permission key it requires, the collection, the action, the
row predicate and the permitted fields. Actions are `read`, `create`, `update` and `delete`.

Policies are allow rules: no matching rule means deny. Tenant and workspace constraints are
mandatory, and a policy cannot weaken them. There is no implicit administrator and no wildcard
capability that bypasses isolation.

`$principalId`, `$tenantId` and `$workspaceId` are typed server substitutions, not evaluated code. A
user needs its own read capability to inspect records: an update capability does not grant read.

Policy bundles are trusted deployment artifacts. The release exposes no policy-editing API to end
users.

### 8.2 Read composition

For a record:

1. apply tenant and workspace scope,
2. keep the row when at least one applicable read policy matches it,
3. expose a field when at least one matching policy grants it for that row,
4. always expose `id` and `version` of a readable record.

Requested fields may come from the union of the applicable read policies' fields. Fields not
visible for a row are omitted, not emitted as nulls. Database nulls stay null.

Filtering and sorting are more conservative: a referenced field MUST be readable under every
applicable read policy for the collection and action. This intersection prevents inferring a hidden
field across policies with different field sets. An unknown or unauthorized query field gets the
same `400 INVALID_QUERY`.

The SQL projection MUST NOT materialize unauthorized values in the code that builds the response.
Predicate evaluation may use a trusted policy's fields without making them public.

### 8.3 Write composition

A write is allowed only when one complete applicable policy authorizes it:

- every field the client writes is in its field set,
- for update and delete, its `where` matches the current row,
- for create and update, its `check` matches the resulting row,
- schema validation and relation checks pass,
- scope and server fields stay under server control.

An update or delete also requires a separately applicable read policy.

Predicates and field grants from different policies MUST NOT be mixed to synthesize a write no single
policy permits.

An update checks both the existing and the resulting state. A caller cannot gain access by changing a
record's ownership, scope or values during the update.

**The database evaluates write predicates.** The write statement carries the applicable policies'
`where` and `check`, compiled by the same compiler as queries: `where` over the row before the
change, `check` over the row after it. The post-change row is passed to the database as a common
table expression of bound parameters, so a write's check is the check of the row the write produces.
Evaluating the same predicates in memory is the check's oracle, not its authority: a write the
statement refuses is refused, and a generated check compares the two evaluations on every predicate
not written by hand.

**The database evaluates read predicates too.** The statement that locks a written row computes the
read-policy flags, and the record representation is built from them. A record's validator MUST be the
same whether it was read or written: the service MUST NOT evaluate a policy predicate in memory.

### 8.4 Relations

The release supports registered many-to-one references and derived one-to-many reads. It does not
support nested writes, arbitrary joins, or many-to-many junction management.

A writable reference requires an authorized read of its target in the same tenant and workspace.
Failure is a generic invalid reference, without disclosing whether the target exists elsewhere.

An included relation must be in the union of read fields. On each parent row, the relation is omitted
unless a parent read policy grants it. Each permitted expansion then applies the target's own row and
field policies. An inaccessible to-one target is null; an inaccessible to-many target is omitted from
the list. The parent's foreign key is governed separately by its field permissions.

Expansion is limited to depth 1, 100 related rows per root record and 1000 related rows per response,
within the response's global budget. Expansion uses bounded batched queries, not one unbounded query
per parent. Exceeding a budget fails the whole request with `422 RESULT_TOO_LARGE`; a relationship is
never truncated silently. Reference identifiers supplied in a filter do not bypass target and scope
validation.

### 8.5 Isolation-sensitive operations

Reading or mutating one item answers `404 NOT_FOUND` for a record that is unknown or outside the
row's reach. A missing action capability on a collection answers `403 FORBIDDEN`, without checking
whether a record exists.

Counts use exactly the same row predicates and caller filter as the corresponding list. The §9
aggregates do too.

Audit access requires `data.audit.read`: a workspace-scoped capability of its own, not a side effect
of editing records. Audit readers see workspace identifiers and field names; that is the explicit
privilege this capability grants.

### 8.6 Workspace bundle

The bundle that applies to a workspace is the last one published for it, or the deployment bundle if
it published none.

- A bundle is validated against the deployment manifest before publication: a bundle naming an
  unknown collection or field is refused, and nothing is written.
- A bundle is published by an operator command, never by a tenant request: a bundle says what a
  permission grants, and a principal's grants are Access's business.
- Publication history is kept. A version is never changed or removed; the applicable version is the
  last one published.
- The bundle is parsed again on resolution. A bundle edited in the database, or published against
  another manifest, never applies: the service fails closed.
- Policies for collections the workspace does not serve are not part of the effective bundle. The
  effective bundle has its own content-derived version; cursors bind it and the audit records it.

The catalog is not cached from the database: the published bundle is read on every request and is
visible on the next one. The resolved catalog is memoized in the process, keyed by a fingerprint of
its inputs: the workspace's registered collections and the digest of its published bundle.

## 9. HTTP API

The full surface is in [the v1 contract](api.md). This section holds the rules it obeys.

- The prefix is `/ws/{workspaceId}/v1`.
- The encoding is UTF-8 JSON; write bodies require `Content-Type: application/json`.
- Successful objects hold `{"data": ...}`; lists also hold `meta`.
- Correlation is in `X-Request-Id`; a record body holds no request timestamp.
- Sensitive or permission-dependent responses use `Cache-Control: no-store`.
- An unknown method answers `405` with `Allow`; an unsupported route answers `404`.
- Malformed JSON is `400`, oversized input is `413`, and well-formed but invalid record data is `422`.
- Every collection and field reference is validated against the authorized schema before SQL is
  compiled.
- No endpoint accepts raw SQL, unrestricted expressions, arbitrary URL fetches, or uploaded
  executable code.

Release endpoints:

| Method | Path after the prefix | Purpose |
| --- | --- | --- |
| `GET` | `/me` | Principal, tenant, workspace and local API version. No credential and no raw Access response. |
| `GET` | `/schema` | Collection, field and relation metadata, filtered by policy. |
| `GET` | `/schema/{collection}` | The same metadata for one visible collection. |
| `GET` | `/items/{collection}` | A bounded, filtered, permission-aware list. |
| `GET` | `/items/{collection}/{id}` | A record's canonical representation and its validator. |
| `POST` | `/items/{collection}` | Create one record. Requires an idempotency key. |
| `PATCH` | `/items/{collection}/{id}` | Update one record. Requires a current `If-Match`. |
| `DELETE` | `/items/{collection}/{id}` | Delete one record. Requires a current `If-Match`. |
| `GET` | `/items/{collection}/{id}/versions` | A record's version history, for collections that keep one. |
| `GET` | `/items/{collection}/{id}/versions/{version}` | One version of a record, read with the deployment's policies. |
| `POST` | `/items/{collection}/{id}/rollback` | Roll a record back to one of its versions. Requires a current `If-Match`. |
| `GET` | `/aggregate/{collection}` | Aggregate groups. |
| `GET` | `/audit` | Audit metadata, for holders of `data.audit.read`. |
| `GET` | `/model` | The workspace model: the shape of its collections. |
| `POST` | `/model/collections` | Register a deployment collection. |
| `PATCH`, `DELETE` | `/model/collections/{collection}` | Set a collection's label and description; remove the collection from the workspace. |
| `POST` | `/model/collections/{collection}/fields` | Add a field to a collection's model. |
| `PATCH`, `DELETE` | `/model/collections/{collection}/fields/{field}` | Set a model field's attributes; remove the field from the model. |
| `POST` | `/model/collections/{collection}/fields/{field}/move` | Move a model field up or down in its collection's field order. |
| `POST` | `/model/collections/{collection}/relations` | Add a relation to a collection's model. |
| `PATCH`, `DELETE` | `/model/collections/{collection}/relations/{relation}` | Set a model relation's attributes; remove the relation from the model. |
| `GET` | `/openapi.json` | The versioned API description. |

`/me` and schema metadata still require a valid, positive Access context. They do not make a
principal without a grant a workspace member.

Schema metadata exposes only collections for which the caller holds at least one applicable action
policy. It may describe a write-only collection without exposing its records. It MUST NOT hold a SQL
identifier, an internal row predicate, a secret, subscriber configuration, Access grants or
studio instructions.

Metadata responses hold: the fields in the union of applicable policies with their types and bounds,
the conservative fields available for filtering and sorting, visible relations and their limits, the
policy bundle version, and the API limits. A field's metadata is omitted when the caller has no
access to it for any action.

An SDK or studio MUST tolerate an omitted record field and a refused later operation when grants
change.

## 10. Mutations and transactions

A mutation follows this sequence:

1. verify the identity, resolve the workspace and obtain a fresh Access context, outside the
   data transaction,
2. validate the requested action, input shape, field grants and preliminary query budget,
3. acquire a data connection within a bounded wait,
4. begin a transaction and set its tenant, workspace and principal scope,
5. claim the idempotency key, or lock and authorize the existing record,
6. check the canonical precondition and the write predicate on the existing row, under the lock,
7. resolve and authorize references and validate the resulting row, including the policy `check`,
8. apply the insert, update or delete, with the server fields,
9. insert the audit entry, domain event, subscriber deliveries and, for a create, the receipt,
10. verify the authorization deadline is still valid immediately before `COMMIT`, and commit within
    the bounded model of §5.4,
11. answer success only after the commit succeeds.

A failure before commit rolls back every effect. The backend MUST NOT call Access or a
remote subscriber while it holds the business transaction open.

Every successful update, including one that supplies the existing values, increments the record
version and emits one update event. An empty PATCH is invalid. Deletion is hard; soft deletion
requires an explicit application collection model.

Cascading deletes and nested mutations are unsupported. Reference constraints use restrict or no
action semantics for generic business CRUD. Deleting dependent records requires separately authorized
commands.

User-visible unique constraints MUST be scoped by tenant and workspace. A conflict answers a generic
`409 CONFLICT`, without another record's identifier or values. Generated UUIDs may be globally unique.

Transaction deadlines MUST cause a real database cancellation or rollback, and the connection is
disposed of when it cannot be proven clean. Racing a promise against a timer without stopping its SQL
is not enough.

Requests refused before a mutation are logged for diagnostics. They are not business audit entries.

## 11. Persistence, audit and events

### 11.1 Backend persistence

| Entity | Contents |
| --- | --- |
| `workspaces` | Tenant reference, workspace identity, display metadata and status. |
| Collection tables | Typed business records, with scope and version fields. |
| Migration ledger | Identifiers and checksums of applied migrations. |
| `audit_entries` | Immutable mutation receipts and safe metadata about changed fields. |
| `outbox_events` | Durable domain events of committed mutations. |
| `outbox_deliveries` | Delivery state for every event and subscriber. |
| `idempotency_receipts` | Create keys, request fingerprints and minimal committed receipts. |

Manifests and policies are deployment artifacts, so no editable policy or schema table is required.
Backend tables use their own SQL schema, separate from the registered business collections.

A workspace's tenant is an external reference, not a foreign key into another database. The same
holds for principals in the audit and in server fields.

Required indexes: unique workspace identifier; unique `(tenant_id, slug)`; unique business
`(tenant_id, workspace_id, id)` for relations; indexes that begin with `tenant_id, workspace_id`;
audit pagination by `occurred_at, id`; unique idempotency lookups and receipt cleanup; delivery claim
indexes on state, next attempt and lease expiry; and unique `(event_id, subscriber_id)`.

Indexes for optional business filters belong to the collections' reviewed migrations. An API request
never creates an index.

### 11.2 Audit entries

Every committed mutation records:

- the audit UUID and the UTC occurrence time,
- the principal, tenant, workspace, route and request identifier,
- the source: a gateway request or a worker,
- the collection, record identifier, action and resulting version (the last version, for a delete),
- the names of the changed fields,
- the policy bundle version and the identifier of the authorizing policy,
- the causing event and the originating principal, when a worker is involved.

Audit entries MUST NOT hold access tokens, cookies, provider secrets, signatures, arbitrary request
bodies, or full before and after record images. Revision history is deferred.

Runtime credentials have the insert and read privileges they need, and no update or delete privilege
on the audit. The maintenance role runs policy retention. Audit readers cannot edit or purge entries.

The audit endpoint supports `limit` and cursor pagination, with the same identity and scope binding
rules as other cursors. It returns metadata only and does not promise a durable changefeed across
concurrent commits.

### 11.3 Domain event envelope

~~~json
{
  "version": 1,
  "eventId": "55555555-5555-4555-8555-555555555555",
  "type": "record.updated",
  "tenantId": "22222222-2222-4222-8222-222222222222",
  "workspaceId": "33333333-3333-4333-8333-333333333333",
  "collection": "articles",
  "recordId": "44444444-4444-4444-8444-444444444444",
  "recordVersion": 2,
  "actorId": "11111111-1111-4111-8111-111111111111",
  "occurredAt": "2026-10-21T16:00:00.000Z",
  "changedFields": ["title"],
  "correlationId": "request-123",
  "causationId": null,
  "causationDepth": 0
}
~~~

Types are `record.created`, `record.updated` and `record.deleted`. Events hold identifiers and changed
field names, not business field values. A subscriber that needs current data gets it through an
authorized domain read.

Event identifiers are identities, not commit-order cursors. Delivery is at least once and may be out
of order. A consumer that needs ordered effects reconciles record versions. The backend MUST NOT claim
exactly-once delivery or an ordered changefeed.

### 11.4 Trusted subscribers

Subscribers are registered by trusted server code in the composition root. Each has a stable
identifier and filters for the events it handles. The release has no uploaded plugins, arbitrary
target URLs, workflow definitions or caller-defined handlers.

The transaction captures deliveries for the subscriber configuration active at mutation time.
Registering a new subscriber affects future events only. Events with no matching subscriber have no
pending delivery and remain subject to completed-event retention.

Execution uses a configured Access principal and the worker route. Before every command and
read, Access resolves that principal's current grants for the workspace scope. The
identity of the user who initiated the work is attribution, never the worker's reusable authority.

A subscriber MUST NOT reach business records through the delivery store's credentials, a raw SQL
shortcut, or a replayed gateway signature. Worker writes identify the service principal in
`updated_by` and keep the originating principal in the causation and audit metadata.

### 11.5 Claim, retry and replay

- Due deliveries are claimed atomically with PostgreSQL locks and leases; multiple worker processes
  are supported.
- Default concurrency is 4, default lease is 30 seconds, and the heartbeat runs every 10 seconds.
- Acknowledgement happens after the handler finishes its durable effect.
- A crashed worker or an expired lease makes the delivery eligible again.
- Handlers receive `eventId + subscriberId` as a stable idempotency identity.
- Transient failures retry with exponential backoff and jitter, from one second to five minutes, at
  most 8 attempts.
- A permanent authorization refusal or an exhausted retry budget marks the delivery failed for
  operator review.
- Requeue and replay are explicit, bounded operator commands with actor attribution. They do not
  bypass fresh business authorization.
- A subscriber missing after a deployment leaves its deliveries blocked or failed, with a visible
  diagnostic. They are never acknowledged silently.
- Subscriber writes carry causation metadata. A depth above 10 is refused before commit, which bounds
  recursive event loops.

No handler runs inside the business transaction. External side effects cannot be atomic with
PostgreSQL and must be idempotent on the subscriber side.

Completed event and delivery metadata is kept for at least seven days. Pending and failed deliveries
MUST NOT be deleted automatically. Capacity limits MUST refuse new work before a transaction commits
an event that cannot be kept, and the backlog is observable.

### 11.6 Record version history

A collection MAY keep a version history. Its manifest declares the versions table, which a reviewed
deployment migration creates: the API role never creates or alters a table.

The versions table **mirrors** the collection table (same column names and types) plus the history
columns:

| Column | Contents |
| --- | --- |
| `operation` | The change that superseded the version: `update` or `delete`. |
| `changed_fields` | The names of the fields the change touched. |
| `restored_from` | The version the change restored, when it was a rollback. |
| `superseded_at`, `superseded_by` | When the change happened and its principal. |

Rules:

- The table holds the versions that are **not** current: a record's current version is its row in the
  collection. A deleted record holds its tombstone: the image of its last version, with operation
  `delete`.
- A version image is written by **the change statement itself**: image and change commit together or
  not at all, and a change the write guard refuses writes no image.
- The image is the row before the change and carries the version it had. A record's version never
  moves back: a rollback is an ordinary change, and the record takes the next version.
- History is read with the **deployment's policies**: the database evaluates the read-policy
  predicates over each version image exactly as over the record. A version the caller may not read
  answers `404 NOT_FOUND` and is absent from the version list.
- Fields the policies do not grant are absent from a version response. A version response is a
  canonical record representation: it carries `id`, `version` and a validator.
- A rollback is a **write**, not a privileged command: the same policies as any other update authorize
  it, and a version the policies forbid writing answers `403 FORBIDDEN`. A rollback the policies
  accept but the write guard refuses is refused.
- A rollback requires a current `If-Match`: the record's validator, or its tombstone's validator if
  the record was deleted. A stale validator is `412 PRECONDITION_FAILED`.
- A deleted record is restored from the version image, and its version follows its tombstone's. The
  record keeps its original identity and creation time.
- History retention bounds a collection's history: the maintenance role removes images that are too
  old. The version list response is bounded too.

Version history is not the audit: the audit holds mutation identifiers and changed field names, never
values, and never stores images. They use different tables and different retention, and the API role
may not edit the audit.

## 12. Typed client

The repository publishes a client package that:

- uses the versioned HTTP API through the gateway,
- accepts a base URL, a workspace, the caller's fetch and credentials, and a cancellation signal,
- implements collection and schema queries, cursor traversal, idempotency keys and record
  preconditions,
- exposes stable error codes without hiding authorization or concurrency refusals,
- never issues a signature, stores Access credentials, runs a login flow or depends on Studio.

The OpenAPI document covers the fixed protocol, envelopes, endpoints and error cases. It describes
gateway credentials as the external authentication boundary and never asks a client to manufacture
the internal signed headers. Runtime metadata covers the deployment's field definitions. Generated
collection types are build artifacts of a schema version and do not replace runtime validation.

The client is the nested package `@data-backend/client`. It is published to a package registry and
distributed as the release tarball `data-backend-client-<version>.tgz`. The repository's root package
is the service itself; installing it does not install the client. The release MUST publish a tarball
that installs and works outside this repository, and CI MUST prove it: pack the tarball with the
release command, install it in a consumer outside the repository, import it by its public name, and
call it.

The client is a **bun** and **node** library: it carries its own files and has no dependencies, and
the packaging check calls the API with it once on each runtime.

A studio consumes the same public APIs as any client, with no privileged database connection and no
shortcut to secrets. A future Access administration screen requires a separately authorized
server-side adapter to Access admin API, outside this release.

## 13. Architecture

The service is a modular monolith with an optional separate worker process. Splitting the code into
more services is not required.

| Layer | Owns |
| --- | --- |
| `src/main.ts` | The process entry point. |
| `src/app/` | Hono routes, HTTP parsing, context establishment, response and error mapping. |
| `src/domains/<domain>/` | A domain's policies, use cases, ports, public entry point and tests. |
| `src/domains/<domain>/adapters/` | Concrete port implementations, assembled by the runtime. |
| `src/platform/bun/` | The listener, transport primitives and process APIs. |
| `src/platform/postgres/` | Connection lifecycle, scoped transactions, statement execution and migration mechanics. |
| `src/runtime/` | Configuration, composition root, subscribers, readiness, signals and drain. |
| `src/observability/` | Structured logs and metrics interfaces. |
| `test/` | Contract, compatibility, database, load and architecture suites. |

Required domains: `gateway-context`, `workspaces`, `schema`, `authorization`, `catalog`, `records`,
`audit` and `events`. Their allowed import matrix is in [Internals](internals.md#code-boundaries), and the
architecture check enforces it: it refuses any cycle, including a type-only cycle, and any catch-all
directory of shared implementations.

A domain's core imports no Hono, no Bun API, no application handler, no runtime and no concrete
adapter. The application imports domains' public entry points, not their internals. Only the
composition root constructs concrete adapters.

Worker orchestration lives in the runtime and calls the domains' public use cases. Audit and events
accept primitive-typed envelopes and injected persistence ports, and do not import records. A
unit-of-work port lets records coordinate its repositories, audit sink and outbox without importing
the concrete SQL adapters.

## 14. Configuration

Configuration is loaded and validated as a whole before the service becomes ready. An invalid
configuration fails startup with the variable name and a safe explanation, never printing a secret
value. There is no remote configuration-editing API and no partial hot reload.

Variables, defaults and bounds are in [Configuration](configuration.md). Rules:

- Numeric inputs MUST be finite, bounded integers. Request, body, query and response bounds cannot be
  disabled with zero or a negative value.
- The effective timeout is the minimum of the applicable deadlines.
- Production MUST refuse absent or placeholder secrets, unprotected remote dependency URLs, unsafe
  database roles, schema drift, unverified bindings and unsupported access context versions. Secrets
  come from files and mounts, never from a command-line value echoed in logs.
- Development may use gateway and Access fixtures. Production requires a PostgreSQL server.
  Integration tests against a real server remain mandatory: an embedded engine alone does not
  establish isolation, locking or the correctness of worker claims.

## 15. Operations and data lifecycle

### 15.1 Probes and metrics

| Endpoint | Contract |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"data-backend","version":"<version>","schemaVersion":"<version>"}` while the process is alive. Calls no dependency. |
| `GET /readyz` | `200 {"status":"ready"}` only when configuration, schema and policies, role privileges and a recent access context discovery all pass. `503 {"status":"draining"}` during a drain, `503 {"status":"not-ready","reason":"<reason>"}` otherwise. |
| `GET /metrics` | Prometheus text, behind a dedicated bearer token. `404` when disabled, `401` when credentials are invalid or absent. |

The readiness statuses are shared by the three services: `ready`, `draining` and `not-ready`. A
draining service answers `draining` before it stops admitting requests, so the deployment takes the
instance out of rotation.

Readiness may reuse a successful authenticated Access discovery for at most ten seconds.
Workers also require access to the delivery store and a valid subscriber configuration. Probes are
not routed through ordinary workspace authorization.

Metrics cover: request counts and durations by normalized route and status; Access duration
and failures; context cache hits; database pool waits; authorization refusals; transaction rollbacks;
outbox backlog and age; failed deliveries; retries; drain state; and catalog cache hits and misses.

Tenant, principal, workspace, record identifier, raw URL, e-mail address and query text MUST NOT
become metric labels.

### 15.2 Logs

Structured logs hold the request identifier, normalized route, action, safe status or error code,
dependency durations, and internal tenant and workspace identifiers where operationally necessary.

Credentials, cookies, signatures, complete filters and bodies, business field values, and connection
strings holding a secret are redacted. Authorization refusals are observable, without returning the
Access's raw reasons to the caller.

### 15.3 Shutdown and cancellation

On shutdown, the process:

1. becomes unready and stops admitting requests and delivery claims,
2. lets in-flight transactions finish, or cancels and rolls them back,
3. stops subscriber execution; unfinished deliveries keep or release their leases safely,
4. closes listeners, transports and pools exactly once.

The drain budget is thirty seconds. A client disconnect cancels in-flight reads. A mutation that
committed before the disconnect stays committed, and the create receipt resolves an ambiguous `POST`
response.

A connection whose transaction was aborted, or whose state is unknown, is rolled back and discarded
before it can return to the pool.

### 15.4 Retention, backup and removal

| Data | Default |
| --- | --- |
| Business records | Owned by the application. No automatic purge. |
| Record version images | 90 days, adjustable by the operator. The tables are those the manifest declares. |
| Audit entries | 90 days, adjustable by the operator. |
| Create receipts | At least 24 hours. |
| Completed event and delivery metadata | At least seven days. |
| Pending and failed deliveries | No automatic deletion. The operator resolves them. |

Retention runs with dedicated maintenance privileges, in bounded batches, with metrics and operator
attribution. No generic collection endpoint can purge platform history.

Backups hold business records, workspaces, manifest and policy bundle versions, audit, outbox and
delivery state, record version images, and migration history. Secrets are backed up and rotated by
the deployment's secret management. Before production, a restore rehearsal MUST verify tenant
isolation and the safe resumption of idempotent deliveries.

Removing a tenant or workspace is an explicit operator procedure: disable access, stop the relevant
deliveries, meet retention and export obligations, and remove the data in bounded operations. Moving
a workspace to another tenant is unsupported.

### 15.5 Capacity and rollout

Before production, a deployment publishes a repeatable capacity report covering hardware, data
shape, policy complexity, concurrent clients, pool settings, p50, p95 and p99 latencies, failure
rates and the age of the oldest outbox event.

Required scenarios:

- read-heavy access without a context cache,
- mixed create and read traffic under tenant isolation,
- concurrent updates of one record,
- multiple backend replicas and lease recovery,
- Access outage, slow SQL, expired authorization and dependency recovery,
- maximum filters, page sizes, expansions and response budgets.

A deployment declares its own request rate and latency objective; no capacity number is a release
claim without a measurement. The report MUST show that memory and queues stay bounded and that the
service recovers under the declared load.

Rolling releases preserve schema and API backward compatibility. Destructive migrations require a
reviewed maintenance plan and a tested restore or forward-fix path. A database rollback is not
assumed safe after a migration that changed data.

## 16. Verification and release acceptance

No item is complete until an appropriate automated check demonstrates its behavior.

| Suite | Required evidence |
| --- | --- |
| Domain | Predicate evaluation, field rules, write check composition, schema validation, context expiry and event envelope rules. |
| HTTP contract | Paths, envelopes, query limits, error codes, canonical ETags, create receipts, and the absence of deferred endpoints. |
| Gateway compatibility | The workspace's unmodified gateway forwards real `ES256`-signed requests that the backend accepts with the public key; forged signatures, tampered identities and workspace mismatches fail; a current-format route refuses the legacy format. |
| Client packaging | The client tarball installs outside the repository, imports by its public name, and resolves its own files without the service's dependencies. |
| Baseline drift | The baseline manifest, this specification's baseline block and the workflows agree. |
| Access compatibility | The real context implementation returns the complete user and group key set and preserves the existing decisions contract. |
| PostgreSQL integration | Row-level security, composite reference constraints, refusal of a missing context, pool reuse, concurrent version checks, migration drift and role restrictions. |
| Transaction failure | A failure injected at every mutation stage leaves record, audit, event and receipt all committed or all absent. |
| Version history | A version image is written by the change statement; a change the guard refuses writes no image; a version the caller may not read is not found; the deployment's policies authorize a rollback. |
| Subscriber integration | Multi-worker claims, lease expiry, duplicate delivery, retry exhaustion, missing handlers, service principal revocation and causation depth bounds. |
| Architecture | Allowed imports, public entry points, no cycles and private adapter construction. |
| Dead code | Modules no root reaches, exported names nobody reads, and unused dependencies. |
| Operations and load | Deadlines cancel SQL, resources stay bounded, dependency failures fail closed, the drain completes, and the restore is rehearsed. |

Mandatory adversarial cases:

1. A grant for workspace A cannot read, write, count, reference or expand workspace B's data.
2. Access grant for one tenant does not make another tenant's registered workspace
   accessible.
3. A forged tenant, forged route, e-mail address match or stale role claim cannot influence
   authorization.
4. Group removal, grant revocation and expiry, a disabled principal and a disabled tenant take effect
   within the documented freshness bounds.
5. Filtering and sorting by a hidden field are refused; counts and relation expansions cannot bypass
   row policies.
6. Two policies with complementary field sets cannot authorize a synthetic write neither permits.
7. An update that moves a row outside its check is refused atomically.
8. Concurrent updates with one ETag yield one successful version change and one precondition refusal.
9. A version hidden by the deployment's policies is not found in the history, and a rollback they
   forbid is refused: history is not a path around authorization.
10. A `POST` retried after a committed but lost response creates one record and returns its original
    receipt.
11. Reusing a create key with another body cannot create another record within the retention window.
12. An expired or malformed Access context, wrong context identifiers and incomplete
    capability sets never allow a data operation.
13. A pooled connection never keeps a previous tenant, workspace or principal scope.
14. Runtime credentials cannot disable row-level security, alter the schema, edit audit history, or
    query Access's tables.
15. A subscriber cannot turn an actor's attribution into current authorization.
16. All backend functionality and API tests run without any Studio process or package.

## 17. Decisions

The decisions behind this contract are in [decisions.md](decisions.md); its **Stated in** column names
the section here that states each one. Changing one MUST amend this document and its acceptance
criteria before the implementation contract changes.
