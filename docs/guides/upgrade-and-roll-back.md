# Upgrade and roll back

This guide moves a running deployment to a new platform release, one service at a time, and backs each service out again if the release misbehaves. It is for operators ([sysops](../roles/sysops.md)) and, for the migration steps, the database owner ([dba](../roles/dba.md)).

## Before you start

| What must be true | Why | Reference |
| --- | --- | --- |
| You know which release each service runs now | Every `/healthz` answer carries the running version; `platformctl version` shows the CLI's and the deployment's | [CLI spec §5.1](../cli/spec.md#51-root-commands) |
| You have read the target release's changelog | Contract changes, migrations and deprecations are announced there | [CHANGELOG.md](../../CHANGELOG.md) |
| The target is a published release | A release whose gates failed has its images withdrawn and publishes nothing | [Platform release gates](../platform/internals.md#release-gates) |
| You are within the support window | A release is supported while current and for one release after, so move from `N` to `N+1` | [Access support policy](../access/internals.md#support-policy), [SECURITY.md](../../SECURITY.md) |
| Fresh backups of Access and Data exist and a restore was rehearsed | Data's data-changing migrations only roll forward | [Back up and restore](back-up-and-restore.md) |
| A staging environment runs the current release | Access asks you to rehearse the rollback before you need it | [Access deploy and roll back](../access/operations.md#deploy-and-roll-back) |

## Steps

### 1. Read what the release changes

The platform has one version line: the gateway, Access and Data ship together at the same `MAJOR.MINOR.PATCH`. A `PATCH` release only fixes, a `MINOR` release adds to contracts without changing them, and only a `MAJOR` release may change a contract, with each change and its migration listed in the changelog ([gateway spec §14.2](../gateway/spec.md#142-release-promise)).

Check these points for the target release:

| Area | Rule to check against | Reference |
| --- | --- | --- |
| Route table | New fields come with defaults; an unknown field is still a configuration error | [gateway spec §14.2](../gateway/spec.md#142-release-promise) |
| Environment variables | A renamed variable keeps working under its old name, and logs a warning for one release before it goes | [gateway spec §14.2](../gateway/spec.md#142-release-promise) |
| Deprecations | Announced in the changelog, warned about in the log, removed in a `MAJOR` release at the earliest | [gateway spec §14.3](../gateway/spec.md#143-deprecations) |
| Data API and formats | API `v1`, access context `1`, signature `v5`, manifest and policy bundle format `1`; error codes are never removed | [Data spec §13](../data/spec.md#13-versions-and-compatibility) |
| Identity signature | Only `v5` exists since `1.0`; a pre-`1.0` gateway signs the removed `v4` | [Upstream identity: versions](../gateway/upstream-identity.md#versions) |
| Data legacy identity | `DATA_LEGACY_IDENTITY` refuses `v4` by default in `1.0.0`, and `2.0.0` removes it | [Leave the legacy identity format](../data/operations.md#leave-the-legacy-identity-format) |

The `1.0.0` changes and their effect on each service are summarized in [Data internals: platform release 1.0.0](../data/internals.md#platform-release-100).

### 2. Check the mix you will run mid-rollout

A rolling upgrade runs old and new versions side by side, and a deployment may keep them mixed. Which combinations are proven is the [compatibility baseline](../platform/internals.md#compatibility): each release's baseline is the revision it shipped at, pinned in [`compatibility.json`](../../compatibility.json).

To prove the published images of the target release against your old ones, point the suites at running services instead of local builds:

```bash
ACCESS_EXTERNAL_URL=https://access.staging.example.com \
ACCESS_EXTERNAL_ADMIN_TOKEN=… ACCESS_EXTERNAL_ACCESS_TOKEN=… \
  bun run compatibility
```

The variables are in [live services and databases](../platform/internals.md#live-services-and-databases). Data stays unready while Access's discovery lists no access context version Data knows, which is why Access goes first in step 5 ([Access spec §9.1](../access/spec.md#91-discovery)).

### 3. Back up both databases

Take a fresh Access dump and a fresh Data backup immediately before migrating. Access's older dump restores with its schema and catches up through the migration runner, while a database rollback of Data is not considered safe after a migration that changed data ([Data spec §15.5](../data/spec.md#155-capacity-and-rollout)). The commands are in [Back up and restore](back-up-and-restore.md).

### 4. Apply the migrations

Each service treats its schema differently:

| Service | How the new schema arrives | What to do |
| --- | --- | --- |
| Data | The operator command, as the schema owner | Run `migrate` from the new release before its API replicas start; they stay unready until the ledger matches their migrations |
| Access | Its first new replica applies them at start, under an advisory lock | Nothing by hand; a binary needs the new archive's `migrations/` beside it |
| Gateway (PostgreSQL state) | Built on connect only when `GATEWAY_POSTGRES_AUTO_MIGRATE=true` | Run the new release's `postgres:migrate` if you build the schema yourself |

```bash
DATA_OWNER_DATABASE_URL=postgres://data_owner:…@postgres:5432/data \
  bun run --cwd packages/data migrate
```

`migrate` takes an advisory lock, applies the files in order and records each checksum in its ledger ([migrations and drift](../data/operations.md#migrations-and-drift)). Never edit a migration that was already applied: the checksum mismatch is drift and fails readiness. If the changelog says a Data schema change breaks compatibility with the old release, drain the old Data replicas before you migrate. A destructive migration needs a reviewed plan and a restore you have tested.

On Kubernetes, run the new release's `deploy/kubernetes/base/data/migrate-job.yaml` by hand ([Kubernetes manifests](../../deploy/README.md#kubernetes-manifests)).

### 5. Roll the services in dependency order

The docs fix no single upgrade order; this one follows the dependencies they do state. Promote the same digest from staging to production, and replace replicas one by one, gated on `/readyz`.

| Order | Service | Why here | Rollout settings |
| --- | --- | --- | --- |
| 1 | Access | Data's readiness needs its access context discovery, and the gateway asks it for decisions | 10 s grace; wait for each old pod to be gone |
| 2 | Data | Needs the new schema from step 4 and Access's contract | Grace above `DATA_DRAIN_MS` (30 s) |
| 3 | Upstreams of the gateway, if the signature format changes | An upstream must verify the new format before the gateway signs it | Per upstream |
| 4 | Gateway and its control plane | Last of the services on the request path; the control plane validates tables with the same defaults as the gateway, so keep the two on one release | Grace above `GATEWAY_SHUTDOWN_TIMEOUT_MS`; same secrets and route table |
| 5 | Console | A client of the others; a restart signs everyone out | Rebuild from `packages/console/Dockerfile` at the new tag |
| 6 | CLI | Install the new `platformctl-<version>-<platform>.tar.gz` | [CLI install](../cli/usage.md#install) |

Keep each service's configuration and secrets unchanged during the upgrade, so a rollback only swaps the image. Do not write route-table fields that the new release adds until every gateway replica and the control plane run it, since an older replica refuses a table with a field it does not know. Data's manifests and policy bundles are versioned by content digest, so a new bundle is a release of its own: roll it the same way.

With the bundled Compose stack, change the image tags in `deploy/compose/production/platform.compose.yaml`; `bun run deploy:check` fails when image versions drift from the platform version ([deploy rules](../../deploy/README.md#rules)).

### 6. Watch each step before the next

| Watch | Meaning | Reference |
| --- | --- | --- |
| `/readyz` of the new replicas | The new version accepted its dependencies | [Monitor the platform](monitor-the-platform.md) |
| Access readiness `503 not-ready` with an unknown migration in the start log | The database is ahead of the code | [Access start refusals](../access/troubleshooting.md#start-refusals) |
| Data readiness `reason` | Drift, role or Access discovery problems | [Data 503 on readiness](../data/troubleshooting.md#503-on-readiness) |
| `gateway_config_reloads_total{result="failed"}` | The new gateway refuses the current route table | [route-table change has no effect](../gateway/troubleshooting.md#a-route-table-change-has-no-effect) |
| Access denial rate, login failures, decision latency | Behavior changed for real callers | [Access monitoring](../access/operations.md#monitoring) |
| `gateway_access_unavailable_total` | The gateway cannot use the new Access | [503 access_unavailable](../gateway/troubleshooting.md#503-access_unavailable) |
| Deprecation warnings in the logs | Something you use is scheduled for removal | [gateway spec §14.3](../gateway/spec.md#143-deprecations) |

### 7. Roll back a service

Images carry both the release tag and the version, so rolling back means deploying the previous release's digest with the configuration and secrets it ran with ([platform rollback](../platform/operations.md#rollback)). Roll back in the reverse of the upgrade order when several services moved.

| Service | How | What survives, and the catch |
| --- | --- | --- |
| Gateway | Deploy the previous image | Sessions survive while `GATEWAY_SESSION_SECRET` is unchanged, and upstreams keep verifying while the signing key is unchanged. Old pods drain: readiness `503`, WebSockets close with `1001`. Going below `1.0` brings back `v4` signatures, which `1.0` upstreams refuse ([gateway rollback](../gateway/operations.md#rollback)). |
| Route table | `platformctl routes rollback <revision>`, or `POST /v1/config/rollback` with a `config` token | The older table is written again as a new revision; history stays intact ([changing the route table](../gateway/operations.md#changing-the-route-table)). |
| Access | Redeploy the previous digest, for example `kubectl -n platform rollout undo deployment/platform-access` | Access operations call its migrations backward compatible for one release, but its spec also makes a replica refuse a database holding a migration it does not know. If the rolled-back replicas stay `503 not-ready` naming an unknown migration, roll forward again or restore the pre-upgrade dump; rehearse this in staging. |
| Data | Redeploy the previous image | Its schema stays where `migrate` left it: a rollback never reverts a migration, and a data-changing migration only rolls forward. Restore the pre-upgrade backup only for a destructive change, following the reviewed plan. Put the previous manifest and policy bundle back if those changed. |
| Console | Redeploy the previous build | Everyone signs in again. |
| CLI | Install the previous archive | Profiles and credentials are files and stay in place. |

```bash
docker pull ghcr.io/ggpwnkthx/access:<previous version>
kubectl -n platform rollout undo deployment/platform-access
kubectl -n platform rollout status deployment/platform-access
```

## Check that it worked

1. Each `/healthz` reports the version you meant to run, and Data's also reports the manifest's `schemaVersion`:

   ```bash
   curl -sS http://access:8081/healthz   # {"status":"ok","service":"access","version":"…"}
   curl -sS http://data:8082/healthz     # {"status":"ok","service":"data-backend","version":"…","schemaVersion":"…"}
   platformctl version
   ```

2. Every replica answers `200` on `/readyz`; for Data that also proves the ledger matches the release's migrations.
3. With store-mode route tables, `GET /v1/replicas` (or `platformctl routes replicas`) shows every gateway replica on the active revision with no last error.
4. The Access administration smoke test passes: `ACCESS_URL=… ACCESS_ADMIN_TOKEN=… bun run --cwd packages/access admin:smoke`.
5. A signed-in request through the gateway to `/ws/{workspaceId}/v1/me` returns the caller's identity from Data.
6. The alerts from [Monitor the platform](monitor-the-platform.md) stay quiet for a full day before you call the upgrade done.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| A new Access replica stays `503` and names an unknown migration | [Access start refusals](../access/troubleshooting.md#start-refusals) |
| A binary Access finds no schema | [Access start refusals](../access/troubleshooting.md#start-refusals) |
| Data readiness reports drift or a migration mismatch | [Data 503 on readiness](../data/troubleshooting.md#503-on-readiness), [migrations and drift](../data/operations.md#migrations-and-drift) |
| Data answers `503 AUTHORIZATION_UNAVAILABLE` after the upgrade | [Data 503 authorization unavailable](../data/troubleshooting.md#503-authorization_unavailable), [Access context refusals](../access/troubleshooting.md#access-context-refusals) |
| Data or an upstream refuses the gateway's identity signature | [Data 401](../data/troubleshooting.md#401-unauthenticated), [gateway: identity signature refused](../gateway/troubleshooting.md#the-upstream-refuses-the-identity-signature) |
| The new gateway refuses to start | [The gateway refuses to start](../gateway/troubleshooting.md#the-gateway-refuses-to-start) |
| Callers must log in again after a gateway rollback | [Rotating the session secret](../gateway/operations.md#rotating-the-session-secret) |
| Sessions break after an Access rollback | [Access token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems) |

## Related

- [Platform operations: versions](../platform/operations.md#versions)
- [Platform internals: release](../platform/internals.md#release)
- [Gateway spec §14: release compatibility](../gateway/spec.md#14-release-compatibility)
- [Data spec §13: versions and compatibility](../data/spec.md#13-versions-and-compatibility)
- [Access deploy and roll back](../access/operations.md#deploy-and-roll-back)
- [Gateway rollback](../gateway/operations.md#rollback)
- [Data migrations and drift](../data/operations.md#migrations-and-drift)
- [Back up and restore](back-up-and-restore.md)
- [Monitor the platform](monitor-the-platform.md)
- [Respond to an incident](respond-to-an-incident.md)
