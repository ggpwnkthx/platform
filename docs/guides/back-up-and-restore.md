# Back up and restore

This guide backs up the two PostgreSQL databases that hold the platform's lasting state, Access's tables and Data's business data, restores either one into a fresh database, and explains what the gateway's shared state means when you restore. It is for the database owner ([dba](../roles/dba.md)) and the operators who schedule and rehearse the jobs ([sysops](../roles/sysops.md)).

## Before you start

| You need | Why | Reference |
| --- | --- | --- |
| PostgreSQL client tools no older than the server | Data's scripts refuse an older `pg_dump` or `pg_restore`, and need PostgreSQL 15 or later | [Data backup and restore](../data/operations.md#backup-and-restore) |
| Access's connection URL (`ACCESS_DATABASE_URL`) | Access is dumped with its own owner role | [Access backup and restore](../access/operations.md#backup-and-restore) |
| A server administrator or `BYPASSRLS` role for Data | Data forces row-level security even on table owners, so the backup refuses any role the policies bind | [Data operator commands](../data/configuration.md#operator-commands) |
| Storage outside the pods | A dump on the pod's disk dies with the pod | [Access backup and restore](../access/operations.md#backup-and-restore) |
| Access to the secret manager | Secrets are never in a dump, and some dump contents are unreadable without them | [Platform security: secrets](../platform/security.md#secrets) |

Know what is worth backing up before you schedule anything:

| State | Lives in | Back it up? |
| --- | --- | --- |
| Access tenants, principals, groups, roles, grants, permissions and audit | Access's eight PostgreSQL tables | Yes: they are Access's only data. |
| Access login state, authorization codes, issued tokens | The login cookie, Redis for sixty seconds, and signatures | No. |
| Data records, workspace registry, audit, events, deliveries, receipts, version images, migration history | Data's PostgreSQL database | Yes. |
| Data manifests and policy bundles | Deployment files | Yes, stored beside each dump. |
| Gateway sessions, rate-limit windows, cached decisions, heartbeats | Redis or PostgreSQL shared state | The gateway pages describe no backup; see step 6. |
| Gateway route-table revisions, history and control-plane audit (store mode) | The same shared state | No procedure documented; see step 6. |
| Console sessions | Console process memory | No: a restart signs everyone out anyway. |
| Every secret and key | Your secret manager | Through the secret manager, never in a dump. |

## Steps

### 1. Back up Access

Dump the database in PostgreSQL's custom format, without owners or privileges, and copy the file off the pod:

```bash
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --file "access-$(date -u +%Y%m%dT%H%M%SZ).dump" "$ACCESS_DATABASE_URL"
```

Access targets a recovery point of 24 hours and a recovery time of 2 hours, so run the dump at least daily and keep the restore path short. The platform's own alert list includes the age of the last dump ([Access monitoring](../access/operations.md#monitoring)).

Record which `ACCESS_SECRET_ENCRYPTION_KEY` was current when each dump was taken. Tenants' client secrets are stored encrypted with that key, and `rotate-secrets.ts` re-encrypts them only in the live database, so restoring a dump taken before a rotation needs the key that encrypted it ([Access token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems)).

### 2. Back up Data

Run the bundled script with a role that bypasses row-level security:

```bash
DATA_BACKUP_DATABASE_URL=postgres://admin:…@postgres:5432/data \
DATA_BACKUP_DIR=/var/backups/data \
  ./scripts/ops/backup.sh
```

It writes a `pg_dump` custom-format dump taken from one consistent snapshot, plus a digest file. Because the backup role sees every tenant's rows, treat the dump as holding all tenants' data. Copy the release's manifests and policy bundles (`DATA_SCHEMA_BUNDLE_FILE`, `DATA_POLICY_BUNDLE_FILE`) next to it; the secrets stay in the secret manager.

Data documents no recovery targets of its own; set them with the deployment and record them next to Access's.

### 3. Keep retention and backups in step

Data deletes history on a schedule you run, so a dump holds only what retention has kept. Version images and the audit log stay 90 days, creation receipts 24 hours, completed events and deliveries 7 days; business records and unresolved deliveries are never purged ([Data retention](../data/operations.md#retention)). Run the purge as the maintenance role:

```bash
DATA_MAINTENANCE_DATABASE_URL=postgres://data_maintenance:…@postgres:5432/data \
DATA_RETENTION_ACTOR=operator \
  bun run --cwd packages/data retention
```

The periods change through `DATA_AUDIT_RETENTION_DAYS`, `DATA_VERSIONS_RETENTION_DAYS`, `DATA_RECEIPT_RETENTION_HOURS` and `DATA_EVENT_RETENTION_DAYS` ([operator commands](../data/configuration.md#operator-commands)). Access documents no purge for its tables. Neither service says how long to keep the dumps themselves; decide that with your retention and export obligations ([Data spec §15.4](../data/spec.md#154-retention-backup-and-removal)).

### 4. Restore Access

Restore into a new database owned by the Access role, then check it before switching:

```bash
createdb --owner=access_app access_restore
pg_restore --dbname=access_restore --no-owner --no-privileges \
  --exit-on-error access-20260108T100000Z.dump
```

An older dump comes back with its own schema version; when the current release starts on it, its runner applies the missing migrations, which `access_schema_migrations` tracks. The Access pages do not describe the switch itself: point `ACCESS_DATABASE_URL` at the restored database and roll the replicas, gated on `/readyz`. Nothing else needs restoring: a login's state rides in the browser cookie, a code lasts sixty seconds in Redis, and tokens are signatures.

### 5. Restore Data

Stop the API and workers first, then restore as the server administrator into its own database:

```bash
DATA_ADMIN_DATABASE_URL=... \
DATA_RUNTIME_DATABASE_URL=... \
DATA_OWNER_DATABASE_URL=... \
DATA_BACKUP_FILE=/var/backups/data/data-….dump \
DATA_RESTORE_DATABASE=data_restore \
  ./scripts/ops/restore.sh
```

With `DATA_OWNER_DATABASE_URL` set, the restore hands ownership back to the schema owner, and it checks tenant isolation as the API role. Compare the restored ledger's checksums with the release's migrations, then start the API and workers on the restored database. Workers reclaim pending deliveries, and handlers are idempotent, so a delivery that ran before the backup may run again safely.

The Data pages leave the cut-over to you as well: point `DATA_DATABASE_URL`, `DATA_REGISTRY_DATABASE_URL` and `DATA_DELIVERY_DATABASE_URL` at the restored database before you start the processes.

Data's workspaces carry Access tenant UUIDs, and Data asks Access for every principal's context. Neither service documents a joint restore; when you restore both, use dumps taken close together and check that each workspace's tenant still exists in Access.

### 6. Account for the gateway's shared state

The gateway is stateless, but its shared state caches facts that come from Access. After you restore Access, a cached decision can still allow or deny for up to `GATEWAY_ACCESS_CACHE_TTL_MS` (5 s by default), or longer on a route with an outage grace. Purge what matters with an `operate` token:

```bash
platformctl sessions purge-decisions --subject <sub>
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$CONTROL/v1/decisions?workspace=<id>"
```

Gateway sessions are independent of Access's database, so they survive an Access restore. If a restored Access no longer knows a principal, end its sessions as in [revoking sessions](../gateway/operations.md#revoking-sessions).

If the shared state itself is lost, the gateway pages give no restore procedure, and the PostgreSQL backend does not even wait for the disk by default ([gateway spec §12.5](../gateway/spec.md#125-shared-state)). Expect these effects and plan for them:

| Lost | Effect | Recovery |
| --- | --- | --- |
| Sessions | Callers sign in again | Nothing to restore |
| Rate-limit windows and cached decisions | Budgets restart; decisions are asked again | Nothing to restore |
| Route table in store mode | An empty store falls back to the `GATEWAY_CONFIG` file | Keep that file current, then republish with `platformctl routes apply` |
| Revision history and control-plane audit | Gone | Not documented; export `GET /v1/config/history` and `GET /v1/audit` if you need them kept |
| PostgreSQL schema and roles | The gateway stays unready | Rerun `postgres:migrate`, with `--roles` for the users ([gateway shared state](../gateway/operations.md#shared-state)) |
| Redis ACL passwords | Users cannot authenticate | Set them again with `ACL SETUSER`, as on every start ([gateway roles](../gateway/operations.md#roles)) |

### 7. Rehearse

A backup counts once a restore from it has worked. Rehearse Access every quarter and before you change the backup process, outside production ([Access backup and restore](../access/operations.md#backup-and-restore)). Rehearse Data before production and record the run in the release notes; `bash scripts/ops/rehearse-backup.sh` performs a full backup and restore on a throwaway server ([rehearse backup and restore](../data/operations.md#rehearse-backup-and-restore)). Measure how long each restore takes, and compare it with the 2-hour recovery time Access targets.

## Check that it worked

For an Access restore, all three must hold:

1. `pg_restore` reported no error.
2. The tables and the `grants` indexes exist:

   ```sql
   select indexname from pg_indexes where tablename = 'grants';
   ```

3. The current release starts on the restored database with `ACCESS_ENVIRONMENT=development` and applies no migration.

Then run `ACCESS_URL=… ACCESS_ADMIN_TOKEN=… bun run --cwd packages/access admin:smoke` against it, and list tenants with `platformctl access tenants list`.

For a Data restore:

1. `restore.sh` reports the isolation check as the API role and the surviving pending deliveries without error.
2. `/readyz` answers `200`, which also proves the ledger matches the release's migrations.
3. `DATA_OWNER_DATABASE_URL=... bun run --cwd packages/data workspace -- list` shows the expected workspaces, and `DATA_DELIVERY_DATABASE_URL=... bun run --cwd packages/data delivery backlog` shows the pending deliveries.
4. A signed-in request through the gateway returns records the caller is allowed to see, and nothing from another tenant.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| `backup.sh` refuses the role | [Data backup and restore](../data/operations.md#backup-and-restore) |
| A script refuses the PostgreSQL client version | [Data backup and restore](../data/operations.md#backup-and-restore) |
| Restored Access stays `503 not-ready` and names an unknown migration | [Access start refusals](../access/troubleshooting.md#start-refusals) |
| Tenant client secrets cannot be read after the restore | [Access token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems) |
| Restored Data stays unready | [Data 503 on readiness](../data/troubleshooting.md#503-on-readiness) |
| A workspace answers `404` after the Data restore | [Data 404 for an existing workspace](../data/troubleshooting.md#404-not_found-for-an-existing-workspace) |
| Deliveries do not resume | [Data deliveries do not run](../data/troubleshooting.md#deliveries-do-not-run) |
| A caller keeps access that the restored grants no longer give | [Gateway: a revoked caller keeps access](../gateway/troubleshooting.md#a-revoked-caller-keeps-access) |
| The gateway stays unready after losing its shared state | [Gateway: the shared state is down](../gateway/troubleshooting.md#the-shared-state-is-down) |

## Related

- [Access backup and restore](../access/operations.md#backup-and-restore)
- [Data backup and restore](../data/operations.md#backup-and-restore)
- [Data retention](../data/operations.md#retention)
- [Gateway shared state](../gateway/operations.md#shared-state)
- [Data spec §15.4: retention, backup and removal](../data/spec.md#154-retention-backup-and-removal)
- [Upgrade and roll back](upgrade-and-roll-back.md)
- [Respond to an incident](respond-to-an-incident.md)
- [Monitor the platform](monitor-the-platform.md)
