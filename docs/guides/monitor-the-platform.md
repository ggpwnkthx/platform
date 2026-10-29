# Monitor the platform

This guide sets up monitoring for a running deployment: probes wired into the orchestrator, every metrics endpoint scraped with its token, the alerts each service documents, and logs you can follow from one request ID across the gateway, Access and Data. It is for operators ([sysops](../roles/sysops.md)); [secops](../roles/secops.md) owns the metrics tokens.

## Before you start

| You need | Notes |
| --- | --- |
| A deployed platform | See [Deploy the platform](deploy-the-platform.md). |
| A Prometheus-compatible scraper | Every service publishes Prometheus text on `/metrics` ([platform metrics](../platform/operations.md#metrics)). |
| A metrics token per service | `GATEWAY_METRICS_TOKEN`, `ACCESS_METRICS_TOKEN`, and a file for `DATA_METRICS_TOKEN_FILE`. |
| A log pipeline that reads standard output | All four processes log JSON lines to stdout. |
| Somebody who receives alerts | Access's alerts expect a person to follow the runbook, not an automatic restart. |

## Steps

### 1. Wire the probes into the orchestrator

Use `GET /healthz` for liveness and `GET /readyz` for readiness and rollout gating on every process. `/healthz` never calls a dependency, so a failing database does not get a healthy pod killed; `/readyz` takes a replica out of rotation while a dependency it needs is down or while it drains ([platform probes](../platform/operations.md#probes)).

| Process | Port | `/readyz` is `200` when | During a drain |
| --- | --- | --- | --- |
| Gateway | `8080` | A route table has loaded and the session store answers | `503`, body `draining`, for up to `GATEWAY_SHUTDOWN_TIMEOUT_MS` (15 s) |
| Control plane | `9090` | The shared state answers | Not documented |
| Access | `8081` | The database answers and every migration is applied | `503 {"status":"draining"}`; logins get five seconds |
| Data | `8082` | Configuration, schema, role privileges and a recent Access discovery pass | `503 {"status":"draining"}` for up to `DATA_DRAIN_MS` (30 s) |
| Console | `8083` | Access serves its discovery document | Not documented |

A failed route-table reload does not make the gateway unready: the last valid table keeps serving and the error shows in the `/readyz` body as `config.lastError` ([gateway spec §12.3](../gateway/spec.md#123-reload-and-readiness)). Data's `503` body carries a `reason` naming the failing part ([Data spec §15.1](../data/spec.md#151-probes-and-metrics)).

Set each pod's termination grace period above its drain budget so the drain finishes before the kill. From an operator machine, `platformctl status --watch` polls the same probes every five seconds ([CLI usage](../cli/usage.md#everyday-work)), and the console's **Status** page shows them to anyone ([console user guide](../console/user-guide.md#read-service-status)).

### 2. Give the scraper its tokens

Each metrics endpoint is guarded by its own bearer token and exists only once you configure that token. Send the token as `Authorization: Bearer <token>` and keep the endpoints off the public ingress.

| Service | Token | Without a token configured | Wrong or missing bearer |
| --- | --- | --- | --- |
| Gateway | `GATEWAY_METRICS_TOKEN` | `404` | `401` |
| Access | `ACCESS_METRICS_TOKEN` (or `ACCESS_METRICS_TOKEN_FILE`) | Not served | Refused; the status is not documented |
| Data | `DATA_METRICS_TOKEN_FILE` | `404` | `401` |

```bash
curl -sS -H "Authorization: Bearer $GATEWAY_METRICS_TOKEN" http://gateway:8080/metrics | head
curl -sS -H "Authorization: Bearer $ACCESS_METRICS_TOKEN"  http://access:8081/metrics | head
curl -sS -H "Authorization: Bearer $(cat /run/secrets/data-metrics-token)" http://data:8082/metrics | head
```

The console and the control plane document no metrics endpoint; watch them through their probes and logs. Every label set is bounded on purpose (gateway routes cap at 500, Access tenants at 100, and Data carries no tenant, principal or workspace label at all), so per-tenant dashboards come from logs, not from metrics.

### 3. Alert on the gateway

The gateway sits on every request, so its metrics show most incidents first. Metric names and labels are in [gateway spec §12.1](../gateway/spec.md#121-health-readiness-and-metrics); the alert list is in [gateway monitoring](../gateway/operations.md#monitoring).

| Watch | What it tells you | Runbook |
| --- | --- | --- |
| `/readyz` answering `503` | A replica left rotation | [`/readyz` answers 503](../gateway/troubleshooting.md#readyz-answers-503) |
| `gateway_access_unavailable_total` rising | Callers on workspace routes get `503` because Access cannot be asked | [503 access_unavailable](../gateway/troubleshooting.md#503-access_unavailable) |
| `gateway_access_stale_total` rising | An outage grace is covering for Access, so revocations lag | [stale decisions](../gateway/troubleshooting.md#gateway_access_stale_total-grows) |
| `gateway_shared_state_errors_total` rising | Redis or PostgreSQL is degraded; sessions fail closed | [shared state down](../gateway/troubleshooting.md#the-shared-state-is-down) |
| `gateway_rate_limit_fallback_total` rising | Limits are being counted per process | [limits look per replica](../gateway/troubleshooting.md#limits-look-per-replica) |
| `gateway_config_reloads_total{result="failed"}` | A route-table change was refused | [route-table change has no effect](../gateway/troubleshooting.md#a-route-table-change-has-no-effect) |
| `gateway_upstream_failures_total`, `gateway_request_errors_total` | An upstream is failing | [502 bad_gateway](../gateway/troubleshooting.md#502-bad_gateway) |
| `gateway_rate_limited_total` spiking | A flood is hitting the limiter | [429 too_many_requests](../gateway/troubleshooting.md#429-too_many_requests) |
| `gateway_active_requests` near `GATEWAY_MAX_PENDING_REQUESTS` | Admission is filling, usually behind a slow dependency | [503 gateway_overloaded](../gateway/troubleshooting.md#503-gateway_overloaded) |

For latency, `gateway_request_duration_seconds`, `gateway_upstream_duration_seconds` and `gateway_access_duration_seconds` split the time between the gateway, the upstream and Access. `gateway_auth_failures_total{reason}` separates `missing_role` from `access_denied`.

### 4. Alert on Access

Access documents eight alerts with expressions, durations and runbooks in [Access monitoring](../access/operations.md#monitoring). Load them as written; the expressions look like this:

```text
rate(access_decisions_total{result="deny"}[5m]) / rate(access_decisions_total[5m]) > 0.2      for 10m
histogram_quantile(0.99, rate(access_decision_duration_seconds_bucket[5m])) > 0.02             for 5m
rate(access_logins_total{result!="success"}[10m]) > 0.1                                         for 10m
rate(access_store_errors_total[5m]) > 0                                                         for 5m
pg_stat_activity_count{application_name='access'} > 7                                           for 5m
rate(access_admin_requests_total{status="401"}[5m]) > 0                                         for 5m
probe_success{job="access"} == 0                                                                for 2m
```

The eighth, a schema older than the code, is not a metric: new replicas stay `503 not-ready` and the start log names an unknown migration, so alert on readiness plus that log line. The page also lists four platform-level signals to add: replicas not ready, pod memory against 200 MB, the ingress certificate, and the age of the last database dump.

Decision reasons never reach a metric or the caller; they are in Access's decision log line ([Access spec §12.3](../access/spec.md#123-logs)).

### 5. Alert on Data

Data's metric names are in [Data metrics](../data/operations.md#metrics) and its alarms in [Data alarms](../data/operations.md#alarms).

| Watch | What it tells you | Runbook |
| --- | --- | --- |
| `data_outbox_oldest_age_seconds` climbing | A subscriber is behind; the backlog limit eventually refuses new work | [Data alarms](../data/operations.md#alarms) |
| `data_delivery_failures_total` climbing | A handler fails, or a subscriber went missing in a deploy | [deliveries do not run](../data/troubleshooting.md#deliveries-do-not-run) |
| `data_authorization_denials_total` climbing | A client exceeds its grants, or a grant was revoked | [403 FORBIDDEN](../data/troubleshooting.md#403-forbidden) |
| `data_db_pool_waits_total` climbing | The pool is too small or the database is slow | [503 DATABASE_UNAVAILABLE](../data/troubleshooting.md#503-database_unavailable) |
| `data_access_requests_total{outcome="failed"}` | Calls to Access fail | [503 AUTHORIZATION_UNAVAILABLE](../data/troubleshooting.md#503-authorization_unavailable) |
| `data_tenant_overload_total` | Tenants hit their share of in-flight requests | [429 TOO_MANY_REQUESTS](../data/troubleshooting.md#429-too_many_requests) |
| `/readyz` answering `503` | A dependency failed; the body says which | [503 on readiness](../data/troubleshooting.md#503-on-readiness) |

Worker processes become unready without a delivery store or a registered subscriber, so probe them as well as the API.

### 6. Watch the console and the control plane

The console logs one JSON line per request but skips probe requests, and its readiness follows Access's discovery document ([console probes and logs](../console/operations.md#probes-and-logs)). A console restart signs everyone out, so count restarts.

The control plane answers `503` to every request while the shared state is unreachable, and five failed authentications in sixty seconds from one address earn `429`. Every write it accepts is in `GET /v1/audit`, or `platformctl routes audit`; review it after route-table changes ([gateway spec §12.7](../gateway/spec.md#127-control-plane)).

### 7. Collect logs and follow one request ID

Every service writes JSON to stdout with secrets redacted, and every service echoes an `x-request-id`:

| Service | Request ID rule | What its lines add |
| --- | --- | --- |
| Gateway | Reuses the caller's `x-request-id` when it matches `^[A-Za-z0-9._-]{1,64}$`, otherwise makes a UUID ([gateway spec §2.1](../gateway/spec.md#21-request-id)) | Route, caller subject, workspace, and the trace ID it sends upstream in `traceparent` ([gateway spec §7.5](../gateway/spec.md#75-trace-context)) |
| Access | Returned on every answer and written on every line | Login outcome and refusal reason; decision subject, workspace, route and reason |
| Data | Equal to the `requestId` of an error body | Error code, normalized route, dependency durations; never Access's reason |
| Console | Reuses the caller's ID when it matches `^[A-Za-z0-9._-]{1,128}$` | Method, path, status, duration |

To trace a failing request, take the `x-request-id` from the response (or the console's error page, or set your own with `platformctl --request-id`), search the gateway logs for it, then search Access's decision line and Data's line for the same ID. The gateway's running-policy lines, logged once per route-table generation, also flag permissive routes with warnings such as `unauthenticated_route` ([gateway spec §12.2](../gateway/spec.md#122-logs)). Never rename a Data log field that carries a secret: redaction matches field names ([Data logs](../data/operations.md#logs)). A full walk-through is in [Troubleshoot a request](troubleshoot-a-request.md).

### 8. Decide what pages a person

The service pages agree on these conditions as worth an alert; route each to someone who can follow the runbook.

| Condition | Signals | Start with |
| --- | --- | --- |
| A replica out of rotation | `/readyz` `503` on any service | That service's readiness runbook above |
| Access unreachable or slow | `gateway_access_unavailable_total`, Access latency and store-error alerts | [Access outages](../access/troubleshooting.md#decision-timeouts-and-outages) |
| Shared state degraded | `gateway_shared_state_errors_total`, `access_store_errors_total{store="redis"}` | [gateway shared state](../gateway/troubleshooting.md#the-shared-state-is-down) |
| Login trouble | Access login-failure alert, `gateway_auth_failures_total` | [Access failed logins](../access/troubleshooting.md#failed-logins) |
| Denials jump | Access denial-rate alert, `data_authorization_denials_total` | [Access decisions denied](../access/troubleshooting.md#decisions-denied) |
| Credential guessing | Access admin `401` alert, control-plane `429` | [administration refusals](../access/troubleshooting.md#administration-refusals) |
| Database pressure | Access pool alert, `data_db_pool_waits_total` | [Access tuning](../access/operations.md#tuning) |
| Event backlog | `data_outbox_oldest_age_seconds` | [Data failed deliveries](../data/operations.md#failed-deliveries) |
| Backups stale | Age of the last Access and Data dumps | [Back up and restore](back-up-and-restore.md) |

## Check that it worked

1. Each `curl` in step 2 returns Prometheus text; the same call without the header returns `401` from the gateway and Data.
2. Your scraper's target list shows every gateway, Access and Data replica as up.
3. In staging, send `SIGTERM` to one replica of each service: its `/readyz` turns `503` with a `draining` body, the orchestrator stops routing to it, and your readiness alert fires if the replica does not come back.
4. Send a request through the gateway with `x-request-id: monitor-check-1`, then find that ID in the gateway, Access and Data logs.
5. Open the console's **Status** page with `console.status` and confirm versions and latencies for the three services.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| Gateway `/metrics` answers `404` or `401` | [Gateway metrics endpoint](../gateway/troubleshooting.md#metrics-endpoint) |
| Data `/metrics` answers `404` | [Data configuration: observability](../data/configuration.md#observability) |
| Gateway `/readyz` stays `503` | [`/readyz` answers 503](../gateway/troubleshooting.md#readyz-answers-503) |
| Access `/readyz` stays `503 not-ready` | [Access outages](../access/troubleshooting.md#decision-timeouts-and-outages), [start refusals](../access/troubleshooting.md#start-refusals) |
| Data `/readyz` stays `503` | [Data 503 on readiness](../data/troubleshooting.md#503-on-readiness) |
| The console's status board shows a service down | [console probes and logs](../console/operations.md#probes-and-logs) |
| A request ID is missing from one service's logs | [Gateway start here](../gateway/troubleshooting.md#start-here), [Data gateway answers 502](../data/troubleshooting.md#gateway-answers-502) |

## Related

- [Platform operations: probes](../platform/operations.md#probes)
- [Gateway monitoring](../gateway/operations.md#monitoring)
- [Access monitoring](../access/operations.md#monitoring)
- [Data alarms](../data/operations.md#alarms)
- [Console probes and logs](../console/operations.md#probes-and-logs)
- [Troubleshoot a request](troubleshoot-a-request.md)
- [Respond to an incident](respond-to-an-incident.md)
- [Rotate secrets](rotate-secrets.md)
