# Operations

Run a Data deployment day to day. Platform-wide steps (first deployment, images, rollback)
are in [Platform operations](../platform/operations.md); variables are in
[Configuration](configuration.md).

## Process roles

One image, three roles, chosen with `DATA_PROCESS_ROLE`:

| Role | Runs | Needs |
| --- | --- | --- |
| `api` | Endpoints and probes. | Gateway bindings, cursor key. |
| `worker` | Delivery claims. | Delivery credentials, a service principal Access knows. |
| `all` | Both (local default). | Both sets. |

```bash
docker build -f packages/data/Dockerfile --tag data:1.0.0 .   # from the repository root
```

The image runs as non-`root`, pins its base by digest and holds no secrets; mount the credential
files. For a worker locally, see [Getting started](getting-started.md#run-with-a-worker).

## Probes

| Endpoint | Answers |
| --- | --- |
| `GET /healthz` | `200` while alive, with `version` and the manifest's `schemaVersion`. Calls no dependency. |
| `GET /readyz` | `200` when configuration, schema, role privileges and Access discovery pass; else `503` with a reason. |
| `GET /metrics` | Prometheus text. `404` when disabled, `401` without the right bearer token. |

API readiness requires a role that is neither superuser nor `BYPASSRLS`, migrations matching the
repository's checksums, and an access context discovery within ten seconds. A worker also needs the
delivery store and a registered subscriber. Probes skip workspace authorization. See
[spec §15.1](spec.md#151-probes-and-metrics).

## Metrics

| Metric | Counts |
| --- | --- |
| `data_requests_total`, `data_request_duration_ms` | Requests by route, method, status. |
| `data_access_requests_total`, `data_access_duration_ms` | Access calls by method, contract path, outcome (`ok`, `refused`, `failed`). |
| `data_context_cache_hits_total`, `data_context_cache_misses_total` | Context cache (unlabelled). |
| `data_db_pool_waits_total`, `data_db_acquire_duration_ms` | Connection waits. |
| `data_authorization_denials_total`, `data_transaction_rollbacks_total` | Refusals, rollbacks. |
| `data_outbox_backlog`, `data_outbox_oldest_age_seconds` | Unfinished deliveries, oldest age. |
| `data_delivery_failures_total`, `data_delivery_retries_total` | Failed, retried deliveries. |
| `data_draining`, `data_in_flight_requests` | `1` while draining; requests in progress. |
| `data_tenant_overload_total` | Tenant-share refusals. |

No label carries a tenant, principal, workspace, record ID, URL, email or query. Buckets are
cumulative.

## Logs

JSON on stdout. Redaction matches field names (secret, credential, cookie, signature, body, filter,
email), so never rename such a field. Refusals log the error code, not Access's reason.
See [spec §15.2](spec.md#152-logs).

## Drain

On `SIGTERM` or `SIGINT` the process:

1. turns unready; new requests get `503 DRAINING`,
2. lets running requests finish within `DATA_DRAIN_MS` (30 s),
3. stops workers and releases leases on unfinished deliveries,
4. closes the listener and pools once.

Connections in an aborted or unknown state are destroyed; committed mutations stay. See
[spec §15.3](spec.md#153-shutdown-and-cancellation).

## Workspace catalog

A workspace serves its registered collections under its policy bundle. As the schema owner:

```bash
export DATA_OWNER_DATABASE_URL=...
WS=22222222-2222-4222-8222-222222222222
bun run collection -- register --workspace $WS --collection articles
bun run collection -- list --workspace $WS
bun run policy -- publish --workspace $WS --file policies.json
bun run policy -- list --workspace $WS
```

These commands never alter tables. A bundle says what a permission grants; Access says
who holds it. An unusable bundle fails closed, and published versions are immutable. See
[spec §7.5](spec.md#75-workspace-catalog).

## Migrations and drift

```bash
# Once per deployment, as the server administrator: roles and database.
DATA_ADMIN_DATABASE_URL=... bun run scripts/cli/provision.ts

# Schema, as the schema owner.
DATA_OWNER_DATABASE_URL=... bun run migrate
```

`provision.ts` reads role passwords from the environment, never printing them. `migrate` takes an
advisory lock, applies `packages/data/migrations` (or `DATA_MIGRATIONS_DIR`) in order and records
each checksum in the ledger.

> [!WARNING]
> Never edit an applied migration. A checksum that differs from the ledger is drift and fails
> readiness. Write a new migration.

Readiness also reports drift from the manifest: a missing column, a different type, or a table not
forcing row-level security. Fix it with a migration and a new manifest.

Manifests and policies are fixed per process and versioned by content digest, so a new bundle is a
release. Drain old replicas first if a schema change breaks compatibility.

| Role | May |
| --- | --- |
| `data_owner` | Own schemas and tables, migrate, write the registry, back up and restore. |
| `data_runtime` | Scoped business data, audit appends, events, receipts. No DDL, deliveries or history edits. |
| `data_registry` | Select `id`, `tenant_id`, `status`, `slug`, `display_name` from the registry. |
| `data_delivery` | Claim and finish deliveries in every workspace. No business records. |
| `data_maintenance` | Delete history past retention. No business writes. |

The API uses only `data_runtime`; operator credentials never enter its environment.

## Retention

| Data | Kept | Notes |
| --- | --- | --- |
| Business records | forever | Owned by the application. |
| Record version images | 90 days | Current version is the row itself, never purged. |
| Audit log | 90 days | |
| Creation receipts | 24 hours | A later reuse of the key is a new operation. |
| Completed events and deliveries | 7 days | An event goes once no delivery is left. |
| Pending and failed deliveries | until resolved | An operator resolves them. |

Change the periods with the variables in [Configuration](configuration.md#operator-commands), then
run as the maintenance role:

```bash
DATA_MAINTENANCE_DATABASE_URL=... DATA_RETENTION_ACTOR=operator \
  bun run scripts/cli/retention.ts
```

It is idempotent, deletes in batches of 1,000, reads version tables from `DATA_SCHEMA_BUNDLE_FILE`,
logs the actor, and spares business records. See
[spec §15.4](spec.md#154-retention-backup-and-removal).

### Failed deliveries

```bash
DATA_DELIVERY_DATABASE_URL=... bun run scripts/cli/delivery.ts list
DATA_DELIVERY_DATABASE_URL=... bun run scripts/cli/delivery.ts requeue \
  --event <uuid> --subscriber <id> --actor <name>
```

A requeue is attributed; the handler still asks Access before acting.

### Removing a workspace

Workspaces never move between tenants. To remove one:

1. Disable it: `bun run scripts/cli/workspace.ts disable --id <uuid>` (the API then answers `404`).
2. Stop its deliveries and resolve pending ones.
3. Meet retention and export obligations.
4. Delete its rows in bounded operations, as the schema owner.

## Backup and restore

Backups hold business records, the registry, audit, events, deliveries, receipts and migration
history. Keep manifests and policies beside the dump; secrets stay in the secret manager.

```bash
DATA_BACKUP_DATABASE_URL=... DATA_BACKUP_DIR=/var/backups/data ./scripts/ops/backup.sh
```

It writes a consistent-snapshot `pg_dump` custom-format dump and a digest file.

> [!IMPORTANT]
> Row-level security is forced, even for owners. Back up as the server administrator or a
> `BYPASSRLS` role; the command refuses any role the policies apply to.

To restore:

1. Stop the API and workers.
2. Run `restore.sh` as the server administrator:
   `DATA_ADMIN_DATABASE_URL=... DATA_RUNTIME_DATABASE_URL=... DATA_BACKUP_FILE=/var/backups/data/data-....dump DATA_RESTORE_DATABASE=data_restore ./scripts/ops/restore.sh`
3. Check the restored ledger's checksums against the release's migrations.
4. Start the API and workers; workers reclaim pending deliveries, and handlers are idempotent.

Given the owner's URL, restore returns ownership to it. Both scripts refuse a client older than the
server (PostgreSQL 15 or later).

Data-changing migrations roll forward, never back. Destructive ones need a reviewed plan and a
tested restore.

### Rehearsal

Rehearse before production and record it in the release notes. `restore.sh` into its own database
checks tenant isolation (as the API role) and that pending deliveries survive.
`bash scripts/ops/rehearse-backup.sh` does a full run on a throwaway server.

| Run | PostgreSQL | Result |
| --- | --- | --- |
| Release 0.1, 2026-10-21 | 15.19 | Passed (0 rows visible unscoped, 0 deliveries). |
| 1.0 candidate, 2026-10-22 | 15.19 | Found a defect: as owner, `pg_dump` couldn't read forced-RLS rows. Fixed: backup refuses such roles; restore returns ownership. |
| 1.0 candidate, 2026-10-23 | 18.6 | Passed, version images included, with matching client tools. |

## Rotating secrets

| Secret | Where | How |
| --- | --- | --- |
| Gateway public key | Binding `publicKeyFile` | The gateway makes the pair (`bun run identity:key`) and keeps the private half. Update the binding; restart. |
| Legacy derived key | Binding `identityKeyFile` | Read only by `v4` routes; it can sign. Delete it when leaving legacy mode. |
| Access context credential | `DATA_ACCESS_CONTEXT_TOKEN_FILE` | Access first; until both match, `503 AUTHORIZATION_UNAVAILABLE`. |
| Cursor key | `DATA_CURSOR_KEY_FILE` | Live cursors fail with `400 INVALID_CURSOR`. |
| Role passwords | Secret manager | Rerun `scripts/cli/provision.ts`; pools reconnect. |

## Alarms

| Signal | Cause | Action |
| --- | --- | --- |
| `data_outbox_oldest_age_seconds` rising | Subscriber behind; completed outbox data lives 7 days. | Add workers or fix the subscriber. The backlog limit (a multiple of a day's events) refuses new work before an event commits. |
| `data_delivery_failures_total` rising | Handler failing, or subscriber missing after a deploy. | `delivery.ts list`, then requeue. |
| `data_authorization_denials_total` rising | Client exceeds its grants, or a grant was revoked. | Error code and route identify the client. |
| `data_db_pool_waits_total` rising | Pool too small or database slow. | Check pool size, statement timeout, indexes. |
| `/readyz` is `503` | A dependency failed. | Read the reason. |

Per-error fixes: [Troubleshooting](troubleshooting.md).
