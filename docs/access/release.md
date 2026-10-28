# Release

What must be true before the access service carries customer traffic, how tenants move onto it, how the image is delivered, and what this release does **not** do. Platform-wide release mechanics (tag, three images, three binaries, release gates) are in [platform release](../platform/release.md).

## 1. Readiness checklist

Someone who did not write the service checks each item. Every answer is a fact (a test, a measurement, a document); "it should be fine" is not an answer.

### Correctness

| Item | Answer |
| --- | --- |
| Every spec rule has a test | Test kinds: [architecture.md](architecture.md#tests). `bun run test` runs the repository tests; `bun run test:compat` runs the compatibility suite. |
| The compatibility suite passes and the gateway diff is empty | `test/compatibility/gateway.test.ts` runs the platform gateway, unchanged, against the access service. The runner (`bun run test:compat`) uses the gateway workspace, and CI checks the reference's tracked files match the tested revision. The release reruns the suite against the published image, not the source. |
| Migrations apply on an empty database and on the previous release's database | `test/integration/migrations.test.ts`: applies on an empty database, is idempotent, and refuses a database holding a migration the code does not know. |
| Every dependency failure is a denial, tested with the dependency really down | Database down (contract test), decision timeout, unreachable provider, store down. |
| Denial reasons reach neither the caller nor any caller-readable log | The reason is in the decision log and the contract response; the gateway hides it from the caller. |

### Security

| Item | Answer |
| --- | --- |
| Tokens compared in constant time | `src/observability/secrets.ts`; both values are hashed first. |
| Client secrets encrypted at rest, never returned or logged | `src/platform/postgres/secrets.ts`, `test/integration/tenants.test.ts`. |
| A tenant issuer is an https URL | The address guard: production refuses private addresses and non-http addresses (`src/platform/bun/address.ts`). |
| `idp_issuer` cannot reach an internal address | The host is resolved before the call and every resolved address must be public. |
| Refusal pages escape their content | `src/app/pages.ts`. |
| Login state is encrypted, single use and expiring | `src/domains/identity/state.ts`, `test/contract/login.test.ts`. |
| The authorization code is single use and bound | `src/domains/provider/exchange.ts`, `test/contract/login.test.ts`. |
| The database password is not in the image | It comes from the deployment environment; the image carries no secret. |
| The image runs as non-root, has no shell and is scanned | `Dockerfile`, CI job `image`. |
| No open security finding above "low" | [security.md](security.md#open-findings). One finding is "medium"; its plan is a deployment migration, not a service change. |
| Rotating a provider's keys does not lock out logins | Keys are re-read when a token names a key not in the cache (§6.6); tested in `test/contract/rotation.test.ts`. |

### Data

| Item | Answer |
| --- | --- |
| The eight tables are the only domain tables, and the production schema is the migrations' schema | The platform migrations. Migration bookkeeping (`access_schema_migrations`) is infrastructure, not domain. |
| Backups are automatic, restores rehearsed, recovery times written down | [operations.md](operations.md#backup-and-restore). Times are measured at the quarterly rehearsal. |
| A column is dropped two releases after the code stops using it | No migration drops a column: the eight tables are the model (§14). |
| The admin audit is durable, not only in logs | The `admin_audit` table: each change writes a row naming the action, target, tenant, operator, address and request, in the same statement as the change, so an unaudited change cannot exist. Read it with `GET /v1/admin/audit`. |
| Tenants are isolated by the database, not only the application | Row level security on the eight tables, statement scope (`src/platform/postgres/scope.ts`), and production refusing a role that bypasses policies (§3.10). Tested in `test/integration/isolation.test.ts`. |
| Group membership never names another tenant's principal | Schema foreign keys plus a domain check: a member that is not a principal of the tenant is `404` (§10.9). |

### Availability

| Item | Answer |
| --- | --- |
| The service is stateless: two replicas, one image, one digest | Login state is in the browser cookie and login codes in the store; the image is promoted by digest. |
| Draining a replica does not break in-flight logins | Five seconds of grace; in-flight logins finish (§12.4). |
| The code store is shared, or the deployment is an explicit single node | `ACCESS_ALLOW_MEMORY_STATE` is the switch; production without Redis refuses to start. |
| A tenant's provider outage degrades that tenant, not the service | Providers are called per tenant; other tenants keep working. |
| Alerts reach a channel someone reads | [operations.md](operations.md#alerts). Wired with the deployment platform. |
| Runbooks exist and were walked through once | [operations.md](operations.md#runbooks). Rehearsed at the first tenant's cutover. |

### Observability

| Item | Answer |
| --- | --- |
| Logs are structured, carry the request id and redact secrets | `src/observability/logging.ts`; the request id is on every line of a request and in the response. |
| Spec metrics are exposed with bounded labels | `src/observability/metrics.ts`; the tenant label is bounded at a hundred values. |
| A dashboard shows decision rate, latency, login refusal rate and failures by dependency | The metrics exist; the dashboard is built on the deployment platform. |
| A decision's log line can be found from the gateway's request id, via subject and workspace | The decision line carries request id, subject, workspace and route. |

### Delivery

| Item | Answer |
| --- | --- |
| The image is built once and promoted by digest | See [Delivery](#5-delivery): the release workflow builds and publishes once, and every gate runs against that digest. |
| CI runs type check, lint, tests, architecture test, compatibility test, release version check and scan | Jobs `check`, `compatibility` and `image` in `.github/workflows/ci.yml`. |
| Image rollback is rehearsed | Rehearsed at the cutover. |
| The service version is in `/healthz` and the startup log | `src/app/endpoints.ts` and the log line `the listener started`. |

### Items needing a deployment

| Item | When checked |
| --- | --- |
| Capacity on production hardware | During the cutover, with `scripts/ops/load.ts` against the deployment's server. |
| Pool saturation and process memory | During the cutover, on the deployment's dashboard. |
| Restore rehearsal and recovery times | Quarterly, in the rehearsal environment. |
| Alert wiring and rollback rehearsal | During the first tenant's cutover, by someone who did not write the service. |

## 2. Rollout

| Phase | State | Work | Rollback |
| --- | --- | --- | --- |
| 0 — Dark | The access service runs; nobody calls it. | Deployment, probes, metrics, alerts. | Stop the deployment. |
| 1 — Shadow | The access service answers decisions in parallel with the production service. | The [shadow comparison](#3-shadow-comparison), daily. | Stop the shadow. |
| 2 — First tenant, staging | A whole tenant lives on the access service. | Create the tenant, principals and grants; switch the tenant's gateway. | Point the tenant's gateway back at the old service. Access service data stays. |
| 3 — First tenant, production | Same, with real traffic. | A week of monitoring, then the second tenant. | Same. |
| 4 — Last tenant | The old access service is empty. | Decommission it. | Data is kept for the audit retention period. |

Switching a tenant is one gateway configuration change: issuer, client id, client secret and access URL. Browsers are redirected to the access service, gateway sessions are new, and callers log in again. That login is the only interruption; it is not an outage.

## 3. Shadow comparison

Before cutover, the access service answers decisions in parallel with the production access service, and a tool compares both answers on the same requests.

```
OLD_ACCESS_URL=https://old-access.example.com \
OLD_ACCESS_TOKEN=… \
ACCESS_URL=https://access.example.com \
ACCESS_DECISION_TOKEN=… \
bun run scripts/compat/shadow.ts --requests decisions.jsonl
```

Requests are read from a file, one JSON object per line:

```
{"subject":"…","workspaceId":"…","routeId":"…","roles":[]}
```

The tool reports differing answers per subject and workspace and prints a fingerprint of the set of differences, so a recurring difference is recognisable day to day. **It exits non-zero while any difference remains**; the shadow period does not end until there are none.

One difference is expected: the old service's hard-coded decisions, which grants replace. Any other difference is an access service bug. The tool only reads from the old service and asks the access service; **it never writes to the access service**.

## 4. Tenant cutover

The cutover is when a gateway deployment's tenant starts living in the access service.

### Phase gates

Every phase must pass all three gates:

| Gate | Check |
| --- | --- |
| Compatibility suite green | `bun run test:compat`: the unchanged reference gateway against the access service. |
| Alerts silent | The [alerts](operations.md#alerts) show nothing for the phase's period. |
| No answer differences | `bun run scripts/compat/shadow.ts --requests decisions.jsonl` reports zero differences. |

### Phase 2: first tenant in staging

1. **Register the tenant** in staging with the calls in [First tenant](operations.md#first-tenant).
2. **Register principals**, one per external identity. The external identity is the tenant provider's `sub`, the mapping key (§6.2). **One batch call carries the whole list** (§10.4) and onboards the tenant.
3. **Create grants**, one per permission on a workspace and route. Copy the first ones from the production access service so the shadow comparison has something to compare. **One batch call carries the whole list** (§10.6).
4. **Run the shadow for a day**, sending both services the same decisions.
5. **Switch the staging gateway**: issuer, client id, client secret and access URL point at the access service.
6. **Verify**: a browser logs in at the tenant's provider and reaches a staging upstream. Gateway metrics count the access service's decisions.

### Phase 3: first tenant in production

1. Repeat the sequence in production.
2. **Rehearse the rollback before switching**: record the gateway's previous configuration and apply it once on a staging deployment to prove it works.
3. Switch the tenant's gateway.
4. Monitor the first day: login refusal rate, decision latency, denial rate.
5. **Rollback**: restore the gateway configuration and the old access service serves the tenant again. Access service data stays, so the tenant can be switched again without re-registering anything.

### Not done during cutover

- **No gateway change.** The tenant's gateway is configured, not modified; the compatibility suite proves it.
- **No data migration from the old service.** Each service keeps its own data. Principals and grants are registered one by one.
- **No change to gateway sessions.** Callers log in again.
- **No schema change mid-cutover.** Migrations are backward compatible for one release, so an image rollback never needs a schema rollback.

### Cutover checklist

- [ ] The tenant, its principals and its grants are registered in the target environment.
- [ ] The shadow comparison reports zero differences for a day.
- [ ] The compatibility suite is green.
- [ ] The twelve calls of the session answer (`scripts/cli/admin-smoke.ts`).
- [ ] The access service's signing key is the target environment's, and the gateway uses the same issuer.
- [ ] The gateway configuration rollback is written down.
- [ ] The tenant's dashboards are watched for the first day.

## 5. Delivery

The image is built once and promoted by digest. Nothing is rebuilt between environments: the tested image is the image that runs.

### Build

```bash
docker build -f packages/access/Dockerfile -t access:$(git rev-parse --short HEAD) \
  --build-arg REVISION=$(git rev-parse HEAD) \
  --build-arg VERSION=$(node -p "require('./packages/access/package.json').version") .
```

Image labels carry the version and revision, so operators can tell what is running without reading logs:

```bash
docker image inspect access:<tag> --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

The base image is pinned by digest (`oven/bun:1.4.3-alpine@sha256:…`): a tag moves, and a release image must be exactly the one built, scanned and promoted.

### Tagging

A release is a tag naming the package version; workflows refuse a tag that does not.

**`tag.yml` cuts the tag** after CI passes on a main-branch commit. It reads the package version, compares it with the highest tagged version, and pushes `v<version>` when the version went up. It tags the commit CI proved, not the branch head, so commits landing meanwhile do not change what is released.

**The release is dispatched, not triggered by the push.** The tag is pushed with the workflow token, and GitHub does not start workflows on such pushes. So `tag.yml` **dispatches** the release workflows with the tag it cut, and only when it cut the tag itself (an existing tag means the release already started). Both release workflows can also be dispatched by hand with the tag:

```bash
gh workflow run release.yml --ref v1.0.0 -f tag=v1.0.0
gh workflow run release-binaries.yml --ref v1.0.0 -f tag=v1.0.0
```

The tagger refuses whatever the release would refuse:

| Situation | Tagger behavior |
| --- | --- |
| Project versions disagree | Refuses and names the disagreeing files (`bun run versions`). |
| Package version is not a release version | Refuses: three numbers, no pre-release. |
| Version did not go up | Nothing: that release is already cut. |
| Version went down | Refuses: releases do not go backwards. |

The release version appears in **five** places, and `bun run versions` checks they agree:

| File | Holds |
| --- | --- |
| `packages/access/package.json` | Package version. |
| `packages/access/Dockerfile` | Image version (`ARG VERSION`). |
| `packages/access/src/runtime/version.ts` | Service version. |
| `docs/access/spec.md` | Spec status. |
| `docs/access/README.md` | Release state in the docs. |

Bump all five in one commit; `bun run versions` fails and names any file that disagrees.

You can also tag by hand; the release workflows don't care who cut the tag. A tag pushed by a person starts the release directly, since it is not a workflow push:

```bash
git tag -a v1.0.0 -m "platform v1.0.0" && git push origin v1.0.0
```

### Release workflows

Both run on the tag and check that package, image, service and spec versions agree (`bun run versions`).

| Workflow | What it does |
| --- | --- |
| `release.yml` | **Builds the release image once** and publishes it with provenance and SBOM. Every gate then runs against that build's **digest**: start it with a deployment configuration, prove it answers gateway decisions, refuses to start without a secret or with a role that bypasses isolation, drains, passes the scan, and passes the **reference gateway's suite**. Exports the image as a run artifact, and withdraws it from the registry if a gate fails. |
| `release-binaries.yml` | Compiles the service for every supported platform, proves the runner's binary starts, applies the release schema and serves, and publishes the archives on the tag's release. |

The image is published with two tags, the release tag (`v1.0.0`) and the bare version (`1.0.0`), and promoted by digest. No gate ever runs against a tag or a second build: the digest the gates proved is the digest deployments pin.

The image is published **before** the gates so they test the bytes that ship. If a gate fails, the `withdraw` job removes the image from the registry and the release tag points at nothing.

Binaries contain only the service; the runtime is inside the binary. **The release schema travels with the binary**: `migrations/` sits next to the executable and the binary finds it there. Each platform archive holds both; extract it into the deployment directory:

```bash
tar -xzf access-1.0.0-linux-x64.tar.gz -C /opt/access
/opt/access/access-1.0.0-linux-x64
```

Embedded PostgreSQL is a development dependency, in neither the binaries nor the deployment image. A binary names a PostgreSQL server with `ACCESS_DATABASE_URL`. If it cannot find the schema, it refuses to start and says where it looked: starting against a schema it does not understand would be worse than not starting.

### Scan and SBOM

CI builds the image, scans it and writes its SBOM. A finding above "high" fails the build:

```bash
trivy image --severity HIGH,CRITICAL --exit-code 1 access:ci
syft access:ci -o spdx-json > access.spdx.json
```

The SBOM is published with the image so deployments know what they run.

### Promotion

| Stage | What happens |
| --- | --- |
| Commit | Merged when CI is green, with the spec updated if a rule changed. |
| Review | One reviewer other than the author. |
| Image | Built once, tagged with the commit, pushed with its digest. **The digest is what is deployed.** |
| Promotion | The same digest moves from development to staging to production. Nothing is rebuilt. |
| Deployment | Rolling replacement gated by the readiness probe. A draining replica finishes its in-flight logins. |
| Rollback | Redeploy the previous digest. The service is stateless apart from the database, and migrations are backward compatible for one release. |

### Drain

On `SIGTERM` a replica answers `503 draining` on readiness, stops accepting new work, gives running logins five seconds, and exits. The deployment gives it a 10 s drain grace period, and the rollout waits for the pod to be gone.

### Rollback

```bash
kubectl -n platform rollout undo deployment/platform-access
kubectl -n platform rollout status deployment/platform-access
```

Rehearse the rollback: a deployment never rolled back does not know how to roll back.

### CI

On every push:

| Job | Runs |
| --- | --- |
| `check` | Types, lint, format, import boundaries, release version, repository tests (`bun run test`), and integration tests on a PostgreSQL server. |
| `compatibility` | `bun run test:compat`: the unchanged platform gateway against the access service, plus proof that the reference's tracked files match the tested revision. |
| `image` | Image build, scan, SBOM, runtime user, size, refusal to start without a secret or with a role that bypasses isolation, startup with a deployment configuration, and drain. |

`compatibility` may never be skipped: a red compatibility job is a red build. `tag.yml` runs after CI and never cuts a tag before the commit's CI is green or one the release would refuse (see [Tagging](#tagging)).

## 6. Release support

A release is supported while current and for a window of **one release** after: a deployment on release `N` moves to `N+1`, and `N` is not patched after that.

| Question | Answer |
| --- | --- |
| Which release is current? | The version in [`package.json`](../../packages/access/package.json) and the repository tag `v<version>`. `bun run versions` checks that package, image, service, spec and docs name the same release. |
| Which gateway is a release tested against? | The repository's revision of the gateway workspace. The release's compatibility suite runs that gateway, unchanged, against the published image. |
| What changes in a patch release? | Not behavior: the spec contract never changes in a patch. A behavior change updates the spec in the same commit as the code and is a minor release. |
| What about migrations? | Backward compatible for one release, so an image rollback never needs a schema rollback. A column is dropped two releases after the code stops using it. |

Each release's changes are in [`CHANGELOG.md`](../../CHANGELOG.md).

## 7. What this release does not do

Deferred features are listed in §14: SAML, the console, SCIM, directory sync and account linking. None has a column, table, flag or endpoint, and a test asserts their absence.

Known limits a deployment must be aware of:

| Limit | Meaning |
| --- | --- |
| **One gateway per tenant.** | A gateway deployment holds one client id, so it serves one tenant. The shared client (`shared_client`) is the escape hatch and is refused by default (§1.4, §5.2). |
| **Group membership is a list, not a table.** | `groups.members` is a `uuid[]`, so membership is not paginated and lives in one row. The **database** enforces it: a constraint trigger refuses a member that is not a principal of the group's tenant (§3.5). Membership has a GIN **index**, so decisions don't walk the tenant's groups, but a tenant with many groups still pays the containment cost on every decision. |
| **The decision deadline is the pool's deadline.** | The pool connections' `statement_timeout` (`ACCESS_DECISION_TIMEOUT_MS`) is the service's tightest deadline: PostgreSQL stops a slow statement and the connection is returned at once. Embedded PostgreSQL does not interrupt statements, so locally the process deadline is the only one and the statement holds its connection until the server answers. |
| **The decision bearer token is platform-wide.** | It is the reference gateway's scheme and is not scoped. Scoped tenant credentials can replace it gateway by gateway (§8.8; [open finding 2](security.md#open-findings)). Its rotation is rolling (§4.3.1). |
| **No refresh token.** | Access service tokens live five minutes; then the gateway re-authenticates the caller (§7.2). |
| **The admin audit is a table, not a report.** | It is durable, queryable (`GET /v1/admin/audit`) and **exportable** as `csv` or `jsonl` besides paginated `json`, so history can leave the platform as a file (§10.15). It has no summary and no retention policy: the table grows as long as the deployment keeps it, and operators read it with `curl` and SQL. |
| **Capacity numbers come from a development machine.** | The [capacity numbers](operations.md#capacity) were measured on a development machine against a PostgreSQL server over loopback. Deployment numbers are measured during cutover. |
| **The compatibility suite needs the reference.** | It clones the platform repository over the network. Offline, give it a mirror (`COMPAT_MIRROR`) or a local repository (`GATEWAY_REPOSITORY`); see [compatibility.md](compatibility.md). |
