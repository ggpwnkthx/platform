# Backup and restore

How to back up and restore a data service deployment, and the record of each release's restore
rehearsal.

## Backup contents

- business records of every collection,
- the workspace registry,
- the audit log, events, deliveries and receipts,
- migration history,
- the deployment's manifests and policy bundle, stored next to the dump.

Secrets are **not** in the backup. The gateway identity public key, the legacy derived identity key,
the access context credential, the cursor key and the role passwords belong to the deployment's
secret manager, which rotates and restores them.

## Backup

```bash
DATA_BACKUP_DATABASE_URL=... DATA_BACKUP_DIR=/var/backups/data \
  ./scripts/ops/backup.sh
```

The backup is a `pg_dump` custom-format dump with its digest in a file alongside. It uses a
consistent snapshot, so the dump is one database state, never a mix of two.

> [!IMPORTANT]
> **The backup role bypasses row-level security.** Row-level security is forced on the deployment's
> tables, so even a table's owner is subject to it. A backup holds every tenant's rows, so it must
> run as the server administrator or a role with `BYPASSRLS`. The command refuses a role subject to
> the table policies: a backup holding one tenant's rows is not a deployment backup.

## Restore rehearsal

```bash
DATA_ADMIN_DATABASE_URL=... DATA_RUNTIME_DATABASE_URL=... \
  DATA_BACKUP_FILE=/var/backups/data/data-....dump \
  DATA_RESTORE_DATABASE=data_restore ./scripts/ops/restore.sh
```

Restore runs as the server administrator for the same reason: restored rows belong to every tenant.
When the schema owner's URL is given, ownership of the restored tables and schemas returns to it, so
the deployment's privilege separation is the same before and after.

The rehearsal restores into its own database and checks that:

1. the restore completes without error,
2. tenant isolation holds after the restore: rows of a nonexistent scope are not visible. This check
   runs as the API role, because an administrator bypasses the table policies,
3. pending deliveries are still present and still safe: the worker claims them again, asks the
   access service for a fresh context, and doesn't repeat an effect that is already durable.

The rehearsal is part of a deployment's release; record the latest one in the deployment's release
notes.

### Release 0.1

Run on the release's development machine, PostgreSQL 15.19, with the repository's migrations and one
article in one workspace:

```
the backup is written to /tmp/rehearsal-backup/data-20261021T172011Z.dump
the backup is done
the database of the rehearsal is created
the backup is restored
the isolation of the tenants is checked
the restored rows are 0
the rows of a scope that does not exist are 0
the deliveries of the restored state are counted
0
the rehearsal is done
```

Restored rows are zero because the check runs as the API role with no transaction scope set, so the
table policies refuse the rows. The nonexistent scope sees nothing, and deliveries are read with the
delivery role.

A deployment's rehearsal runs the same command on its own data.

### Release candidate 1.0 on PostgreSQL 15.19

Same machine, PostgreSQL 15.19, the repository's migrations and one article in one workspace. The
repository's rehearsal command is `bash scripts/ops/rehearse-backup.sh`: it starts its own server,
provisions the roles, applies the migrations, writes the workspace and its record, then runs the
deployment's two commands.

```
the server of the rehearsal is started
the roles and the database are provisioned
the schema is applied
the workspace and its record are written
the backup is written
the backup is written to /tmp/data-rehearsal-AVHmOZ/backup/data-20261022T181856Z.dump
the backup is done
the restore is rehearsed
the database of the rehearsal is created
the backup is restored
the ownership of the restored tables goes back to the owner of the schema
the isolation of the tenants is checked
the restored rows are 0
the rows of a scope that does not exist are 0
the deliveries of the restored state are counted
0
the rehearsal is done
```

Restored rows are zero for the reason given under Release 0.1.

> [!NOTE]
> **This rehearsal found a defect in the backup command.** Because row-level security is forced, the
> backup, taken as the schema owner, made `pg_dump` refuse to read the rows. The backup command now
> refuses a role subject to the table policies and names the role that bypasses them, and the
> restore command returns ownership of the restored tables to the schema owner.

### Release candidate 1.0 on PostgreSQL 18

Rerun on the same machine with PostgreSQL 18.6 (the version used for local development, tests and
CI), the repository's migrations and one article in one workspace. The command is the same. The
rehearsal's client tools match the server: an older client refuses the dump, which would fail the
rehearsal on the machine's tools rather than the service.

```
the server of the rehearsal is started
the roles and the database are provisioned
the schema is applied
the workspace and its record are written
the backup is written
the backup is written to /tmp/data-rehearsal-OBC7rg/backup/data-20261023T141337Z.dump
the backup is done
the restore is rehearsed
the database of the rehearsal is created
the backup is restored
the ownership of the restored tables goes back to the owner of the schema
the isolation of the tenants is checked
the restored rows are 0
the rows of a scope that does not exist are 0
the restored images of the versions are 0
the images of a scope that does not exist are 0
the deliveries of the restored state are counted
0
the rehearsal is done
```

**Backup and restore name the versions.** Their client must not be older than the server; both
commands refuse an older client with a message naming the client and server versions. A deployment
may run PostgreSQL 15 or later: the requirement is on the client, not the server's major version.

## Restore order

1. Stop the API and workers: a restore writes the business tables.
2. Restore the dump.
3. Check the migrations: the restored ledger holds the backup's checksums, and the release's
   manifests must match them.
4. Start the API and workers. Workers claim pending deliveries; handlers are idempotent.

## Rollback

A migration that changed data is not rolled back with the schema: a data change is rolled back with
a forward fix. The backup is the safety net, and the restore rehearsal proves the net is there.

A rolling release keeps the schema and API backward compatible. A destructive migration needs a
reviewed maintenance plan and a tested restore.
