# Configuration

Every environment variable and deployment file Data reads: process settings, database roles, Access, budgets, the worker, operator commands, the gateway bindings file, the collection manifest and the policy bundle. It is the reference for operators.

## How configuration is read

`src/runtime/config.ts` reads the environment once at startup and validates it as a whole. It reports every problem in one message that starts with `the environment is invalid:`, and any value it cannot understand stops the process. The behavioral rules are in [spec §14](spec.md#14-configuration).

> [!IMPORTANT]
> A secret is always a file, never an environment value: process lists are visible and logs are not private. Every `_FILE` variable names a file that must be readable and non-empty.

`packages/data/.env.example` lists the process variables with development values that are not secrets. [Getting started](getting-started.md#run-the-service-alone) copies it to `.env`, which Bun loads at startup.

The Required column uses these values: **always** means every process role; **api** means roles `api` and `all`; **worker** means roles `worker` and `all`.

## Process

| Variable | Default | Required | Allowed values | Meaning |
| --- | --- | --- | --- | --- |
| `DATA_HOST` | `127.0.0.1` | no | any host | Listener bind address. In production, bind an explicitly protected service interface. |
| `DATA_PORT` | `8082` | no | 1 to 65535 | Listener port. |
| `DATA_PROCESS_ROLE` | `all` | no | `api`, `worker`, `all` | What the process runs ([Operations](operations.md#process-roles)). |
| `DATA_ENVIRONMENT` | `development` | no | `development`, `production` | `production` turns on the transport and secret checks of [Production checks](#production-checks). |
| `DATA_LOG_LEVEL` | `info` | no | `debug`, `info`, `warn`, `error` | Log level. |

## Database

| Variable | Default | Required | Allowed values | Meaning |
| --- | --- | --- | --- | --- |
| `DATA_DATABASE_URL` | none | always | `postgres://` or `postgresql://` URL | The scoped data role (`data_runtime`): rows in the transaction's scope, nothing else. |
| `DATA_REGISTRY_DATABASE_URL` | none | always | `postgres://` or `postgresql://` URL | The narrow reader of the workspace registry (`data_registry`). |
| `DATA_DELIVERY_DATABASE_URL` | the value of `DATA_DATABASE_URL` | worker | `postgres://` or `postgresql://` URL | Delivery metadata (`data_delivery`). |
| `DATA_DB_POOL_MAX` | `20` | no | 1 to 200 | Data-role connections per process. |

The registry and delivery pools hold five connections each; their size is not configurable.

## Deployment artifacts

| Variable | Default | Required | Allowed values | Meaning |
| --- | --- | --- | --- | --- |
| `DATA_GATEWAY_BINDINGS_FILE` | none | api | path | Accepted routes and how their identities are verified ([Bindings file](#bindings-file)). |
| `DATA_LEGACY_IDENTITY` | `refuse` | no | `refuse`, `warn`, `allow` | What to do with the legacy `v4` identity format: `refuse` stops startup on a version 1 file or a `v4` route, `warn` accepts them and logs a warning naming the routes, `allow` accepts them. The format is symmetric: Data would hold the gateway's derived secret and could sign an identity with it. `1.0.0` refuses it by default and `2.0.0` removes it. |
| `DATA_SCHEMA_BUNDLE_FILE` | none | always | path | Collection manifests ([Collection manifest](#collection-manifest)). |
| `DATA_POLICY_BUNDLE_FILE` | none | always | path | Policy bundle ([Policy bundle](#policy-bundle)). |
| `DATA_CURSOR_KEY_FILE` | none | always | file of at least 32 bytes | Key that signs page cursors. It is not a gateway key. |

Manifests and policies are immutable for the life of a process, and their version is their content digest.

## Access

| Variable | Default | Required | Allowed values | Meaning |
| --- | --- | --- | --- | --- |
| `DATA_ACCESS_URL` | none | always | absolute `http` or `https` URL | Access base URL. It must be `https` in production, because the context credential travels with it. |
| `DATA_ACCESS_CONTEXT_TOKEN_FILE` | none | always | file | Service credential for the access context contract. |
| `DATA_CONTEXT_CACHE_TTL_MS` | `0` | no | 0 to 5000 | Lifetime of the read-only context cache. `0` means no cache. Mutations and worker commands always fetch a fresh context. |
| `DATA_CONTEXT_CACHE_MAX_ENTRIES` | `4096` | no | 1 to 1000000 | Context cache size. When it is full, the least recently used entry is evicted; expired entries are dropped on write. |
| `DATA_ACCESS_TIMEOUT_MS` | `1000` | no | 1 to 60000 | Bound on one call to Access. |

## Budgets

| Variable | Default | Allowed values | Bounds |
| --- | --- | --- | --- |
| `DATA_REQUEST_TIMEOUT_MS` | `10000` | 100 to 600000 | All work for one request. |
| `DATA_DB_STATEMENT_TIMEOUT_MS` | `3000` | 100 to 600000 | One statement; the server cancels it. |
| `DATA_DB_TRANSACTION_TIMEOUT_MS` | `5000` | 100 to 600000 | One transaction. When the budget is spent the connection is destroyed, so the server rolls back. |
| `DATA_DB_ACQUIRE_TIMEOUT_MS` | `1000` | 10 to 600000 | Waiting for a connection. |
| `DATA_MAX_BODY_BYTES` | `1048576` | 1024 to 16777216 | Request body. A record body is also limited to 256 KiB. |
| `DATA_MAX_IN_FLIGHT_REQUESTS` | `200` | 1 to 10000 | Concurrent requests in the process. The excess is refused with `503 OVERLOADED`. |
| `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT` | the value of `DATA_MAX_IN_FLIGHT_REQUESTS` | 1 to 10000 | Concurrent requests per tenant. The default gives one tenant the whole process, so a multi-tenant deployment sets each tenant's room. The excess is `429 TOO_MANY_REQUESTS`. |
| `DATA_DRAIN_MS` | `30000` | 1000 to 300000 | Drain budget at shutdown. |

None of these variables is required. A request's effective timeout is the smallest applicable budget. A local timer alone never cancels a statement: the statement and transaction timeouts do.

## Worker

| Variable | Default | Required | Allowed values | Meaning |
| --- | --- | --- | --- | --- |
| `DATA_WORKER_PRINCIPAL_ID` | none | worker | Access principal UUID | Principal the worker acts as. |
| `DATA_WORKER_ROUTE_ID` | none | worker | route id | Route the worker acts on, typically `data-worker`. |
| `DATA_WORKER_CONCURRENCY` | `4` | no | 1 to 64 | Concurrent deliveries. |

## Observability

| Variable | Default | Required | Allowed values | Meaning |
| --- | --- | --- | --- | --- |
| `DATA_METRICS_TOKEN_FILE` | absent | no | file | Bearer token guarding `/metrics`. Without it the endpoint answers `404`. |

The log level is `DATA_LOG_LEVEL` ([Process](#process)).

## Production checks

With `DATA_ENVIRONMENT=production`, startup also refuses:

1. a `DATA_DATABASE_URL` or `DATA_REGISTRY_DATABASE_URL` on a remote host without an `sslmode=` parameter (use `sslmode=require`); the hosts `127.0.0.1`, `localhost`, `::1` and `postgres` count as local,
2. a `DATA_ACCESS_URL` that does not start with `https://`,
3. a credential that the repository publishes: the file of the access context or the file of the cursor key that holds a value of `deploy/fixtures/secrets` is refused, and so is a password of a role that the repository publishes. The repository is public, and a deployment that mounts the fixtures holds a credential that everybody knows.

Role privileges, schema drift and the access context version are checked by readiness in every environment ([Operations](operations.md#probes)).

## Operator commands

Operator credentials never appear in the API's environment; each command reads only what it needs.

| Variable | Default | Command and meaning |
| --- | --- | --- |
| `DATA_ADMIN_DATABASE_URL` | none | `provision.ts`, `restore.sh`: the server administrator. |
| `DATA_DATABASE_NAME` | `data` | `provision.ts`: the database it creates. |
| `DATA_OWNER_PASSWORD`, `DATA_RUNTIME_PASSWORD`, `DATA_REGISTRY_PASSWORD`, `DATA_DELIVERY_PASSWORD`, `DATA_MAINTENANCE_PASSWORD` | none | `provision.ts`: role passwords. They are never printed. |
| `DATA_OWNER_DATABASE_URL` | none | `migrate.ts`, `workspace.ts`, `collection.ts`, `policy.ts`: the schema owner. Given to `restore.sh`, it returns ownership to that role. |
| `DATA_MIGRATIONS_DIR` | `./migrations` | `migrate.ts`: migrations directory. |
| `DATA_MAINTENANCE_DATABASE_URL` | none | `retention.ts`: the maintenance role. |
| `DATA_AUDIT_RETENTION_DAYS` | `90` | `retention.ts`: audit entries. |
| `DATA_VERSIONS_RETENTION_DAYS` | `90` | `retention.ts`: record version images. |
| `DATA_RECEIPT_RETENTION_HOURS` | `24` | `retention.ts`: creation receipts. |
| `DATA_EVENT_RETENTION_DAYS` | `7` | `retention.ts`: completed events and deliveries. |
| `DATA_RETENTION_ACTOR` | `operator` | `retention.ts`: the actor recorded for the run. |
| `DATA_DELIVERY_DATABASE_URL` | none | `delivery.ts`: delivery metadata. |
| `DATA_BACKUP_DATABASE_URL`, `DATA_BACKUP_DIR` | none | `backup.sh`. The backup role bypasses row-level security, so a backup holds every tenant's rows. |
| `DATA_BACKUP_FILE`, `DATA_RESTORE_DATABASE`, `DATA_RUNTIME_DATABASE_URL` | none | `restore.sh`: the dump to restore, the database to restore into, and the API role used to check isolation. |

The procedures that use them are in [Operations](operations.md).

## Bindings file

`DATA_GATEWAY_BINDINGS_FILE` is JSON of the form `{"version": 2, "bindings": [...]}`, with at most 100 bindings. The matching and verification rules are in [spec §4.1](spec.md#41-trusted-route-bindings).

```json
{
  "version": 2,
  "bindings": [
    {
      "id": "data-api",
      "host": "api.gateway.test",
      "upstreamPathPattern": "/ws/{workspaceId}/v1/*",
      "routeId": "data-api",
      "identity": {
        "version": "v5",
        "algorithm": "ES256",
        "publicKeyFile": "./secrets/identity.public.pem"
      }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Local route name, for diagnostics. |
| `host` | Exact public authority the gateway signs: lowercase ASCII, with the port if any. |
| `upstreamPathPattern` | Path Data receives, with exactly one `{workspaceId}` segment and a terminal `/*`. |
| `routeId` | Access route scope matching the gateway route. |
| `expectedTenantId` | Optional. Restricts the route to one tenant. |
| `identity.version` | `v5` (current) or `v4` (legacy). |
| `identity.algorithm` | `ES256` with a public key, `HS256` with the derived key. |
| `identity.publicKeyFile` | Gateway public key file, P-256, PEM. Because it is a public key, Data can verify identities but cannot mint them. |
| `identity.identityKeyFile` | Derived key file for the legacy format. |

A legacy route names its format explicitly, and `DATA_LEGACY_IDENTITY` must permit it:

```json
"identity": {
  "version": "v4",
  "algorithm": "HS256",
  "identityKeyFile": "./secrets/identity.key"
}
```

Moving a deployment off the legacy format is a procedure in [Operations](operations.md#leave-the-legacy-identity-format).

## Collection manifest

`DATA_SCHEMA_BUNDLE_FILE` is UTF-8 JSON, at most 1 MiB, validated against a strict schema that refuses unknown properties. How to design a collection is in [Modeling](modeling.md).

```json
{
  "version": 1,
  "schemaVersion": "articles-v1",
  "collections": [
    {
      "key": "articles",
      "table": "data.articles",
      "versions": { "table": "data.article_versions" },
      "label": "Articles",
      "fields": {
        "title": {
          "type": "string",
          "required": true,
          "nullable": false,
          "maxLength": 240
        }
      },
      "search": { "fields": ["title"], "config": "english" },
      "relations": {
        "category": {
          "target": "categories",
          "type": "many-to-one",
          "field": "category_id"
        }
      }
    }
  ]
}
```

| Part | Holds |
| --- | --- |
| `version` | Manifest format, `1`. |
| `schemaVersion` | The deployment's schema version. |
| `key` | Collection name used in paths. Matches `^[a-z][a-z0-9_]{0,62}$`. |
| `table` | Physical table as `schema.table`. The deployment controls it; a request never chooses it. |
| `versions.table` | Optional. The versions table of a collection that keeps a history ([spec §11.6](spec.md#116-record-version-history)). |
| `fields` | Types, nullability, defaults, bounds. Types: `string`, `text`, `boolean`, `integer`, `decimal`, `uuid`, `timestamp`, `json`, `enum`. Optional: `minLength`, `maxLength`, `minimum`, `maximum`, `enum`, `default`, `label`, `description`. |
| `search` | `fields` of the collection's text search, plus `config`, the database text-search configuration. |
| `relations` | Registered relations: `target`, `type` and `field`, with an optional `label`. Version 0.1 supports many-to-one references and derived one-to-many reads. |
| `label`, `description` | Semantic metadata. No studio presentation here. |
| Never | Executable scripts, widget identifiers, page layouts. |
| Added by the service | `id`, `tenant_id`, `workspace_id`, `created_by`, `created_at`, `updated_by`, `updated_at`, `version`. Clients never write them. |

## Policy bundle

`DATA_POLICY_BUNDLE_FILE` is UTF-8 JSON, at most 1 MiB, with at most 1000 policies. The same format is published per workspace with `bun run policy -- publish` ([Modeling](modeling.md#publish-a-workspace-bundle)).

```json
{
  "version": 1,
  "policies": [
    {
      "id": "edit-own-articles",
      "permission": "content.editor",
      "collection": "articles",
      "action": "update",
      "where": { "created_by": { "_eq": "$principalId" } },
      "check": { "created_by": { "_eq": "$principalId" } },
      "fields": ["title", "body"]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable policy name, recorded in the audit. |
| `permission` | Access permission key the policy applies to. |
| `collection` | Manifest collection. |
| `action` | `read`, `create`, `update` or `delete`. |
| `where` | Predicate selecting the rows the policy covers. |
| `check` | Predicate on the resulting row of a create or update. |
| `fields` | Fields the policy grants. |

Predicates use the [filter grammar](spec.md#93-query-parameters-and-filters) and may use `$principalId`, `$tenantId` and `$workspaceId`. How policies combine is in [spec §8](spec.md#8-data-authorization).
