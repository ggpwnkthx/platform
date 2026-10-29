# Typed client

`@data-backend/client` calls the v1 [API](api.md) through the gateway. Authorization and concurrency
refusals reach you as typed errors; nothing is hidden.

## Install

```bash
npm install @data-backend/client
bun add @data-backend/client
# or pin the release tarball (same package; its version is the client version):
bun add https://github.com/ggpwnkthx/platform/releases/download/v1.0.0/data-backend-client-1.0.0.tgz
```

> [!NOTE]
> `bun add github:ggpwnkthx/platform` installs the repository root, which is the **service**, not the
> client.

The client runs on Bun and Node and has no dependencies. Client `1.x` works with any deployment
`1.y` where `y >= x`: within a major, a deployment never removes a path or changes an answer's
meaning.

## Construct

```ts
import { DataClient } from '@data-backend/client'

const client = new DataClient({
  baseUrl: 'https://api.gateway.test',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  headers: { cookie: sessionCookie },
})
```

| Option | Meaning |
| --- | --- |
| `baseUrl` | Deployment URL, through the gateway. |
| `workspaceId` | Workspace for every call. |
| `headers` | Sent on every call, such as the session cookie. |
| `fetch` | Transport; defaults to global `fetch`. |
| `signal` | Cancels calls. |

The client never signs requests, stores Access credentials or logs in. Your credentials
travel in the transport, and the gateway turns them into a signed identity.

## Methods

| Method | Returns |
| --- | --- |
| `me()` | Principal, tenant, workspace, route, API version. |
| `schema()`, `collection(key)` | Metadata of the collections you may use, or of one. |
| `list(key, options)` | One page. |
| `listAll(key, options)` | Every page, in sequence. |
| `get(key, id)`, `getWithValidator(key, id)` | One record; the second adds its `ETag`. |
| `create(key, body, { idempotencyKey })` | The creation receipt. |
| `update(key, id, body, { etag })` | The record and its new `ETag`. |
| `remove(key, id, { etag })` | Nothing; deletes the record. |
| `versions(key, id)`, `version(key, id, version)` | A record's history, or one version. |
| `rollback(key, id, version, { etag })` | The record and its new `ETag`. |
| `aggregate(key, options)` | Aggregate groups. |
| `audit({ limit, cursor })` | A page of audit metadata. |

## Write

Creation needs an idempotency key; update and delete need the current validator.

```ts
const created = await client.create(
  'articles',
  { title: 'Launch notes', body: 'Initial content.' },
  { idempotencyKey: crypto.randomUUID() }
)

const { record, etag } = await client.getWithValidator('articles', created.id)
const updated = await client.update('articles', created.id, { title: 'Revised' }, { etag })
// updated.etag validates the new version
```

On `412 PRECONDITION_FAILED`, read the record again and reapply your change
([Reads and validators](api.md#reads-and-validators)).

## Versions

Rollback is a write: it needs the current validator, policies authorize it like an update, and the
record moves to the next version number ([Record versions](api.md#record-versions)).

```ts
const versions = await client.versions('articles', created.id)
// versions[0].version, .operation, .supersededAt
const previous = await client.version('articles', created.id, versions[0].version)
await client.rollback('articles', created.id, versions[0].version, { etag })
```

## Page

```ts
for await (const rows of client.listAll('articles', { limit: 100 })) {
  for (const row of rows) console.log(row.title)
}
```

Stop the loop to bound the traversal. Pages are not a snapshot: concurrent changes alter later pages.

## Collection types

The client knows no deployment's collections. Generate a type map and pass it as a type parameter:

```ts
import type { Collections } from './generated/collections'

const client = new DataClient<Collections>({ baseUrl, workspaceId })
const page = await client.list('articles')   // typed article rows
```

Without a map, rows are `RecordValue` and keys are plain strings. Collection names and field types
follow the deployment manifest, outside the client's major version.

In this repository the generator writes `packages/client/src/deployment.ts`; another deployment writes
a file of the same shape in its own repository:

```bash
bun run scripts/dev/generate-client.ts          # write the file
bun run scripts/dev/generate-client.ts --check  # fail on a stale file
```

## Errors

Every failure throws `ApiError` with the service code, status, message, field details and request
ID. Switch on the code ([Error codes](api.md#error-codes)):

```ts
import { ApiError } from '@data-backend/client'

try {
  await client.update('articles', id, { title: 'x' }, { etag })
} catch (error) {
  if (error instanceof ApiError && error.code === 'PRECONDITION_FAILED') {
    // the record changed
  }
}
```

## Package versioning

| Bump | Means |
| --- | --- |
| patch | Nothing clients depend on changes. |
| minor | A new method or option; existing code keeps working. |
| major | An answer's shape, a method name or an option's meaning changes. |

`bun run check:client-package` packs the client with the release command, installs the tarball in a
consumer outside the repository, imports it by its public name and calls the API under Bun and Node.
