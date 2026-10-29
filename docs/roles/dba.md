# Database administrator

You own the PostgreSQL that the platform keeps its lasting state in: Access's tables, Data's records with their audit, events and version history, and, when the gateway is configured for it, the gateway's shared state. This page lists what you are responsible for, what to read first and where each database task is documented.

## What you own

| Database | Who connects | Connection variable | What it holds | Rules |
| --- | --- | --- | --- | --- |
| Access | Access replicas | `ACCESS_DATABASE_URL` | Eight tables: tenants, principals, permissions, grants, groups, roles and the two role link tables | [Access spec §3](../access/spec.md#3-tables) |
| Data | Data replicas and workers | `DATA_DATABASE_URL`, `DATA_REGISTRY_DATABASE_URL`, `DATA_DELIVERY_DATABASE_URL` | Workspace records, audit, events, deliveries and version history, kept apart per workspace by row-level security | [Data spec §6.4](../data/spec.md#64-postgresql-isolation), [§7](../data/spec.md#7-schema-and-collections) |
| Gateway shared state (optional) | Gateway replicas and `gateway-control` | `GATEWAY_SESSION_URL`, `GATEWAY_SHARED_STATE_URL`, `GATEWAY_CONTROL_STATE_URL` with a `postgres://` URL | Sessions, rate-limit windows, cached decisions and route-table revisions | [Gateway spec §12.8](../gateway/spec.md#128-shared-state-roles) |

Each service connects with its own non-superuser role. Access refuses a superuser or a `BYPASSRLS` role in production, because row-level policies would not bind it ([Access spec §3.10](../access/spec.md#310-tenant-isolation)).

## Start here

1. [Platform overview](../platform/README.md), for where each database sits.
2. [Access operations: database role](../access/operations.md#database-role) and [Data operations: database roles](../data/operations.md#database-roles), to create the roles.
3. [Data configuration: database](../data/configuration.md#database), for the three Data connections and what each role may do.
4. [Gateway operations: shared state](../gateway/operations.md#shared-state), if the gateway uses PostgreSQL rather than Redis.
5. [Back up and restore](../guides/back-up-and-restore.md), before the first production write.

## Common tasks

| Task | Where |
| --- | --- |
| Create the roles and databases of a first deployment | [Deploy the platform](../guides/deploy-the-platform.md) |
| Run migrations and detect drift | [Data: migrations and drift](../data/operations.md#migrations-and-drift), [Access spec §3.8](../access/spec.md#38-migrations) |
| Back up, restore and rehearse | [Back up and restore](../guides/back-up-and-restore.md) |
| Apply retention and remove a workspace's data | [Data: retention](../data/operations.md#retention), [Data: remove a workspace](../data/operations.md#remove-a-workspace) |
| Clean up failed event deliveries | [Data: failed deliveries](../data/operations.md#failed-deliveries) |
| Size pools and timeouts | [Data configuration: budgets](../data/configuration.md#budgets), [Access operations: tuning](../access/operations.md#tuning), [Gateway configuration: shared state](../gateway/configuration.md#shared-state) |
| Upgrade with new migrations, or roll back | [Upgrade and roll back](../guides/upgrade-and-roll-back.md) |
| Rotate database passwords | [Rotate secrets](../guides/rotate-secrets.md) |

## Reference

| Question | Page |
| --- | --- |
| What does each Access table hold, and which indexes serve decisions? | [Access spec §3](../access/spec.md#3-tables), [§8.5](../access/spec.md#85-indexes) |
| Which fields does Data maintain itself, and how does a collection change? | [Data spec §7](../data/spec.md#7-schema-and-collections) |
| How does Data scope every statement to one workspace? | [Data spec §6.4](../data/spec.md#64-postgresql-isolation) |
| What does Data keep, and for how long? | [Data spec §15.4](../data/spec.md#154-retention-backup-and-removal) |
| Why does Data's SQL look the way it does? | [Data decisions: implementation decisions](../data/decisions.md#implementation-decisions) |
| How do the two gateway backends compare? | [Gateway spec §12.6](../gateway/spec.md#126-backend-comparison) |

## When the database is the problem

| Symptom | Where to look |
| --- | --- |
| Data answers `503 DATABASE_UNAVAILABLE` | [Data troubleshooting](../data/troubleshooting.md#503-database_unavailable) |
| Data's readiness probe answers `503` | [Data troubleshooting](../data/troubleshooting.md#503-on-readiness) |
| Access refuses to start because of its database role or schema | [Access troubleshooting: start refusals](../access/troubleshooting.md#start-refusals) |
| Gateway sessions or limits fail with the shared-state backend | [Gateway troubleshooting: startup and readiness](../gateway/troubleshooting.md#startup-and-readiness) |

The rules a request follows are not yours to change; the schema they run on is. When the two meet, as in an index Data needs or a migration Access refuses, the owning spec decides.
