# Build an app on Data

Take an application from a data model to working calls: declare its collections, write the policies that say what each permission allows, register a workspace that serves them, grant users the permissions, then read and write records through the gateway and follow their history. Developers own the model and the calls ([developer](../roles/developer.md)); an operator or DBA applies migrations and runs the workspace commands ([dba](../roles/dba.md)).

## Before you start

| You need | Why | Where it is described |
| --- | --- | --- |
| A running platform, locally (`bun run dev`) or deployed | Every call goes through the gateway to Data | [Quickstart](../platform/quickstart.md), [Data getting started](../data/getting-started.md) |
| The schema owner's database URL (`DATA_OWNER_DATABASE_URL`) | Migrations and the workspace, collection and policy commands run as the owner | [Data configuration: operator commands](../data/configuration.md#operator-commands) |
| The Access tenant the workspace will belong to, by UUID | A workspace belongs to one tenant for life | [data spec §6.1](../data/spec.md#61-workspace-registry) |
| A gateway route to Data and a matching Data binding | The binding's `routeId` is the route Access grants are checked against | [Data configuration: bindings file](../data/configuration.md#bindings-file) |
| An Access administration credential | Users need permission keys in the workspace | [Manage access](manage-access.md) |

The development runner already provides all of this for workspace `11111111-1111-4111-8111-111111111111` and route `data-api`, so you can try the calls before you model anything.

## Steps

### 1. Model the collections

Data serves only tables that a reviewed migration created and the manifest names. For each collection:

1. Write a migration with the business columns, the scope columns `tenant_id` and `workspace_id`, the fields the server maintains, composite foreign keys for relations, forced row-level security, and the indexes your filters and sorts will use.
2. Apply it as the schema owner: `DATA_OWNER_DATABASE_URL=... bun run migrate`.
3. Describe the collection in the manifest (`DATA_SCHEMA_BUNDLE_FILE`, `manifests/schema.json` in this repository): its `key`, its `table`, typed `fields`, and any `relations`.

```json
{
  "key": "articles",
  "table": "data.articles",
  "label": "Articles",
  "fields": {
    "title": { "type": "string", "required": true, "nullable": false, "maxLength": 240 }
  }
}
```

Add `versions.table` to keep a record history, and `search` for text search; both also need a migration. The step-by-step version, with the example migrations, is in [Modeling: add a collection](../data/modeling.md#add-a-collection), and every manifest field is in [Data configuration: collection manifest](../data/configuration.md#collection-manifest).

Never send `id`, `version`, the scope columns or the `created_*` and `updated_*` fields: Data fills them, and a write that names one is refused with `422 VALIDATION_FAILED` ([data spec §7.2](../data/spec.md#72-server-maintained-fields)).

### 2. Write the policy bundle

A policy names one permission key, one collection, one action (`read`, `create`, `update` or `delete`), the rows it covers (`where`), the condition the written row must meet (`check`) and the fields it grants. Nothing is allowed unless a policy allows it.

```json
{
  "version": 1,
  "policies": [
    { "id": "read-articles", "permission": "content.reader", "collection": "articles",
      "action": "read", "where": {}, "fields": ["title", "body", "status"] },
    { "id": "edit-own-articles", "permission": "content.editor", "collection": "articles",
      "action": "update", "where": { "created_by": { "_eq": "$principalId" } },
      "check": { "created_by": { "_eq": "$principalId" } }, "fields": ["title", "body"] }
  ]
}
```

Most surprises come from four rules. An update or delete also needs a read policy. One policy must cover a whole write, because Data never merges two. Only fields present in every read policy can be used to filter or sort. Relations must be listed among a read policy's fields to be expanded. The checklist is in [Modeling: write policies](../data/modeling.md#write-policies), the format in [Data configuration: policy bundle](../data/configuration.md#policy-bundle), and the composition rules in [data spec §8](../data/spec.md#8-data-authorization).

### 3. Release the manifest and bundle

The manifest and the deployment bundle are read once at startup and versioned by their content, so a change reaches a replica only when it restarts. Regenerate the client types, then release:

```bash
bun run scripts/dev/generate-client.ts          # write the collection type map
bun run scripts/dev/generate-client.ts --check  # in CI: fail on a stale map
```

After the restart, `GET /readyz` answers `200` only if the manifest matches the migrated tables; a missing column or a table without forced row-level security keeps it at `503` with a reason ([Data operations: migrations and drift](../data/operations.md#migrations-and-drift)).

### 4. Register the workspace and its collections

From `packages/data`, as the schema owner:

```bash
export DATA_OWNER_DATABASE_URL=...
WS=22222222-2222-4222-8222-222222222222
bun run workspace -- create --id $WS --tenant <access tenant uuid> --slug acme --name "Acme"
```

A new workspace serves every collection of the manifest. To serve only some of them, register those; from then on the workspace serves exactly its registered, enabled collections:

```bash
bun run collection -- register --workspace $WS --collection articles
bun run collection -- enable --workspace $WS --collection articles
bun run collection -- list --workspace $WS
```

A holder of `data.model.write` can register a collection over HTTP instead, with `POST /ws/{workspaceId}/v1/model/collections`, or with `platformctl data model collection add` ([Data API: register a collection](../data/api.md#register-a-collection)).

### 5. Publish a workspace bundle (optional)

Skip this step if the deployment bundle suits the workspace. Otherwise publish one for it; Data validates it against the manifest, stores it as an immutable version, and applies it from the next request:

```bash
bun run policy -- publish --workspace $WS --file policies.json
bun run policy -- list --workspace $WS
```

Details: [Modeling: publish a workspace bundle](../data/modeling.md#publish-a-workspace-bundle) and [data spec §8.6](../data/spec.md#86-workspace-bundle).

### 6. Grant permission keys in Access

The bundle says what `content.editor` may do; Access says who holds it. Grant the keys your policies name, on the workspace and on Data's route, which is the binding's `routeId` and not a collection name:

```bash
platformctl access grants put --tenant acme --user-id <principal id> \
  --permission content.editor --workspace-id $WS --route-id data-api
```

Grant `data.audit.read`, `data.model.read` and `data.model.write` separately to the people who need them. Group grants, roles and the console's **Rights** page are covered in [Manage access](manage-access.md).

### 7. Call Data from your application

Use the typed client from Bun or Node; it sends your credentials to the gateway and never signs anything itself ([Typed client](../data/client.md)):

```ts
import { DataClient, ApiError } from '@data-backend/client'
import type { Collections } from './generated/collections'

const client = new DataClient<Collections>({
  baseUrl: 'https://api.example.com',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  headers: { cookie: sessionCookie },
})

const page = await client.list('articles', {
  fields: ['title', 'status'],
  filter: { status: { _eq: 'draft' } },
  sort: ['-title'],
  limit: 50,
})
const next = page.meta.nextCursor
  ? await client.list('articles', { limit: 50, cursor: page.meta.nextCursor })
  : null

const created = await client.create('articles', { title: 'Launch notes' }, { idempotencyKey: crypto.randomUUID() })
const { etag } = await client.getWithValidator('articles', created.id)
try {
  await client.update('articles', created.id, { title: 'Revised' }, { etag })
} catch (error) {
  if (error instanceof ApiError && error.code === 'PRECONDITION_FAILED') {
    // someone else changed it: read again and reapply
  }
}
```

The same calls over raw HTTP through the gateway:

```bash
WS=https://api.example.com/ws/22222222-2222-4222-8222-222222222222/v1
curl -s -G "$WS/items/articles" -H "cookie: $SESSION" \
  --data-urlencode 'filter={"status":{"_eq":"draft"}}' --data-urlencode 'limit=50'
curl -s -X POST "$WS/items/articles" -H "cookie: $SESSION" \
  -H 'content-type: application/json' -H 'idempotency-key: launch-notes-1' -d '{"title":"Launch notes"}'
curl -s -i "$WS/items/articles/<id>" -H "cookie: $SESSION"            # keep the etag header
curl -s -X PATCH "$WS/items/articles/<id>" -H "cookie: $SESSION" \
  -H 'content-type: application/json' -H 'if-match: "sha256:<digest>"' -d '{"title":"Revised"}'
```

Keep these contracts in mind when you write the calls:

| Concern | What to do | Reference |
| --- | --- | --- |
| Lists | Pass `meta.nextCursor` back as `cursor` until it is `null`. Cursors last 15 minutes and go stale when the schema, bundle or your permissions change (`409 CURSOR_STALE`): start the list again. | [data spec §9.5](../data/spec.md#95-lists-and-cursors) |
| Filters | URL-encoded JSON with `_and`, `_or`, `_not`, comparisons, `_in`, `_nin` and `_is_null`, on fields every read policy grants. | [data spec §9.3](../data/spec.md#93-query-parameters-and-filters) |
| Creates | Send an `idempotency-key` and retry with the same key and body after a timeout; the replay returns the stored receipt. A different body under the same key is `409 IDEMPOTENCY_CONFLICT`. | [data spec §9.6](../data/spec.md#96-creation-and-idempotency) |
| Updates and deletes | Send the record's `etag` in `if-match`. On `412 PRECONDITION_FAILED`, read the record and apply your change again. | [data spec §9.4](../data/spec.md#94-reads-and-validators) |
| Errors | Branch on `error.code`, never on the message, and log `requestId`. | [data spec §9.7](../data/spec.md#97-errors) |

For scripts and quick checks, the CLI wraps the same endpoints: `platformctl data items list articles --limit 20`, `platformctl data items create articles --body ./record.json --idempotency-key <key>` and `platformctl data items update articles <id> --body ./record.json --etag '"…"'` ([CLI spec §5.6](../cli/spec.md#56-data)). In the console, people browse, filter and edit the same records ([console user guide](../console/user-guide.md#browse-records)).

### 8. Read history, audit and events

Three trails record what happened, each with its own permission and purpose:

| Trail | How to read it | Needs | Reference |
| --- | --- | --- | --- |
| Record versions | `client.versions(key, id)`, `GET /items/{collection}/{id}/versions`; roll back with `client.rollback(...)` and the current `etag` | A read policy; a rollback is authorized like an update | [Data API: record versions](../data/api.md#record-versions), [data spec §9.8](../data/spec.md#98-record-versions) |
| Audit | `client.audit({ limit, cursor })`, `GET /audit`, or `platformctl data audit` | `data.audit.read` | [Data API: audit](../data/api.md#read-the-audit), [data spec §11.2](../data/spec.md#112-audit-entries) |
| Events | Delivered to subscribers registered in the deployment's server code and run by a worker; there is no HTTP endpoint for them | A worker principal with its own grants | [data spec §11.3](../data/spec.md#113-domain-event-envelope), [§11.4](../data/spec.md#114-trusted-subscribers) |

Versions carry field values; the audit carries only identifiers and the names of changed fields. Events carry identifiers too and may arrive more than once or out of order, so a subscriber reads current data through an authorized read and compares record versions. Running a worker is in [Data getting started: run with a worker](../data/getting-started.md#run-with-a-worker), and inspecting or requeueing deliveries is in [Data operations: failed deliveries](../data/operations.md#failed-deliveries). The docs do not describe how to register a subscriber beyond the composition root; read the Data workspace code for that.

## Check that it worked

1. `GET /readyz` on Data answers `200 {"status":"ready"}` after the release ([data spec §15.1](../data/spec.md#151-probes-and-metrics)).
2. `platformctl data schema articles` (or `GET /schema/articles`) lists the collection with the actions and fields your policies grant the caller.
3. A create returns `201` with a receipt; repeating it with the same key returns the same receipt and `idempotency-replayed: true`.
4. An update with a stale `etag` returns `412 PRECONDITION_FAILED`, and one with the current `etag` returns the new version.
5. A principal without the permission key gets `403 FORBIDDEN`, and the audit (read with `data.audit.read`) lists the successful writes with their `policyId`.

## If something goes wrong

| Symptom | Look here |
| --- | --- |
| Data stays not ready after the release | [Data troubleshooting: readiness](../data/troubleshooting.md#503-on-readiness) |
| `401 UNAUTHENTICATED` | [Data troubleshooting](../data/troubleshooting.md#401-unauthenticated) |
| `403 workspace_forbidden` from the gateway | [Gateway troubleshooting](../gateway/troubleshooting.md#403-workspace_forbidden) |
| `403 FORBIDDEN` from Data | [Data troubleshooting](../data/troubleshooting.md#403-forbidden) |
| `404 NOT_FOUND` for a workspace or collection that exists | [Data troubleshooting](../data/troubleshooting.md#404-not_found-for-an-existing-workspace) |
| `409` or `412` on writes | [Data troubleshooting: conflicts](../data/troubleshooting.md#409-conflicts), [precondition failed](../data/troubleshooting.md#412-precondition_failed-on-a-write) |
| `422 RESULT_TOO_LARGE` | [Data troubleshooting](../data/troubleshooting.md#422-result_too_large) |
| A model change is refused | [Data troubleshooting](../data/troubleshooting.md#workspace-model-does-not-change) |
| The audit is empty or deliveries do not run | [Data troubleshooting: audit](../data/troubleshooting.md#audit-log-is-empty), [deliveries](../data/troubleshooting.md#deliveries-do-not-run) |
| Anything else | [Troubleshoot a request](troubleshoot-a-request.md) |

## Related

- [Data modeling](../data/modeling.md)
- [Data API reference](../data/api.md)
- [Typed client](../data/client.md)
- [Data specification](../data/spec.md)
- [Data configuration](../data/configuration.md)
- [Data operations](../data/operations.md)
- [Put a service behind the gateway](put-a-service-behind-the-gateway.md)
- [Manage access](manage-access.md)
- [Troubleshoot a request](troubleshoot-a-request.md)
