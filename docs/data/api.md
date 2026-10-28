# API contract

The stable v1 surface of the data service: what a client may rely on, what may change, and what a
change costs. The [specification](spec.md) is normative and may change between releases; this page
is the subset clients depend on, and it changes only with a major client version.

## Endpoints

| Path | Method | Answers |
| --- | --- | --- |
| `/ws/{workspaceId}/v1/me` | `GET` | The caller's identity in the workspace. |
| `/ws/{workspaceId}/v1/schema` | `GET` | Metadata of the collections the caller may use. |
| `/ws/{workspaceId}/v1/schema/{collection}` | `GET` | Metadata of one collection. |
| `/ws/{workspaceId}/v1/items/{collection}` | `GET`, `POST` | List a page of records; create one. |
| `/ws/{workspaceId}/v1/items/{collection}/{id}` | `GET`, `PATCH`, `DELETE` | Read, update or delete one record. |
| `/ws/{workspaceId}/v1/items/{collection}/{id}/versions` | `GET` | A record's version history. |
| `/ws/{workspaceId}/v1/items/{collection}/{id}/versions/{version}` | `GET` | One version of a record. |
| `/ws/{workspaceId}/v1/items/{collection}/{id}/rollback` | `POST` | Roll a record back to one of its versions. |
| `/ws/{workspaceId}/v1/aggregate/{collection}` | `GET` | Aggregate groups. |
| `/ws/{workspaceId}/v1/audit` | `GET` | Audit log metadata for the workspace. |
| `/ws/{workspaceId}/v1/model` | `GET` | The workspace model: the shape of its collections. |
| `/ws/{workspaceId}/v1/model/collections` | `POST` | Register a deployment collection for the workspace. |
| `/ws/{workspaceId}/v1/model/collections/{collection}` | `PATCH`, `DELETE` | Change a collection's label and description; remove the collection from the workspace. |
| `/ws/{workspaceId}/v1/model/collections/{collection}/fields` | `POST` | Add a field to a collection's model. |
| `/ws/{workspaceId}/v1/model/collections/{collection}/fields/{field}` | `PATCH`, `DELETE` | Change a model field's attributes; remove the field from the model. |
| `/ws/{workspaceId}/v1/model/collections/{collection}/fields/{field}/move` | `POST` | Move a model field up or down in its collection's field order. |
| `/ws/{workspaceId}/v1/model/collections/{collection}/relations` | `POST` | Add a relation to a collection's model. |
| `/ws/{workspaceId}/v1/model/collections/{collection}/relations/{relation}` | `PATCH`, `DELETE` | Change a model relation's attributes; remove the relation from the model. |
| `/ws/{workspaceId}/v1/openapi.json` | `GET` | The API description. |
| `/healthz`, `/readyz`, `/metrics` | `GET` | Deployment probes. Not routed through workspace authorization. |

- The gateway preserves the request path and the backend expects all of it; it does not assume the
  gateway strips `/ws/{workspaceId}` or an upstream base path.
- `/me` answers the principal, tenant, workspace and route. `workspace` is
  `{ "id", "slug", "displayName" }`; slug and name are `null` when the registry holds none.
- **A path not in this table does not exist.** A deferred capability answers `404 NOT_FOUND`, never a
  successful placeholder. An unknown method on a known path answers `405` with an `Allow` header.
- Every data path needs the gateway's verified identity. The backend has no login endpoint, token
  endpoint or session: callers authenticate at the gateway, which forwards a signed identity.

## Envelopes

| Answer | Shape |
| --- | --- |
| List | `{ "data": [...], "meta": { "limit", "nextCursor", "count"? } }` |
| Record | `{ "data": { ... } }`, with the record's validator in the `etag` header |
| Creation | `201`, `{ "data": { "id", "version" } }`, with the record's location in the `location` header |
| Aggregate | `{ "data": [...], "meta": { "limit", "groups", "truncated" } }` |
| Error | `{ "error": { "code", "message", "details"? }, "requestId" }` |

The `x-request-id` header carries the request correlation and equals an error's `requestId`.
Responses with sensitive or permission-dependent data use `Cache-Control: no-store`.

## Error codes

Switch on the code, never the message. A code's status is fixed within a major version, and the
codes are published in the OpenAPI document.

| Status | Codes |
| --- | --- |
| `400` | `INVALID_REQUEST`, `INVALID_QUERY`, `INVALID_CURSOR`, `INVALID_PRECONDITION` |
| `401` | `UNAUTHENTICATED` |
| `403` | `FORBIDDEN` |
| `404` | `NOT_FOUND` |
| `409` | `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_IN_PROGRESS`, `CURSOR_STALE` |
| `412` | `PRECONDITION_FAILED` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `422` | `VALIDATION_FAILED`, `INVALID_REFERENCE`, `RESULT_TOO_LARGE` |
| `428` | `PRECONDITION_REQUIRED` |
| `429` | `TOO_MANY_REQUESTS` |
| `500` | `INTERNAL_ERROR` |
| `503` | `AUTHORIZATION_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `OVERLOADED`, `DRAINING` |
| `504` | `DEADLINE_EXCEEDED` |

- The message is a safe, human-readable summary. Details name only fields the caller may write or
  query. Stack traces, SQL text, database constraint names, raw access-service reasons and other
  tenants' identifiers are never returned.
- A refusal says nothing more: the service never names the refusing policy and never distinguishes an
  unknown principal from an unknown grant.
- Database failures map to contract codes: lock not granted in time → `409 CONFLICT`; constraint
  violated → `409 CONFLICT` or `422 VALIDATION_FAILED`; statement over budget →
  `504 DEADLINE_EXCEEDED`; database unreachable → `503 DATABASE_UNAVAILABLE`. A
  `500 INTERNAL_ERROR` is always a service defect.
- `429 TOO_MANY_REQUESTS` means the tenant holds all of its room; it carries `Retry-After`. A
  tenant's room is the whole process unless the deployment sets
  `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT` (multi-tenant deployments do).

## Query parameters

| Parameter | Applies to | Meaning |
| --- | --- | --- |
| `fields` | list | Projection, at most 50. Default: the union of the policies' readable fields, plus `id` and `version`. |
| `filter` | list, aggregate | URL-encoded JSON filter. |
| `search` | list, aggregate | Collection text search, at most 256 characters. |
| `sort` | list | Up to three fields, `-field` for descending. Default: `id` ascending. |
| `limit` | list | Page size: default 50, max 200. |
| `cursor` | list | Next-page cursor. |
| `include` | list | Relations to expand, at most 5. |
| `include_count` | list | Return the row count. Default false. |
| `group_by` | aggregate | Grouping fields, at most 3. |
| `metrics` | aggregate | `sum:field`, `avg:field`, `min:field`, `max:field`, at most 10. The row count is always returned. |
| `limit` | aggregate | Max groups: default 100, max 1000. |

Unknown and repeated parameters are refused, so the answer never depends on which value a parser
picked. The raw query string is at most 16 KiB.

## Filter grammar

Operators: `_and`, `_or`, `_not`, `_eq`, `_neq`, `_in`, `_nin`, `_lt`, `_lte`, `_gt`, `_gte`,
`_is_null`.

```json
{
  "_and": [
    { "title": { "_eq": "Launch notes" } },
    { "created_at": { "_gte": "2026-10-01T00:00:00Z" } }
  ]
}
```

- `_and` and `_or` take non-empty arrays of filter objects.
- `_not` takes one filter object and negates it.
- Depth at most 5, at most 50 leaf predicates.
- `_in` and `_nin` take 1 to 100 values of the field's type.
- An empty filter object adds no caller predicate.
- Compare null with `_is_null`. Equality and ordering operands cannot be null.
- Operators are checked against the field type. Not supported: dotted relation filters, JSON path
  expressions, arbitrary functions, SQL wildcards. Values are bound parameters; identifiers come from
  the validated manifest.
- **Negation keeps the database's three-valued logic.** Negating unknown gives unknown, so a negated
  comparison never matches a row whose value is null.
- Filtering or sorting by a field the caller may not use is `400 INVALID_QUERY`. Usable fields are the
  intersection of the collection's read policies, so a field one policy hides cannot be used to infer
  what it hides.

## Lists

Lists are bounded, filtered and permission-aware. Rows and count are evaluated in one read-only
snapshot with the same predicates and filter.

- The whole encoded response, expansions included, is at most 4 MiB. Exceeding it answers
  `422 RESULT_TOO_LARGE` with no partial page: no success byte is sent before the bounded answer is
  complete.
- Expansions: depth 1, 100 related rows per root record, 1000 related rows per answer.

## Cursors

A cursor is an opaque signed token. It binds the principal, tenant, workspace, collection, route,
filter, fields, sort, expansions, count option, limit, position, schema version, policy bundle version
and the caller's permission fingerprint.

- Lifetime: 15 minutes.
- Tampered, or from another request: `400 INVALID_CURSOR`.
- Expired, or issued under a schema, bundle or permission set that has since changed:
  `409 CURSOR_STALE`.
- A cursor is never an authorization credential.

Each page gets a fresh context and the current policies. Pages are not a database snapshot:
concurrent inserts, updates and deletes change later pages.

## Reads and validators

Reading one record returns every field readable for that row, plus `id` and `version`. The endpoint
takes no query parameters: `fields`, `include` and any unknown parameter are `400 INVALID_QUERY`. Use
the list for a projection.

The canonical representation is serialized deterministically (keys sorted recursively, array order
kept, no insignificant whitespace), and the strong `ETag` is `"sha256:<lowercase hex digest>"` over
exactly those bytes. The bytes include the record version, so any change invalidates the validator.

`PATCH` and `DELETE` require a current validator:

| Condition | Answer |
| --- | --- |
| No `If-Match` | `428 PRECONDITION_REQUIRED` |
| Weak, wildcard, malformed or multiple validator | `400 INVALID_PRECONDITION` |
| Current authorized representation differs | `412 PRECONDITION_FAILED` |
| Record missing or no longer readable | `404 NOT_FOUND` |

An update also needs a read policy and the action's complete write policy. A successful `PATCH`
returns the new canonical representation and its `ETag`; `DELETE` returns `204` with no body. Every
update increments the version, even when no value changes. An empty `PATCH` is invalid.

## Record versions

History is optional per collection: the collection manifest declares the versions table, and the
deployment creates it in a reviewed migration. History holds the versions that are **not** current
(the record itself is current); a deleted record keeps a tombstone, the image of its last version. See
[spec](spec.md) §11.

Version list:

```json
{
  "data": [
    {
      "version": 2,
      "operation": "update",
      "changedFields": ["title"],
      "supersededAt": "2026-10-21T16:00:00.000Z",
      "supersededBy": "11111111-1111-4111-8111-111111111111"
    }
  ]
}
```

Versions are newest first, at most 200; older ones are omitted.

Reading one version returns its canonical representation with a strong `ETag`, like a record read.
The database evaluates the read policy predicates over the version image exactly as over the record.
A version the caller may not read answers `404 NOT_FOUND` and is absent from the list; ungranted
fields are omitted.

Rollback body:

```json
{ "version": 2 }
```

The body holds exactly one property, a positive integer `version`; anything else is
`400 INVALID_REQUEST`.

| Condition | Answer |
| --- | --- |
| No `If-Match` | `428 PRECONDITION_REQUIRED` |
| Weak, wildcard, malformed or multiple validator | `400 INVALID_PRECONDITION` |
| Current record state differs | `412 PRECONDITION_FAILED` |
| Version missing or not readable | `404 NOT_FOUND` |
| Record already holds that version | `409 CONFLICT` |
| Deployment policies forbid the write | `403 FORBIDDEN` |

- Rollback is an ordinary write, not a privileged command: it restores the fields that differ and is
  authorized by the same policies as any update.
- The version number never goes back: the record gets the next version.
- The validator is that of the current state: the record's, or its tombstone's if deleted. A deleted
  record is restored from the version image, with the version after the tombstone's.
- On a collection without history, all three version paths answer `404 NOT_FOUND`, never a successful
  placeholder.

## Creation and idempotency

`POST` requires an `Idempotency-Key`: 1 to 128 ASCII letters, digits, periods, underscores or hyphens.
The key is opaque input, not an authority.

1. The key is scoped to the principal, tenant, workspace, route and endpoint.
2. A request fingerprint (method, path, validated body) is stored with it.
3. Key claim, insert, audit entry, event, deliveries and receipt commit atomically.
4. Same key, same body: the original receipt with `Idempotency-Replayed: true`; nothing is created.
5. A replay authenticates again and needs a currently applicable create capability; it never replays
   business field values.
6. Same key, different body: `409 IDEMPOTENCY_CONFLICT`.
7. A concurrent duplicate waits within the request budget. Still unresolved after two seconds:
   `409 OPERATION_IN_PROGRESS` with `Retry-After: 1`.
8. A rolled-back transaction leaves no receipt and no effect.
9. Receipts are kept at least 24 hours. After that, reusing the key is a new operation:
   deduplication is not permanent.
10. Later deletion or change of the record neither changes its creation receipt nor recreates it.

A creation answers a receipt, not the record:

```json
{ "data": { "id": "44444444-4444-4444-8444-444444444444", "version": 1 } }
```

Fetch the record separately if authorized. A receipt never grants a read.

## Aggregates

`GET /ws/{workspaceId}/v1/aggregate/{collection}` groups a collection's records. It reads the same rows
as the matching list (same scope, same disjunction of read predicates, same caller filter); it is not a
privileged query path.

Group and metric fields must be fields the caller may filter and sort by. A function undefined for the
field's type is `400 INVALID_QUERY`. See [spec](spec.md) §9.

```json
{
  "data": [
    { "group": { "status": "draft" }, "count": 12, "sum": { "amount": "42.50" } }
  ],
  "meta": { "limit": 100, "groups": 1, "truncated": false }
}
```

Integer sums and averages are decimals, exactly as the database returns them. Groups are ordered by
the group fields, so answers are stable; `truncated` says not all groups were returned.

## Search

`search` is a database text search over the fields the manifest declares searchable. The caller
supplies the text; the deployment supplies the fields and search configuration, never the caller.

- Search combines with the caller's filter, and a list's count counts the search results.
- Searching a field a policy hides is `403 FORBIDDEN`.
- Search is not a filter operator: the write path evaluates policy predicates in memory, where text
  search has no meaning.

## Metadata

`/schema` lists collections where the caller holds at least one applicable action policy. A
collection may be described as write-only; its records stay unreadable.

The answer carries the key, label, schema version, the caller's supported actions, readable and
writable fields with bounds, filterable and sortable fields, visible relations, the policy bundle
version and the API limits. It never carries SQL identifiers, internal row predicates, secrets,
subscriber configuration, access-service grants or studio instructions.

## Workspace model

The deployment holds the **physical** model; each workspace holds a **logical** model, an overlay
describing how deployment collections look in that workspace. See [spec](spec.md) §7.6.

`GET /ws/{workspaceId}/v1/model` returns the model's version, content digest, served schema version,
the collections it serves (with fields and relations) and the deployment collections it does not
serve yet. It requires `data.model.read` or `data.model.write`: the model names the workspace's
collection fields, while every other caller reads the schema metadata.

The model is applied to the deployment manifest when a workspace's catalog is resolved, **in
realtime**. Model rules and the version a model write carries: [spec](spec.md) §7.

## Audit

`GET /ws/{workspaceId}/v1/audit` returns metadata of the workspace's committed mutations, with `limit`
and a cursor. It requires `data.audit.read`, granted on its own, not as a side effect of editing
records.

The audit returns identifiers and the names of changed fields. It never holds field values and is
not a revision history.

## Not stable

- **Deployment artifacts.** The collection manifest, policy bundle, database tables and column
  identifiers belong to the deployment. Clients read them through schema metadata, never the
  database.
- **Metadata content.** Collection fields, labels, relations and caller permissions change with the
  deployment. The metadata *shape* is stable; its content is not.
- **Tables and statements.** Internal to the service; clients never reach them.
- **Metrics and logs.** For the operator.
- **Refusal reasons.** A refusal answers `403 FORBIDDEN` and nothing else.

## Change rules

1. A change clients depend on is **major**: a new path version or a new client major. The path
   version is bumped only when the old one cannot be kept, and the old version is kept for at least
   one release.
2. Changes are announced in the [changelog](../../CHANGELOG.md).
3. A contract change amends the specification, names a check that proves it, and lands with that
   check.
4. Error codes are never removed and never change meaning. An unused code is kept and answers
   nothing.
5. Bounds may only grow, and never for a request a client already sends: a client asking for a page
   of 50 records keeps getting 50.

## Versions

| Item | Version | Where |
| --- | --- | --- |
| Service | `1.0.0` | `/healthz` (`version`), the image label, the package version. |
| API | `v1` | Every data route path. |
| Client | `1.0.0` | `packages/client/package.json` and the release tarball. |
| Access context contract | `1` | Access service discovery. |
| Gateway signature | `v5` | The identity header. Legacy `v4` is a migration path, declared with `DATA_LEGACY_IDENTITY`; refused by default. |
| Manifest format | `1` | The manifest's `version`. |
| Policy bundle format | `1` | The bundle's `version`. |

The access-service and gateway contracts are platform contracts, and the integration baseline is the
repository revision. [`compatibility.json`](../../compatibility.json) owns the three service
workspaces; `bun run check:compatibility` proves the docs and workflows agree with it.
