# Operations

Running a data service deployment: probes, metrics, logs, drain, the image, workspace catalogs,
secret rotation, alarms, migrations and retention. Variables and their bounds are in
[Configuration](configuration.md).

## Probes

| Endpoint | Contract |
| --- | --- |
| `GET /healthz` | `200` while the process is alive. Calls no dependency. Carries the service version (`version`) and the deployment manifest version (`schemaVersion`). |
| `GET /readyz` | `200` only when configuration, schema, role privileges and access service discovery are in order; otherwise `503` with a safe reason. |
| `GET /metrics` | Service metrics. `404` when disabled, `401` when the bearer token is missing or wrong. |

Probes bypass workspace authorization: an operator's probe is not a tenant's caller.

API readiness checks that:

1. the connection role is not a superuser and lacks `BYPASSRLS`,
2. the applied migrations match the repository's, with the same checksums,
3. access service discovery spoke the access context contract version in the last ten seconds.

Worker readiness also checks the delivery store, and a worker is never ready without a registered
subscriber.

## Metrics

The endpoint serves the Prometheus text format. Labels are bounded: the route is a pattern, method
and status are short, and a tenant, principal, workspace, record ID, URL, email address or query
never becomes a label.

| Metric | Counts |
| --- | --- |
| `data_requests_total` | Requests, by route, method and status. |
| `data_request_duration_ms` | Request duration. |
| `data_access_requests_total`, `data_access_duration_ms` | Calls to the access service. |
| `data_context_cache_hits_total`, `data_context_cache_misses_total` | Context cache. |
| `data_db_pool_waits_total`, `data_db_acquire_duration_ms` | Waits for a connection. |
| `data_authorization_denials_total` | Authorization refusals. |
| `data_transaction_rollbacks_total` | Rolled-back transactions. |
| `data_outbox_backlog`, `data_outbox_oldest_age_seconds` | Unfinished deliveries, and the age of the oldest. |
| `data_delivery_failures_total`, `data_delivery_retries_total` | Failed and retried deliveries. |
| `data_draining` | `1` while the process drains. |
| `data_in_flight_requests` | Requests being handled. |
| `data_tenant_overload_total` | Requests refused because their tenant used its whole share. |

Access service calls carry three labels: method, contract path and outcome (`ok`, `refused` or
`failed`). Context cache hits and misses carry none: the cache is keyed by credential scope,
principal, tenant, workspace and route, and none of those may become a label.

Histogram buckets are cumulative: a bucket counts observations less than or equal to its bound.

The outbox backlog and oldest-delivery age measure outbox capacity; see [Backlog](#backlog).

## Logs

Logs are JSON objects on stdout. Every record carries level, time, message and the caller's fields.

Fields carrying a secret, credential, cookie, signature, body, filter or email address are redacted
before the record is written. Redaction works on field names, so renaming a field would leak it;
the service's callers never do.

Authorization refusals are logged with the error code but not the access service's reason. The
reason belongs to the operator, not the caller.

## Drain

On `SIGTERM` or `SIGINT` the process:

1. becomes unready and stops admitting requests; new requests answer `503 DRAINING`,
2. lets running requests finish within thirty seconds (`DATA_DRAIN_MS`),
3. stops the workers and releases leases on unfinished deliveries so another worker claims them,
4. closes the listener and the pools, exactly once.

A connection whose transaction was aborted, or whose state is unknown, is destroyed and never
returns to the pool. A mutation committed before the disconnect stays committed; the creation
receipt resolves an ambiguous `POST` result.

## Budgets

Request, access service, statement, transaction and connection-wait timeouts, the in-flight and
body limits, and the pool size are listed with their defaults and bounds in
[Configuration](configuration.md). A request's effective timeout is the tightest budget that applies.

## Image

Build the image from the workspace `Dockerfile` with the repository root as context:

```bash
docker build -f packages/data/Dockerfile --tag data:1.0.0 .
```

It contains the runtime, source, manifests, migrations and operator commands, and no secrets: the
database, access service and gateway signature credentials are files the deployment mounts and the
process reads at startup. It runs as a non-`root` user, and the base image is pinned by digest.

The deployment directory has a compose file for the local stack (database, separation roles,
migrations and service):

```bash
docker compose -f deploy/compose/data.compose.yaml up --build
```

It runs only the API. The worker claims event deliveries and needs a principal the access service
knows; the variables are in [Getting started](getting-started.md#local-stack). The gateway and access
service are platform services outside this compose file; the compatibility harness runs all three at
pinned revisions.

## Workspace catalog

A workspace's catalog is what it serves: its registered collections and the policy bundle that
applies to it. Change both with operator commands, using the schema owner's credentials:

```bash
# The collections a workspace serves.
DATA_OWNER_DATABASE_URL=... bun run collection -- register \
  --workspace 22222222-2222-4222-8222-222222222222 --collection articles
DATA_OWNER_DATABASE_URL=... bun run collection -- list \
  --workspace 22222222-2222-4222-8222-222222222222

# The bundle of policies of a workspace.
DATA_OWNER_DATABASE_URL=... bun run policy -- publish \
  --workspace 22222222-2222-4222-8222-222222222222 --file policies.json
DATA_OWNER_DATABASE_URL=... bun run policy -- list \
  --workspace 22222222-2222-4222-8222-222222222222
```

The commands never create or alter a table; collection tables come from the deployment's reviewed
migrations. Registering a collection and publishing a bundle are local administrative entry points,
not HTTP routes that bypass the access service: a bundle says what a permission grants, and a
principal's grants belong to the access service.

A bundle is validated against the deployment manifest before publication and parsed again when
resolved. An unusable bundle never applies, and the service fails closed. Publications are kept: a
version is never changed or removed.

The catalog rule is [Specification](spec.md) §7.5. Other operator commands are in
[Development](development.md) and under [Retention](#retention).

## Rotating secrets

| Secret | Location | Rotation |
| --- | --- | --- |
| Gateway identity public key | Binding file (`publicKeyFile`) | Coordinated: the gateway signs with the pair's private key, the backend verifies with the public one. The backend holds one key per binding, so rotation is a configuration change and a restart. The gateway generates the pair with `bun run identity:key`; the private key never reaches the backend. |
| Gateway derived identity key (legacy) | Binding file (`identityKeyFile`) | Migration path for deployments that still share a key with their gateway. It can sign, and only a route naming version `v4` reads it. A deployment leaving legacy mode deletes it from its secret store. |
| Access context credential | `DATA_ACCESS_CONTEXT_TOKEN_FILE` | Change it at the access service first, then at the backend. The backend answers `503 AUTHORIZATION_UNAVAILABLE` while they disagree. |
| Cursor key | `DATA_CURSOR_KEY_FILE` | Changing it invalidates live cursors: clients get `400 INVALID_CURSOR` and start over. |
| Role passwords | Secret manager | `scripts/cli/provision.ts` changes them. The pools reconnect. |

## Alarms

| Signal | Meaning | Action |
| --- | --- | --- |
| `data_outbox_oldest_age_seconds` grows | A subscriber doesn't keep up. | Add workers, or find the failing subscriber via `data_delivery_failures_total`. |
| `data_delivery_failures_total` grows | A handler fails, or a subscriber is missing after a deployment. | `bun run scripts/cli/delivery.ts list`, then requeue with operator attribution. |
| `data_authorization_denials_total` grows | A client asks for what it may not have, or a grant was revoked. | The error code and route identify the client. |
| `data_db_pool_waits_total` grows | The pool is too small, or the database is slow. | Check the pool, the statement timeout and the collection's indexes. |
| `/readyz` answers 503 | A dependency is not in order. | The response reason names the dependency. |

For error-by-error fixes, see [Troubleshooting](troubleshooting.md).

## Migrations and drift

### Commands

```bash
# The roles and the database. Once per deployment, with an administrator.
DATA_ADMIN_DATABASE_URL=... bun run scripts/cli/provision.ts

# The schema. With the owner of the schema.
DATA_OWNER_DATABASE_URL=... bun run migrate
```

`migrate` takes an exclusive advisory lock, so two deployments never apply a migration at the same
time. The migration ledger records each applied migration's ID and checksum. Migrations live in
`./migrations`; set `DATA_MIGRATIONS_DIR` to change it.

### Migration order

| Migration | Contents |
| --- | --- |
| `0002_platform.sql` | Backend schema: ledger, workspace registry, audit log, events, deliveries, receipts. |
| `0003_collections.sql` | Example deployment collections: categories, articles, article statistics. |
| `0004_isolation.sql` | Row-level security, composite relations, role privileges. |
| `0005_operator_policies.sql` | Policies for the schema owner and the maintenance role. |
| `0006_catalog.sql` | Workspace catalog: collection registry and published-bundle history. |
| `0007_search.sql` | Text search index for collections. |
| `0008_record_versions.sql` | Record version history: the example deployment's image table, its isolation and privileges. |
| `0009_workspace_names.sql` | Workspace names: the registry reader's privilege on a workspace's slug and name. |

Never change an applied migration. The file's checksum is compared with the ledger, and a mismatch
is drift that fails readiness. To change a migration, write a new one.

### Drift

At startup and on every readiness probe, the process compares the deployment manifest with the
deployed schema and reports:

- a manifest column that is missing,
- a column of a different type,
- a collection table that doesn't force row-level security,
- a backend table that doesn't force it.

The service never creates or alters a table while running (see
[Architecture](architecture.md)). Fix drift with a migration and a new manifest release.

### Bundles

Manifests and policies are deployment artifacts, immutable per process generation. Their version is
a digest of their content: identical content means an identical version, and any change gives a new
one.

Changing bundles is a release: new replicas read the new bundles, old replicas keep the old ones. A
schema change that isn't backward compatible requires draining the old replicas first.

### Roles

| Role | Allowed to |
| --- | --- |
| `data_owner` | Own schemas and tables, apply migrations, write the workspace registry, run backup and restore. |
| `data_runtime` | Read and write business data in its transaction's scope, append to the audit log, write events and receipts. It may not alter the schema, read deliveries or change history. |
| `data_registry` | Select `id`, `tenant_id` and `status` from the registry. Nothing else. |
| `data_delivery` | Claim and finish deliveries for every workspace. It may not read a business record. |
| `data_maintenance` | Delete history that retention has reached. It may not write a business record. |

The API never uses the owner, registry reader, delivery or maintenance roles, and operator command
credentials are not in the API's environment.

`scripts/cli/provision.ts` creates the roles, taking passwords from the environment and never
printing them.

## Retention

| Data | Default | Rule |
| --- | --- | --- |
| Business records | — | Owned by the application. No automatic purge. |
| Record version images | 90 days | `DATA_VERSIONS_RETENTION_DAYS`. Expired images are removed in bounded batches, from the tables the manifest declares. |
| Audit log | 90 days | `DATA_AUDIT_RETENTION_DAYS`. Entries are removed in bounded batches. |
| Creation receipts | 24 hours | `DATA_RECEIPT_RETENTION_HOURS`. A key reused after that is a new operation. |
| Completed events and their deliveries | 7 days | `DATA_EVENT_RETENTION_DAYS`. Unfinished subscriber deliveries are never removed. |
| Pending and failed deliveries | — | Never removed automatically. An operator resolves them. |

### Retention command

```bash
DATA_MAINTENANCE_DATABASE_URL=... DATA_RETENTION_ACTOR=operator \
  bun run scripts/cli/retention.ts
```

The command runs as the maintenance role, in batches of a thousand rows, and is idempotent. It never
touches a business record: no generic collection endpoint purges platform history, and the API
cannot edit the audit log.

The same command purges record version images. It reads the deployment manifest from
`DATA_SCHEMA_BUNDLE_FILE` to find the declared tables and purges images past the version retention.
A record's current version is never purged: it is the collection row itself, not an image.

After removing completed deliveries, it removes events that have no deliveries left. An event with a
pending or failed delivery stays.

### Attribution

The command writes the operator name from `DATA_RETENTION_ACTOR` to the run's log. Retention doesn't
touch the audit log of business mutations; audit log retention removes the entries themselves.

### Backlog

Completed outbox metadata is kept for seven days, so a backlog older than that means the deployment
needs more workers or a subscriber needs fixing. Watch `data_outbox_backlog` and
`data_outbox_oldest_age_seconds`.

A capacity limit refuses new work before a transaction commits an event that can't be kept. The
operator sets the deployment's backlog limit as a multiple of a day's event traffic.

### Failed subscriber deliveries

Retention doesn't remove a failed delivery. The operator resolves it; a requeue is an explicit,
attributed command:

```bash
DATA_DELIVERY_DATABASE_URL=... bun run scripts/cli/delivery.ts list
DATA_DELIVERY_DATABASE_URL=... bun run scripts/cli/delivery.ts requeue \
  --event <uuid> --subscriber <id> --actor <name>
```

A requeue doesn't bypass business authorization: the subscriber's handler asks the access service
again before doing anything.

### Removing a workspace

Moving a workspace between tenants is not supported. Remove a workspace explicitly:

1. Disable it (`bun run scripts/cli/workspace.ts disable --id <uuid>`): the API answers `404` for it
   and no request reaches its data.
2. Stop the workspace's deliveries and resolve pending ones.
3. Satisfy the deployment's retention and export requirements.
4. Remove the rows in bounded operations, as the schema owner.
