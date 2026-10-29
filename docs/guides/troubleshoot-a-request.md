# Troubleshoot a request

Follow one failing request across the platform: read what came back, work out which service produced it, trace it through the logs by its request ID, and jump to the troubleshooting entry that fixes it. Developers start here when a call fails ([developer](../roles/developer.md)); operators start here when a user reports a request ID ([sysops](../roles/sysops.md)).

## Before you start

| You need | Why |
| --- | --- |
| The full response: status line, headers and body (`curl -i`, the browser's network panel, or the console's refusal panel) | The status alone is ambiguous: several services use the same numbers |
| Read access to the gateway, Access and Data logs | Each service logs the reason it never sends to the caller |
| The metrics token for each service, if you want counters | `/metrics` answers `404` or `401` without it |
| `platformctl` with a profile for the deployment (optional) | `status`, `doctor` and `access decide` shorten the search ([CLI usage](../cli/usage.md#write-your-first-profile)) |

## Steps

### 1. Capture the answer and its request ID

Every gateway answer carries `x-request-id`, and the same ID is on every gateway log line of that request. Copy it together with the status, the body and any `retry-after` header.

You can choose the ID yourself when you reproduce the problem: the gateway keeps a caller's `x-request-id` when it matches `^[A-Za-z0-9._-]{1,64}$` and replaces anything else with a UUID ([gateway spec §2.1](../gateway/spec.md#21-request-id)). The CLI sends one with `--request-id`:

```bash
curl -s -i -H 'x-request-id: repro-001' "https://api.example.com/ws/<workspace>/v1/me" -H "cookie: $SESSION"
platformctl --request-id repro-002 --verbose data me
```

When the console refuses something, its page shows the status, the code, the message and the request ID ([console user guide](../console/user-guide.md#create-and-edit-a-record)).

### 2. Find which service answered

Read the body before the status. Each service has its own error shape, and the gateway forwards an upstream's body untouched ([gateway spec §2.3](../gateway/spec.md#23-dispatcher)):

| Body | Answered by | Codes are listed in |
| --- | --- | --- |
| `{"error": "no_route", "message": "…"}`: a string `error`, lower-case code | The gateway itself | [gateway spec §2.5](../gateway/spec.md#25-response-codes) |
| `{"error": {"code": "FORBIDDEN", "message": "…"}, "requestId": "…"}`: an object `error`, upper-case code | Data, forwarded by the gateway | [data spec §9.7](../data/spec.md#97-errors) |
| Empty, with status `499` | Nobody: the caller left before the headers | [gateway spec §11.3](../gateway/spec.md#113-failures-and-what-the-caller-sees) |
| Any other shape | Another upstream, forwarded unchanged | That service's own docs |
| A login page with a status and a code, on Access's address | Access, during sign-in | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| `{"error": "<code>", "message": "…"}` from Access's own address | Access administration or a contract endpoint, called directly | [Access troubleshooting](../access/troubleshooting.md#administration-refusals) |
| A message on standard error and an exit status | The CLI, reporting a service's refusal | [CLI spec §6.2](../cli/spec.md#62-exit-status) |

An Access decision never reaches the caller as such: the gateway turns it into its own `403 workspace_forbidden` or `503 access_unavailable` and keeps the reason out of the answer ([gateway spec §6](../gateway/spec.md#6-workspace-access)).

### 3. Trace the request through the logs

1. Search the gateway logs for the request ID. The line names the route, the caller's subject, the workspace and the trace ID ([gateway spec §12.2](../gateway/spec.md#122-logs)).
2. The gateway sends the upstream a `traceparent` with that trace ID, so an upstream that logs trace context can be searched with it ([gateway spec §7.5](../gateway/spec.md#75-trace-context)).
3. For Data, look up the gateway's request ID in the Data log ([Data troubleshooting: gateway answers 502](../data/troubleshooting.md#gateway-answers-502)). A Data error body also carries `requestId`, the identifier Data's own log lines use ([data spec §15.2](../data/spec.md#152-logs)).
4. For a `403 workspace_forbidden`, read Access's decision log line for the same subject, workspace and route: it holds the reason and its code ([Access troubleshooting: decisions denied](../access/troubleshooting.md#decisions-denied)).

If the gateway logs have no line for the ID, the request never reached the gateway, or it reached it with a malformed ID that was replaced: check the ingress first.

### 4. Check the services' health

Rule out an outage before you debug one request:

```bash
platformctl status          # health and readiness of the services in the profile; --watch repeats every 5 s
platformctl doctor          # also checks the profile and your credential
```

Both end with exit status `7` when a service does not answer ([CLI spec §5.1](../cli/spec.md#51-root-commands)). Without the CLI, read each service's `/readyz` body: the gateway reports its route table and session store ([gateway spec §12.3](../gateway/spec.md#123-reload-and-readiness)), and Data gives a `reason` ([data spec §15.1](../data/spec.md#151-probes-and-metrics)). The console's **Status** page shows the same probes ([console user guide](../console/user-guide.md#read-service-status)).

### 5. Ask Access the gateway's question

For any refusal that involves a caller's rights, ask Access directly with the subject, workspace and route from the gateway's log line. A denial ends with exit status `6`:

```bash
platformctl access decide --subject <principal id> --workspace <workspace uuid> --route <route id>
```

### 6. Look the answer up

Find the status and code in this table, then follow the link. Codes in lower case come from the gateway, codes in upper case from Data.

| Status and code | What it usually means | Go to |
| --- | --- | --- |
| `302` to `/auth/login` | A browser without a valid session on a route that accepts one | [gateway spec §5.2](../gateway/spec.md#52-browser-flow) |
| `400 bad_request` | The workspace placeholder is missing or not a UUID | [Gateway troubleshooting](../gateway/troubleshooting.md#400-bad_request-on-a-workspace-route) |
| `400 login_failed` | The login callback could not complete | [Gateway troubleshooting](../gateway/troubleshooting.md#the-login-callback-answers-400-login_failed) |
| `400 INVALID_QUERY`, `INVALID_REQUEST`, `INVALID_CURSOR`, `INVALID_PRECONDITION` | Data refused the query, body, cursor or `if-match` | [data spec §9.3](../data/spec.md#93-query-parameters-and-filters), [§9.4](../data/spec.md#94-reads-and-validators), [§9.5](../data/spec.md#95-lists-and-cursors) |
| `401 unauthorized` | No valid credential for the route's mode | [Gateway troubleshooting](../gateway/troubleshooting.md#401-unauthorized) |
| `401 UNAUTHENTICATED` | Data could not verify the gateway's signature, or the call bypassed the gateway | [Data troubleshooting](../data/troubleshooting.md#401-unauthenticated) |
| `403 workspace_forbidden` | Access denied the caller the workspace on this route | [Gateway troubleshooting](../gateway/troubleshooting.md#403-workspace_forbidden), [Access: decisions denied](../access/troubleshooting.md#decisions-denied) |
| `403 cross_site_request` | A request with the session cookie came from a site that is not allowed | [Gateway troubleshooting](../gateway/troubleshooting.md#browser-requests-get-403-cross_site_request) |
| `403 FORBIDDEN` | The gateway let the caller in, but Data's context or policies refuse the action | [Data troubleshooting](../data/troubleshooting.md#403-forbidden) |
| `403 identity_unknown` and other login-page codes | Access refused the sign-in | [Access troubleshooting](../access/troubleshooting.md#failed-logins) |
| `404 no_route` | No route matches the host, path and method | [Gateway troubleshooting](../gateway/troubleshooting.md#404-no_route-on-every-request) |
| `404 not_found` | The path is reserved by the gateway | [Gateway troubleshooting](../gateway/troubleshooting.md#404-not_found-on-a-path-that-should-be-forwarded) |
| `404 NOT_FOUND` | Unknown or disabled workspace, a collection the workspace does not serve, or a record out of reach | [Data troubleshooting](../data/troubleshooting.md#404-not_found-for-an-existing-workspace) |
| `409 CONFLICT`, `IDEMPOTENCY_CONFLICT`, `OPERATION_IN_PROGRESS`, `CURSOR_STALE` | A concurrent write, a reused key, a create still running, or an outdated cursor | [Data troubleshooting](../data/troubleshooting.md#409-conflicts) |
| `409` from the control plane | Stale `If-Match`, or a protected route | [Gateway troubleshooting](../gateway/troubleshooting.md#control-plane) |
| `412 PRECONDITION_FAILED` | The record changed after you read its `etag` | [Data troubleshooting](../data/troubleshooting.md#412-precondition_failed-on-a-write) |
| `413 payload_too_large` | The body is over the route's limit | [Gateway troubleshooting](../gateway/troubleshooting.md#413-payload_too_large) |
| `422 VALIDATION_FAILED`, `INVALID_REFERENCE` | The record does not fit the manifest, or a reference is not readable | [data spec §9.7](../data/spec.md#97-errors) |
| `422 RESULT_TOO_LARGE` | The page or its expansions passed Data's budget | [Data troubleshooting](../data/troubleshooting.md#422-result_too_large) |
| `422` from the control plane | The route table is invalid | [Gateway troubleshooting](../gateway/troubleshooting.md#control-plane) |
| `428 PRECONDITION_REQUIRED` | An update, delete or rollback without `if-match` | [data spec §9.4](../data/spec.md#94-reads-and-validators) |
| `429 too_many_requests` | A gateway rate limit; wait for `retry-after` | [Gateway troubleshooting](../gateway/troubleshooting.md#429-too_many_requests) |
| `429 TOO_MANY_REQUESTS` | The tenant used its share of Data's concurrent requests | [Data troubleshooting](../data/troubleshooting.md#429-too_many_requests) |
| `500 internal_error` | The subject cannot be written to a header | [Gateway troubleshooting](../gateway/troubleshooting.md#500-internal_error) |
| `500 INTERNAL_ERROR` | A Data defect; report it with the request ID | [data spec §9.7](../data/spec.md#97-errors) |
| `502 bad_gateway` | The upstream was unreachable, refused TLS, or broke the exchange | [Gateway troubleshooting](../gateway/troubleshooting.md#502-bad_gateway), [Data troubleshooting](../data/troubleshooting.md#gateway-answers-502) |
| `503 not_ready` | The gateway never loaded a route table | [Gateway troubleshooting](../gateway/troubleshooting.md#every-request-gets-503-not_ready) |
| `503 gateway_overloaded` | Admission or the exchange cap is full, usually behind a slow dependency | [Gateway troubleshooting](../gateway/troubleshooting.md#503-gateway_overloaded) |
| `503 access_unavailable` | The gateway could not get a decision from Access | [Gateway troubleshooting](../gateway/troubleshooting.md#503-access_unavailable), [Access: outages](../access/troubleshooting.md#decision-timeouts-and-outages) |
| `503 identity_provider_unavailable`, `session_store_unavailable` | Sign-in cannot reach the provider or store the session | [Gateway troubleshooting](../gateway/troubleshooting.md#logins-fail-with-503) |
| `503 AUTHORIZATION_UNAVAILABLE` | Data could not get a usable access context from Access | [Data troubleshooting](../data/troubleshooting.md#503-authorization_unavailable) |
| `503 DATABASE_UNAVAILABLE` | Data cannot reach its database or registry | [Data troubleshooting](../data/troubleshooting.md#503-database_unavailable) |
| `503 OVERLOADED`, `DRAINING` | The Data process is full, or shutting down | [Data configuration: budgets](../data/configuration.md#budgets), [Data operations: drain](../data/operations.md#drain) |
| `504 gateway_timeout` | The upstream sent no headers within the route's `responseMs` | [Gateway troubleshooting](../gateway/troubleshooting.md#504-gateway_timeout) |
| `504 DEADLINE_EXCEEDED` | A Data statement ran over its budget | [Data troubleshooting](../data/troubleshooting.md#503-database_unavailable) |

Two pairs are easy to confuse. A `403 workspace_forbidden` comes before the request reaches Data: Access found no live grant for that workspace and route, or the principal or tenant is disabled. A `403 FORBIDDEN` comes from Data, often for a caller who does hold a grant whose permission keys no policy maps to the requested action ([data spec §2.3](../data/spec.md#23-invariants)). And with default settings, the gateway gives up on an upstream after 5 seconds while Data allows a request 10 seconds (`DATA_REQUEST_TIMEOUT_MS`), so a slow Data call usually surfaces as the gateway's `504 gateway_timeout`.

## Check that it worked

1. Send the same request again with a fresh `x-request-id` and confirm the status you expect.
2. Find that ID in the gateway log and, for Data routes, in the Data log, with no refusal line.
3. Watch the counter that matched the symptom stop rising, for example `gateway_auth_failures_total`, `gateway_access_unavailable_total` or `data_authorization_denials_total` ([Gateway troubleshooting: start here](../gateway/troubleshooting.md#start-here), [Data operations: metrics](../data/operations.md#metrics)).
4. `platformctl doctor` ends with exit status `0`.

## If something goes wrong

| Symptom | Look here |
| --- | --- |
| No gateway log line carries the request ID | [Gateway operations: ingress](../gateway/operations.md#ingress) |
| The status is not in the table above | [gateway spec §2.5](../gateway/spec.md#25-response-codes), [data spec §9.7](../data/spec.md#97-errors), [Access troubleshooting](../access/troubleshooting.md) |
| `platformctl` refuses before sending anything | [CLI usage: when something refuses](../cli/usage.md#when-something-refuses) |
| A WebSocket closes with `1008` or `1001` | [Gateway troubleshooting: connections close](../gateway/troubleshooting.md#connections-close-unexpectedly) |
| Every caller fails at once | [Monitor the platform](monitor-the-platform.md), [Respond to an incident](respond-to-an-incident.md) |

## Related

- [Gateway troubleshooting](../gateway/troubleshooting.md)
- [Access troubleshooting](../access/troubleshooting.md)
- [Data troubleshooting](../data/troubleshooting.md)
- [CLI specification](../cli/spec.md)
- [Platform overview: a request, end to end](../platform/README.md#a-request-end-to-end)
- [Put a service behind the gateway](put-a-service-behind-the-gateway.md)
- [Build an app on Data](build-an-app-on-data.md)
- [Monitor the platform](monitor-the-platform.md)
