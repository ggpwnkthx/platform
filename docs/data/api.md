# API reference

The v1 HTTP endpoints of Data, with example requests and answers for each. It is for developers who call Data directly; the rules every endpoint obeys are normative in [spec §9](spec.md#9-http-api), and the [typed client](client.md) wraps the same calls.

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

A path missing from this table does not exist. Every workspace path is called through the gateway, which turns your session into the signed identity Data verifies; a direct call answers `401 UNAUTHENTICATED`.

## Headers

| Header | Direction | Use |
| --- | --- | --- |
| `cookie` or `authorization` | request | Your gateway credential. Data never reads it; the gateway does. |
| `content-type: application/json` | request | Required on every write body. |
| `idempotency-key` | request | Required on `POST /items/{collection}` ([spec §9.6](spec.md#96-creation-and-idempotency)). |
| `if-match` | request | The current validator, required on `PATCH`, `DELETE` and rollback ([spec §9.4](spec.md#94-reads-and-validators)). |
| `x-request-id` | answer | Correlation identifier, equal to an error's `requestId`. |
| `etag` | answer | A record's or version's validator. |
| `location` | answer | Where a created record lives. |
| `idempotency-replayed: true` | answer | The answer is a stored receipt. |
| `retry-after` | answer | Seconds to wait, on `409 OPERATION_IN_PROGRESS` and `429 TOO_MANY_REQUESTS`. |
| `cache-control: no-store` | answer | On every sensitive or permission-dependent answer. |
| `allow` | answer | The methods of a path, on `405`. |

The answer envelopes are listed in [spec §9.1](spec.md#91-conventions-and-endpoints).

## Identity

### Who am I

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/me
cookie: gateway_session=...
```

```json
{
  "data": {
    "principalId": "11111111-1111-4111-8111-111111111111",
    "tenantId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "workspaceId": "22222222-2222-4222-8222-222222222222",
    "workspace": {
      "id": "22222222-2222-4222-8222-222222222222",
      "slug": "acme",
      "displayName": null
    },
    "routeId": "data-api",
    "apiVersion": "v1"
  }
}
```

A principal without a grant in the workspace gets `403 FORBIDDEN` here too.

## Schema

### Read the schema

`GET /schema` describes every collection you may use; `GET /schema/{collection}` answers one entry, or `404 NOT_FOUND`. What it holds and hides is in [spec §9.2](spec.md#92-schema-metadata).

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/schema/articles
```

```json
{
  "data": {
    "key": "articles",
    "label": "Articles",
    "schemaVersion": "articles-v1",
    "actions": ["read", "create", "update", "delete"],
    "readableFields": ["title", "body", "status"],
    "writableFields": ["title", "body", "status"],
    "filterableFields": ["title", "status"],
    "fields": [
      { "name": "title", "type": "string", "required": true, "nullable": false, "maxLength": 240 }
    ],
    "relations": [{ "name": "category", "target": "categories", "type": "many-to-one" }]
  }
}
```

The answer to `GET /schema` wraps such entries in `collections`, next to `apiVersion`, `schemaVersion`, `policyBundleVersion` and `limits`. The `limits` object announces the API bounds:

```json
{
  "maxLimit": 200,
  "defaultLimit": 50,
  "maxSelectedFields": 50,
  "maxSortFields": 3,
  "maxIncludes": 5,
  "maxRelatedRowsPerRoot": 100,
  "maxRelatedRowsPerResponse": 1000,
  "maxResponseBytes": 4194304,
  "maxRecordBodyBytes": 262144,
  "maxFilterDepth": 5,
  "maxFilterLeaves": 50,
  "maxFilterValues": 100
}
```

## Records

### List records

Parameters: `fields`, `filter`, `search`, `sort`, `limit`, `cursor`, `include`, `include_count` ([spec §9.3](spec.md#93-query-parameters-and-filters)). The filter is URL-encoded JSON:

```json
{
  "_and": [
    { "title": { "_eq": "Launch notes" } },
    { "created_at": { "_gte": "2026-10-01T00:00:00Z" } }
  ]
}
```

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/items/articles?fields=title,status&sort=-title&limit=2&include_count=true
```

```json
{
  "data": [
    { "id": "44444444-4444-4444-8444-444444444444", "version": 2, "title": "Launch notes", "status": "draft" }
  ],
  "meta": { "limit": 2, "nextCursor": null, "count": 1 }
}
```

Pass `meta.nextCursor` back as `cursor` for the next page; it is `null` on the last one. Cursor lifetime, staleness and the 4 MiB answer budget are in [spec §9.5](spec.md#95-lists-and-cursors).

### Read a record

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/items/articles/44444444-4444-4444-8444-444444444444
```

```http
HTTP/1.1 200 OK
etag: "sha256:<lowercase hex digest>"
cache-control: no-store
```

```json
{ "data": { "id": "44444444-4444-4444-8444-444444444444", "version": 2, "title": "Launch notes", "body": null, "status": "draft" } }
```

The read takes no query parameter. Keep the `etag`: it is the validator a later write sends.

### Create a record

```http
POST /ws/22222222-2222-4222-8222-222222222222/v1/items/articles
content-type: application/json
idempotency-key: 7d0c2a4e-first-article

{ "title": "Launch notes", "body": "Initial content." }
```

```http
HTTP/1.1 201 Created
location: /ws/22222222-2222-4222-8222-222222222222/v1/items/articles/44444444-4444-4444-8444-444444444444
```

```json
{ "data": { "id": "44444444-4444-4444-8444-444444444444", "version": 1 } }
```

The answer is a receipt, not the record. A missing or malformed key answers `400 INVALID_REQUEST`. Retrying with the same key and body returns the same receipt with `idempotency-replayed: true`; the other outcomes are in [spec §9.6](spec.md#96-creation-and-idempotency).

### Update a record

```http
PATCH /ws/22222222-2222-4222-8222-222222222222/v1/items/articles/44444444-4444-4444-8444-444444444444
content-type: application/json
if-match: "sha256:<lowercase hex digest>"

{ "title": "Revised" }
```

The answer is `200` with the new representation in `data` and its new `etag`. Omitted fields stay unchanged, and an empty body is invalid. The precondition answers (`428`, `400`, `412`, `404`) are in [spec §9.4](spec.md#94-reads-and-validators).

### Delete a record

```http
DELETE /ws/22222222-2222-4222-8222-222222222222/v1/items/articles/44444444-4444-4444-8444-444444444444
if-match: "sha256:<lowercase hex digest>"
```

The answer is `204` with no body. Deletion is hard; a collection with history keeps a tombstone.

## Record versions

These paths answer `404 NOT_FOUND` for a collection without history. The rules are in [spec §9.8](spec.md#98-record-versions) and [§11.6](spec.md#116-record-version-history).

### List versions

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/items/articles/44444444-4444-4444-8444-444444444444/versions
```

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

### Read a version

`GET .../items/{collection}/{id}/versions/{version}` answers the version's canonical representation in `data`, with its own `etag`, exactly like a record read.

### Roll back

```http
POST /ws/22222222-2222-4222-8222-222222222222/v1/items/articles/44444444-4444-4444-8444-444444444444/rollback
content-type: application/json
if-match: "sha256:<lowercase hex digest>"

{ "version": 2 }
```

The answer is `200` with the record's new representation and `etag`. The record moves to the next version number.

## Aggregates

### Aggregate a collection

Parameters: `group_by`, `metrics`, `filter`, `search`, `limit` ([spec §9.9](spec.md#99-aggregates-and-search)).

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/aggregate/articles?group_by=status&metrics=sum:amount
```

```json
{
  "data": [
    { "group": { "status": "draft" }, "count": 12, "sum": { "amount": "42.50" } }
  ],
  "meta": { "limit": 100, "groups": 1, "truncated": false }
}
```

## Model

The model endpoints read and change the workspace model ([spec §7.6](spec.md#76-workspace-model)). Reads need `data.model.read` or `data.model.write`; writes need `data.model.write`. A refused change answers `400 INVALID_REQUEST`, an unknown collection, field or relation `404 NOT_FOUND`, and a concurrent change `409 CONFLICT`.

### Read the model

`GET /model` answers the model version, content digest, served schema version, the served collections with their fields and relations, and the deployment collections not served yet, plus `writable`: whether you hold `data.model.write`.

### Register a collection

```http
POST /ws/22222222-2222-4222-8222-222222222222/v1/model/collections
content-type: application/json

{ "key": "articles" }
```

The answer is `201` with `{ "data": { "registered": true } }`. `DELETE /model/collections/{collection}` removes the collection from the workspace and answers `{ "data": { "registered": false } }`.

### Change a collection

`PATCH /model/collections/{collection}` takes `label` and `description`, and answers `{ "data": { "version": 3 } }` with the new model version.

### Change fields

```http
POST /ws/22222222-2222-4222-8222-222222222222/v1/model/collections/articles/fields
content-type: application/json

{ "name": "title", "label": "Headline", "required": true, "maxLength": 120 }
```

| Request | Body | Answer |
| --- | --- | --- |
| Add a field (`POST .../fields`) | `name` plus attributes | `201`, the new model version |
| Change a field (`PATCH .../fields/{field}`) | attributes | `200`, the new model version |
| Remove a field (`DELETE .../fields/{field}`) | none | `200`, the new model version |
| Move a field (`POST .../fields/{field}/move`) | `{ "direction": "up" }` or `"down"` | `200`, the new model version |

Field attributes are `type`, `required`, `nullable`, `label`, `description`, `enum`, `default`, `minimum`, `maximum`, `minLength` and `maxLength`. The field must name a column of the collection's table, and its type must stay the column's.

### Change relations

| Request | Body | Answer |
| --- | --- | --- |
| Add a relation (`POST .../relations`) | `name`, `target`, `type`, `field`, optional `label` and `description` | `201`, the new model version |
| Change a relation (`PATCH .../relations/{relation}`) | `target`, `type`, `field`, optional `label` and `description` | `200`, the new model version |
| Remove a relation (`DELETE .../relations/{relation}`) | none | `200`, the new model version |

`type` is `many-to-one` or `one-to-many`.

## Audit

### Read the audit

Needs `data.audit.read`. Parameters: `limit` (default 50, at most 200) and `cursor`.

```http
GET /ws/22222222-2222-4222-8222-222222222222/v1/audit?limit=1
```

```json
{
  "data": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "occurredAt": "2026-10-21T16:00:00.000Z",
      "principalId": "11111111-1111-4111-8111-111111111111",
      "tenantId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "workspaceId": "22222222-2222-4222-8222-222222222222",
      "routeId": "data-api",
      "requestId": "request-123",
      "source": "gateway",
      "collection": "articles",
      "recordId": "44444444-4444-4444-8444-444444444444",
      "action": "update",
      "resultVersion": 2,
      "changedFields": ["title"],
      "policyBundleVersion": "<digest>",
      "policyId": "update-articles-own"
    }
  ],
  "meta": { "limit": 1, "nextCursor": "<cursor>" }
}
```

## OpenAPI description

`GET /ws/{workspaceId}/v1/openapi.json` answers the versioned OpenAPI document, which lists every path and error code. It needs the same signed identity and positive context as any workspace path.

## Probes

`/healthz`, `/readyz` and `/metrics` are for the deployment, not for clients. Their answers are in [spec §15.1](spec.md#151-probes-and-metrics).

## Errors

```json
{
  "error": {
    "code": "PRECONDITION_FAILED",
    "message": "The record changed since the validator was issued."
  },
  "requestId": "request-123"
}
```

Switch on `error.code`. Every code and its status are in [spec §9.7](spec.md#97-errors); fixes for common ones are in [Troubleshooting](troubleshooting.md).
