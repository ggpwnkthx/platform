# Configuration

Environment variables and deployment files of Data: process variables, the gateway
bindings file, the collection manifest and the policy bundle.

The service reads the environment once at startup and validates it as a whole: it reports every
problem together, and any value it cannot understand stops it. Rules: [spec §14](spec.md#14-configuration).

> [!IMPORTANT]
> A secret is always a file, never an environment value: process lists are visible and logs are not
> private.

## Process

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_HOST` | `127.0.0.1` | Listener bind address. In production, bind an explicitly protected service interface. |
| `DATA_PORT` | `8082` | Listener port. |
| `DATA_PROCESS_ROLE` | `all` | `api`, `worker` or `all`. |
| `DATA_ENVIRONMENT` | `development` | `production` enables the transport and secret checks. |
| `DATA_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

## Database

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_DATABASE_URL` | required | Scoped data role: rows in the transaction's scope, nothing else. |
| `DATA_REGISTRY_DATABASE_URL` | required | Narrow reader of the workspace registry. |
| `DATA_DELIVERY_DATABASE_URL` | the data URL | Delivery metadata. Required when workers run. |

- In production, a remote database URL must request a protected transport (`sslmode=require`).
- Pools are bounded: `DATA_DB_POOL_MAX` data-role connections per process, five each for the registry
  and delivery pools.

## Deployment artifacts

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_GATEWAY_BINDINGS_FILE` | required for `api` | Accepted routes and how their identities are verified. See [Bindings file](#bindings-file). |
| `DATA_LEGACY_IDENTITY` | `refuse` | Legacy identity format: `refuse`, `warn` or `allow`. The format is symmetric: the backend holds the gateway's derived secret and could sign an identity with it. `1.0.0` refuses it; `2.0.0` removes it. |
| `DATA_SCHEMA_BUNDLE_FILE` | required | Collection manifests. See [Collection manifest](#collection-manifest). |
| `DATA_POLICY_BUNDLE_FILE` | required | Policy bundle. See [Policy bundle](#policy-bundle). |
| `DATA_CURSOR_KEY_FILE` | required | Key that signs page cursors. At least 32 bytes; not a gateway key. |

Manifests and policies are immutable for the life of a process; their version is their content digest.

## Access

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_ACCESS_URL` | required | Access base URL. `https` in production: the context credential travels with it. |
| `DATA_ACCESS_CONTEXT_TOKEN_FILE` | required | Service credential for the access context contract. |
| `DATA_CONTEXT_CACHE_TTL_MS` | `0` | Read-only context cache lifetime, 0 to 5000. Default: no cache. Mutations and worker commands always fetch a fresh context. |
| `DATA_CONTEXT_CACHE_MAX_ENTRIES` | `4096` | Context cache size. When full, the least recently used entry is evicted; expired entries are dropped on write. |
| `DATA_ACCESS_TIMEOUT_MS` | `1000` | Bound on one call to Access. |

## Budgets

| Variable | Default | Bounds |
| --- | --- | --- |
| `DATA_REQUEST_TIMEOUT_MS` | `10000` | All work for a request. |
| `DATA_DB_STATEMENT_TIMEOUT_MS` | `3000` | One statement; the server cancels it. |
| `DATA_DB_TRANSACTION_TIMEOUT_MS` | `5000` | One transaction; the connection is destroyed when the budget is spent, so the server rolls back. |
| `DATA_DB_ACQUIRE_TIMEOUT_MS` | `1000` | Waiting for a connection. |
| `DATA_MAX_BODY_BYTES` | `1048576` | Request body. A record body is limited to 256 KiB. |
| `DATA_MAX_IN_FLIGHT_REQUESTS` | `200` | Concurrent requests. Excess is refused with `503 OVERLOADED`, not queued. |
| `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT` | value of `DATA_MAX_IN_FLIGHT_REQUESTS` | Concurrent requests per tenant. The default gives one tenant the whole process; a multi-tenant deployment sets each tenant's room. Excess is `429 TOO_MANY_REQUESTS`. |
| `DATA_DRAIN_MS` | `30000` | Drain budget. |
| `DATA_DB_POOL_MAX` | `20` | Data-role connections per process. |

A request's effective timeout is the smallest applicable budget. A local timer alone never cancels a
statement; the statement and transaction timeouts do.

## Worker

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_WORKER_PRINCIPAL_ID` | required when workers run | Principal the worker acts as. |
| `DATA_WORKER_ROUTE_ID` | required when workers run | Route the worker acts on, typically `data-worker`. |
| `DATA_WORKER_CONCURRENCY` | `4` | Concurrent deliveries. |

## Observability

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_METRICS_TOKEN_FILE` | absent | Token guarding the metrics endpoint. Without it, the endpoint answers `404`. |

The log level is `DATA_LOG_LEVEL` ([Process](#process)).

## Operator commands

Operator credentials are never in the API's environment; each command reads only what it needs.

| Variable | Command |
| --- | --- |
| `DATA_ADMIN_DATABASE_URL` | `provision.ts`, `restore.sh`: the server administrator. |
| `DATA_OWNER_DATABASE_URL` | `migrate.ts`, `workspace.ts`, `collection.ts`, `policy.ts`: the schema owner. |
| `DATA_MAINTENANCE_DATABASE_URL` | `retention.ts`: the maintenance role. |
| `DATA_DELIVERY_DATABASE_URL` | `delivery.ts`: delivery metadata. |
| `DATA_BACKUP_DATABASE_URL`, `DATA_BACKUP_DIR` | `backup.sh`. The backup role bypasses row-level security: a backup holds every tenant's rows. |
| `DATA_BACKUP_FILE`, `DATA_RESTORE_DATABASE`, `DATA_RUNTIME_DATABASE_URL` | `restore.sh`. |
| `DATA_AUDIT_RETENTION_DAYS`, `DATA_RECEIPT_RETENTION_HOURS`, `DATA_EVENT_RETENTION_DAYS`, `DATA_VERSIONS_RETENTION_DAYS`, `DATA_RETENTION_ACTOR` | `retention.ts`. |
| `DATA_MIGRATIONS_DIR` | `migrate.ts`: migrations directory, default `./migrations`. |
| `DATA_OWNER_PASSWORD`, `DATA_RUNTIME_PASSWORD`, `DATA_REGISTRY_PASSWORD`, `DATA_DELIVERY_PASSWORD`, `DATA_MAINTENANCE_PASSWORD` | `provision.ts`: role passwords. Never printed. |

## Bindings file

Shape: `{"version": 2, "bindings": [...]}`, at most 100 bindings.

| Field | Meaning |
| --- | --- |
| `id` | Local route name, for diagnostics. |
| `host` | Exact public authority the gateway signs: lowercase ASCII, with the port if any. |
| `upstreamPathPattern` | Path the backend receives, with exactly one `{workspaceId}` segment and a terminal `/*`. |
| `routeId` | Access route scope matching the gateway route. |
| `expectedTenantId` | Optional. Restricts the route to one tenant. |
| `identity.version` | `v5` (current) or `v4` (legacy). |
| `identity.algorithm` | `ES256` with a public key, `HS256` with the derived key. |
| `identity.publicKeyFile` | Gateway public key file, P-256, PEM. |
| `identity.identityKeyFile` | Derived key file for the legacy format. |

- Version, algorithm and key file must agree; a mismatched algorithm or key file kind is refused.
- A `v5` route refuses `v4`, and a legacy route never accepts a public key as its secret. Nothing
  falls back after a failed verification.
- Bindings must be unambiguous over signed host, received path and verifying key; ambiguity stops
  startup.

## Collection manifest

`DATA_SCHEMA_BUNDLE_FILE` is UTF-8 JSON, at most 1 MiB, validated against a strict schema that refuses
unknown properties.

```json
{
  "version": 1,
  "schemaVersion": "articles-v1",
  "collections": [
    {
      "key": "articles",
      "table": "data.articles",
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
| `key` | Collection name used in paths. Matches `^[a-z][a-z0-9_]{0,62}$`. |
| `table` | Physical table as `schema.table`. Deployment-controlled; a request never chooses it. |
| `fields` | Types, nullability, defaults, bounds. Types: `string`, `text`, `boolean`, `integer`, `decimal`, `uuid`, `timestamp`, `json`, `enum`. Optional: `minLength`, `maxLength`, `minimum`, `maximum`, `enum`, `default`, `label`, `description`. |
| `search.fields` | Fields of the collection's text search, plus the database text-search configuration. |
| `relations` | Registered relations. Version 0.1 supports many-to-one references and derived one-to-many reads. |
| `label`, `description` | Semantic metadata. No studio presentation here. |
| Never | Executable scripts, widget identifiers, page layouts. |
| Added by the service | `id`, `tenant_id`, `workspace_id`, `created_by`, `created_at`, `updated_by`, `updated_at`, `version`. Clients never write them. |

## Policy bundle

`DATA_POLICY_BUNDLE_FILE` is UTF-8 JSON, at most 1 MiB, with at most 1000 policies.

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

Predicates may use `$principalId`, `$tenantId` and `$workspaceId`. Policy rules:
[spec §8](spec.md#8-data-authorization).
