# API contract

The stable v1 HTTP surface of the data service: what clients may rely on and what a change costs. The
[specification](spec.md#9-http-api) is normative; this page changes only with a major client version.

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

- The backend receives the whole request path ([spec §3](spec.md#3-topology)).
- A path not listed does not exist: a deferred capability answers `404 NOT_FOUND`, never a placeholder.
  An unknown method on a listed path answers `405` with `Allow`.
- Every data path needs the gateway's signed identity. There is no login endpoint, token endpoint or
  session.
- `/me` answers the principal, tenant, route and `workspace` as `{ "id", "slug", "displayName" }`;
  `slug` and `displayName` are `null` when the registry holds none.

## Envelopes

| Answer | Shape |
| --- | --- |
| List | `{ "data": [...], "meta": { "limit", "nextCursor", "count"? } }` |
| Record | `{ "data": { ... } }`, with the record's validator in the `etag` header |
| Creation | `201`, `{ "data": { "id", "version" } }`, with the record's location in the `location` header |
| Aggregate | `{ "data": [...], "meta": { "limit", "groups", "truncated" } }` |
| Error | `{ "error": { "code", "message", "details"? }, "requestId" }` |
| Every answer | `x-request-id` header, equal to an error's `requestId` |
| Sensitive or permission-dependent answer | `Cache-Control: no-store` |

## Error codes

Switch on the code, never the message. A code's status is fixed within a major version; the OpenAPI
document publishes every code.

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

| Cause | Answer |
| --- | --- |
| Lock not granted in time | `409 CONFLICT` |
| Constraint violated | `409 CONFLICT` or `422 VALIDATION_FAILED` |
| Statement over budget | `504 DEADLINE_EXCEEDED` |
| Database unreachable | `503 DATABASE_UNAVAILABLE` |
| Tenant holds all of its room | `429 TOO_MANY_REQUESTS` with `Retry-After`. The room is the whole process unless `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT` is set (multi-tenant deployments set it). |
| Refusal by policy | `403 FORBIDDEN` only: never the refusing policy, never whether the principal or the grant was unknown |
| Anything else | `500 INTERNAL_ERROR`, always a service defect |

The message is a safe summary, and `details` name only fields the caller may write or query. Answers
never carry stack traces, SQL text, constraint names, raw access-service reasons or other tenants'
identifiers.

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

Unknown and repeated parameters are refused. The raw query string is at most 16 KiB.

## Filter grammar

```json
{
  "_and": [
    { "title": { "_eq": "Launch notes" } },
    { "created_at": { "_gte": "2026-10-01T00:00:00Z" } }
  ]
}
```

| Operator | Takes |
| --- | --- |
| `_and`, `_or` | A non-empty array of filter objects. |
| `_not` | One filter object, which it negates. |
| `_eq`, `_neq`, `_lt`, `_lte`, `_gt`, `_gte` | One non-null value of the field's type. |
| `_in`, `_nin` | 1 to 100 values of the field's type. |
| `_is_null` | The only way to compare with null. |

| Rule | Detail |
| --- | --- |
| Size | Depth at most 5, at most 50 leaf predicates. `{}` adds no caller predicate. |
| Types | Operators are checked against the field type. Values are bound parameters; identifiers come from the validated manifest. |
| Not supported | Dotted relation filters, JSON path expressions, arbitrary functions, SQL wildcards. |
| Negation | Three-valued logic: negating unknown gives unknown, so a negated comparison never matches a null value. |
| Usable fields | The intersection of the collection's read policies. Filtering or sorting by another field is `400 INVALID_QUERY`. |

## Lists and cursors

| Rule | Detail |
| --- | --- |
| Consistency | Rows and count are read in one read-only snapshot, with the same predicates and filter. |
| Answer size | At most 4 MiB encoded, expansions included. Over it: `422 RESULT_TOO_LARGE` and no partial page; no success byte is sent before the answer is complete. |
| Expansions | Depth 1; 100 related rows per root record; 1000 per answer. |
| Cursor binding | Opaque and signed. Binds principal, tenant, workspace, collection, route, filter, fields, sort, expansions, count option, limit, position, schema version, policy bundle version and the caller's permission fingerprint. Never an authorization credential. |
| Cursor lifetime | 15 minutes. |
| Tampered cursor, or one from another request | `400 INVALID_CURSOR` |
| Expired cursor, or schema, bundle or permissions changed since issue | `409 CURSOR_STALE` |
| Later pages | Each page gets a fresh context and the current policies. Pages are not a snapshot: concurrent inserts, updates and deletes change later pages. |

## Reads and validators

A record read returns every field readable for that row, plus `id` and `version`. It takes no query
parameters (`fields`, `include` or any other is `400 INVALID_QUERY`); use the list for a projection.

The strong `ETag` is `"sha256:<lowercase hex digest>"` over the canonical bytes: keys sorted
recursively, array order kept, no insignificant whitespace. The bytes include the version, so any
change invalidates the validator.

`PATCH` and `DELETE` require a current validator:

| Condition | Answer |
| --- | --- |
| No `If-Match` | `428 PRECONDITION_REQUIRED` |
| Weak, wildcard, malformed or multiple validator | `400 INVALID_PRECONDITION` |
| Current authorized representation differs | `412 PRECONDITION_FAILED` |
| Record missing or no longer readable | `404 NOT_FOUND` |
| Success, `PATCH` | The new canonical representation and its `ETag`. |
| Success, `DELETE` | `204`, no body. |

An update needs a read policy and the action's complete write policy. Every update increments the
version, even when no value changes; an empty `PATCH` is invalid.

## Record versions

History is optional per collection ([spec §11.6](spec.md#116-record-version-history)): the manifest
declares the versions table and a reviewed migration creates it. It holds the non-current versions; a
deleted record keeps a tombstone, the image of its last version.

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

| Request | Behavior |
| --- | --- |
| Version list | Newest first, at most 200; older versions are omitted. Unreadable versions are absent. |
| One version | Canonical representation with a strong `ETag`. The database applies the read predicates to the version image as to the record; ungranted fields are omitted; an unreadable version is `404 NOT_FOUND`. |
| Rollback body | Exactly `{ "version": 2 }`: one property, a positive integer. Anything else is `400 INVALID_REQUEST`. |
| Rollback effect | An ordinary write under the same policies as any update: it restores the differing fields, and the record gets the next version number, never an earlier one. |
| Rollback validator | `If-Match` names the current state: the record's validator, or its tombstone's if deleted. A deleted record is restored from the image, with the version after the tombstone's. |
| Collection without history | All three version paths answer `404 NOT_FOUND`. |

Rollback answers:

| Condition | Answer |
| --- | --- |
| No `If-Match` | `428 PRECONDITION_REQUIRED` |
| Weak, wildcard, malformed or multiple validator | `400 INVALID_PRECONDITION` |
| Current record state differs | `412 PRECONDITION_FAILED` |
| Version missing or not readable | `404 NOT_FOUND` |
| Record already holds that version | `409 CONFLICT` |
| Deployment policies forbid the write | `403 FORBIDDEN` |

## Creation and idempotency

| Rule | Detail |
| --- | --- |
| Key | `POST` requires `Idempotency-Key`: 1 to 128 ASCII letters, digits, periods, underscores or hyphens. Opaque input, not an authority. |
| Key scope | Principal, tenant, workspace, route and endpoint. |
| Fingerprint | Method, path and validated body, stored with the key. |
| Atomicity | Key claim, insert, audit entry, event, deliveries and receipt commit together. A rolled-back transaction leaves no receipt and no effect. |
| Same key, same body | The original receipt with `Idempotency-Replayed: true`; nothing is created. The replay authenticates again, needs a currently applicable create capability, and never replays field values. |
| Same key, different body | `409 IDEMPOTENCY_CONFLICT` |
| Concurrent duplicate | Waits within the request budget; unresolved after two seconds, `409 OPERATION_IN_PROGRESS` with `Retry-After: 1`. |
| Retention | Receipts last at least 24 hours. After that, the key starts a new operation: deduplication is not permanent. |
| Later change | Deleting or changing the record neither changes its receipt nor recreates it. |

A creation answers a receipt, not the record. Fetch the record separately if authorized; a receipt
never grants a read.

```json
{ "data": { "id": "44444444-4444-4444-8444-444444444444", "version": 1 } }
```

## Aggregates and search

```json
{
  "data": [
    { "group": { "status": "draft" }, "count": 12, "sum": { "amount": "42.50" } }
  ],
  "meta": { "limit": 100, "groups": 1, "truncated": false }
}
```

| Rule | Detail |
| --- | --- |
| Aggregate rows | The rows the matching list reads: same scope, read predicates and caller filter. Not a privileged query path ([spec §9](spec.md#9-http-api)). |
| Group and metric fields | Must be fields the caller may filter and sort by. A function undefined for the field's type is `400 INVALID_QUERY`. |
| Integer sums and averages | Decimals, exactly as the database returns them. |
| Group order | By the group fields; `truncated` says some groups were not returned. |
| `search` | Database text search over the manifest's searchable fields and search configuration; the caller supplies only the text. Combines with the filter, and a list's count counts the results. |
| Hidden field in search | `403 FORBIDDEN` |
| Search in policies | Never: search is not a filter operator ([decision 23](decisions.md#23-search-is-a-query-parameter-not-a-filter-operator)). |

## Metadata, model and audit

| Path | Returns | Requires |
| --- | --- | --- |
| `/schema` | Collections where the caller holds an applicable action policy; a collection may be write-only, its records unreadable. Each carries key, label, schema version, supported actions, readable and writable fields with bounds, filterable and sortable fields, visible relations, policy bundle version and API limits. Never SQL identifiers, row predicates, secrets, subscriber configuration, access-service grants or studio instructions. | At least one applicable action policy |
| `/model` | Model version, content digest, served schema version, served collections with fields and relations, and deployment collections not served yet. | `data.model.read` or `data.model.write` |
| `/audit` | Metadata of committed mutations, paged with `limit` and a cursor: identifiers and changed field names, never values. Not a revision history. | `data.audit.read`, granted on its own, not implied by editing records |

The deployment holds the **physical** model; a workspace model is a **logical** overlay on it, applied
in realtime whenever the workspace's catalog is resolved. Model rules and the version a model write
carries: [spec §7.6](spec.md#76-workspace-model).

## Stability

| Not stable | Instead |
| --- | --- |
| Deployment artifacts: manifest, policy bundle, tables and column identifiers | Read schema metadata. |
| Metadata content: fields, labels, relations, permissions | Only the metadata shape is stable. |
| Metrics, logs, refusal reasons | A refusal is `403 FORBIDDEN` and nothing else. |

Change rules:

1. A change clients depend on is **major**: a new path version or a new client major. The path version
   is bumped only when the old one cannot be kept, and the old one stays for at least one release.
2. Changes are announced in the [changelog](../../CHANGELOG.md).
3. A contract change amends the specification and lands with a check that proves it.
4. Error codes are never removed and never change meaning; an unused code stays and answers nothing.
5. Bounds may only grow, and never for a request a client already sends: a page of 50 stays 50.

| Item | Version | Where |
| --- | --- | --- |
| Service | `1.0.0` | `/healthz` (`version`), the image label, the package version. |
| API | `v1` | Every data route path. |
| Client | `1.0.0` | `packages/client/package.json` and the release tarball. |
| Access context contract | `1` | Access service discovery. |
| Gateway signature | `v5` | The identity header. Legacy `v4` is a migration path, declared with `DATA_LEGACY_IDENTITY`; refused by default. |
| Manifest format | `1` | The manifest's `version`. |
| Policy bundle format | `1` | The bundle's `version`. |

Access-service and gateway contracts are platform contracts; the integration baseline is the
repository revision in [`compatibility.json`](../../compatibility.json), and
`bun run check:compatibility` proves docs and workflows agree with it.
