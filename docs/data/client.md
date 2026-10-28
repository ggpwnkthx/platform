# Typed client

`@data-backend/client` speaks the v1 [API contract](api.md) through the gateway. It hides nothing:
authorization and concurrency refusals reach the caller as typed errors.

## Installation

The client is published to a package registry and also ships as the release tarball; the tarball
version is the client version.

```bash
npm install @data-backend/client
# or, with bun:
bun add @data-backend/client
```

To pin a version by URL, install the release tarball (same package):

```bash
bun add https://github.com/ggpwnkthx/platform/releases/download/v1.0.0/data-backend-client-1.0.0.tgz
```

> [!NOTE]
> The repository root is the **service**, a different package. `bun add github:ggpwnkthx/platform`
> installs the root package, not the client.

```ts
import { DataClient } from '@data-backend/client'
```

- Runs on **bun** and **node**, ships its own files and has no dependencies. The packaging check
  installs the tarball in a consumer outside the repository and calls the API with it under both
  runtimes.
- A client talks to a deployment of the same major: client `1.x` works with deployment `1.y` for
  every `y >= x`. A deployment never removes a path or changes an answer's meaning within a major.

## Construction

```ts
const client = new DataClient({
  baseUrl: 'https://api.gateway.test',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  headers: { cookie: sessionCookie },   // the caller's credentials
  // fetch: myFetch,                    // the caller's transport
  // signal: controller.signal,         // cancellation
})
```

| Option | Meaning |
| --- | --- |
| `baseUrl` | The deployment's base URL, through the gateway. |
| `workspaceId` | Workspace for all calls. |
| `fetch` | Transport. Defaults to the global `fetch`. |
| `headers` | Headers sent on every call, such as the session cookie. |
| `signal` | Cancels the calls. |

The client never signs requests, stores access-service credentials or runs a login flow. Caller
credentials travel in the transport; the gateway turns them into a signed identity.

## Methods

| Method | Does |
| --- | --- |
| `me()` | Principal, tenant, workspace, route and API version. |
| `schema()` | Metadata of the collections the caller may use. |
| `collection(key)` | Metadata of one collection. |
| `list(key, options)` | One page of a collection. |
| `listAll(key, options)` | Every page of a collection, in sequence. |
| `get(key, id)` | One record. |
| `getWithValidator(key, id)` | One record and its `ETag`. |
| `create(key, body, { idempotencyKey })` | Creates a record; returns the receipt. |
| `update(key, id, body, { etag })` | Updates a record; returns the record and its new `ETag`. |
| `remove(key, id, { etag })` | Deletes a record. |
| `versions(key, id)` | A record's version history. |
| `version(key, id, version)` | One version of a record. |
| `rollback(key, id, version, { etag })` | Rolls a record back to a version; returns the record and its new `ETag`. |
| `aggregate(key, options)` | Aggregate groups. |
| `audit({ limit, cursor })` | A page of audit log metadata. |

### Writing

Creation needs an idempotency key; update and delete need the record's current validator.

```ts
const created = await client.create(
  'articles',
  { title: 'Launch notes', body: 'Initial content.' },
  { idempotencyKey: crypto.randomUUID() }
)
// created.id, created.version

const { record, etag } = await client.getWithValidator('articles', created.id)
const updated = await client.update(
  'articles',
  created.id,
  { title: 'Launch notes, revised' },
  { etag }
)
// updated.etag is the validator of the new version
```

On `412 PRECONDITION_FAILED` the record changed after the validator was issued: read it again and
reapply your change. See [Reads and validators](api.md#reads-and-validators).

### Versions

Read history like a record. Rollback is a write and needs the validator of the record's current
state.

```ts
const versions = await client.versions('articles', created.id)
// versions[0].version, versions[0].operation, versions[0].supersededAt

const previous = await client.version('articles', created.id, versions[0].version)
const { record, etag } = await client.rollback(
  'articles',
  created.id,
  versions[0].version,
  { etag }
)
```

Deployment policies authorize a rollback like any update, and the record moves to the next version
number, never back. See [Record versions](api.md#record-versions).

### Paging

```ts
for await (const rows of client.listAll('articles', { limit: 100 })) {
  for (const row of rows) {
    console.log(row.title)
  }
}
```

The caller bounds the traversal by stopping it. Pages are not a snapshot: concurrent changes alter
later pages.

## Collection types

The client is generic and knows nothing of a deployment's collections. To get typed collections,
generate them and pass the map as a type parameter:

```ts
import { DataClient } from '@data-backend/client'
import type { Collections } from './generated/collections'

const client = new DataClient<Collections>({ baseUrl, workspaceId })
const page = await client.list('articles')   // typed article rows
```

Without a map, rows are `RecordValue` and collection keys are plain strings. Collection names and
field types are not part of the package: they follow the deployment manifest, which is outside the
client's major version.

The generator writes `packages/client/src/deployment.ts` in this repository; another deployment
writes a file of the same shape in its own repository.

```bash
bun run scripts/dev/generate-client.ts          # writes the file
bun run scripts/dev/generate-client.ts --check  # refuses a stale file
```

## Errors

Every failure throws an `ApiError` carrying the service code, status, message, field details and
request id:

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

The client never swallows an authorization refusal or a concurrency conflict. For the stable codes see
[Error codes](api.md#error-codes).

## Package versioning

Semantic versioning:

- **patch**: changes nothing clients depend on;
- **minor**: adds a method or option; existing code keeps working;
- **major**: changes an answer's shape, a method name or an option's meaning.

Prove the release artifact works outside this repository:

```bash
bun run check:client-package
```

It packs the client with the release command, installs the tarball in an external consumer, imports
the client by its public name and calls the API.
