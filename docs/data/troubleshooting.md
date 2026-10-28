# Troubleshooting

Data service failures by symptom: what to check and how to fix it. Alarms and metrics are in
[Operations](operations.md#alarms); every error code is listed in [API](api.md#error-codes).

## 401 UNAUTHENTICATED

The request didn't come through the gateway, or its signature doesn't match. See
[spec §4](spec.md#4-gateway-trust-contract).

| Check | Fix |
| --- | --- |
| `x-gateway-signature` starts with the binding's version (`v5=` for a current route). | Align gateway and binding; no other version is accepted. |
| The binding's `publicKeyFile` holds the gateway's **public** P-256 key in PEM. A legacy route's `identityKeyFile` holds the derived key; a PEM there is refused. | Put the right key in the binding ([Getting started](getting-started.md#migrating-from-the-shared-key)). |
| The gateway signs with the pair's private key (`GATEWAY_IDENTITY_SIGNING_KEY`). | Give the backend the matching public key. |
| A proxy after the gateway rewrites the path or query. | The signature covers them as received; make the binding's path the one the gateway forwards. |
| The path's workspace equals the signature's. | Stop rewriting the workspace path. |
| The binding's `host` is the authority the gateway signs, port included. | Correct `host`. |

## 403 FORBIDDEN

The access service refused the context, or the principal lacks a capability. See
[spec §8](spec.md#8-data-authorization).

| Check | Fix |
| --- | --- |
| The access service credential is the access context contract's, scoped to the deployment's tenants. | Replace `DATA_ACCESS_CONTEXT_TOKEN_FILE`. |
| The grant matches the workspace and the route; the route is the binding's `routeId`, not the collection. | Grant the right route at the access service. |
| A grant was just revoked. | Expected: answers aren't cached by default, so revocation applies on the next request. |
| The request searches a field a policy hides. | Search visible fields only. |
| Audit reads lack `data.audit.read`, or model writes lack `data.model.write`. | Grant the permission. |

## 404 NOT_FOUND for an existing workspace

| Check | Fix |
| --- | --- |
| `bun run scripts/cli/workspace.ts list` shows it disabled. | `bun run scripts/cli/workspace.ts enable --id <uuid>`, if it should serve. |
| A binding with `expectedTenantId` names another tenant. | Correct the binding or the tenant. |
| The `DATA_REGISTRY_DATABASE_URL` role can still read the registry's five columns. | Restore its `SELECT` on them. |
| The workspace registered some collections, but not this one. | `bun run collection -- register` ([Operations](operations.md#workspace-catalog)). |

## 503 AUTHORIZATION_UNAVAILABLE

The access service is down or doesn't speak the contract version
([spec §5](spec.md#5-access-context-contract)).

| Check | Fix |
| --- | --- |
| The access service answers `/v1/access-context`. Revisions before `4cedcfc` don't; the baseline revision is in `compatibility.json`. | Upgrade the access service. |
| The context credential is the deployment's, scoped to the workspace's tenant. | Rotate both sides ([Operations](operations.md#rotating-secrets)). |
| The servers' clocks agree within a second; an answer evaluated in the future is refused. | Fix time sync. |

## 503 DATABASE_UNAVAILABLE

| Check | Fix |
| --- | --- |
| The connection role is a superuser or has `BYPASSRLS`. | Use `data_runtime`. |
| `data_db_pool_waits_total` grows. | Raise `DATA_DB_POOL_MAX` or find slow queries. |
| A slow query hits `DATA_DB_STATEMENT_TIMEOUT_MS`. | Add an index or raise the timeout ([Configuration](configuration.md#budgets)). |
| The database is unreachable. | Restore connectivity; the code reports the dependency, not an internal error. |

## 503 on readiness

The response names the failing part: connection role, migrations, access service or delivery store.
A migration edited after being applied is drift: revert the edit and write a new migration.

## 429 TOO_MANY_REQUESTS

A tenant used its whole share of `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT` (default: the process
bound, so single-tenant deployments needn't set it). The answer carries `Retry-After: 1`; the caller
must slow down. `data_tenant_overload_total` shows who is refused often. When the whole process is
full, the listener answers `503 OVERLOADED` instead.

## 409 conflicts

| Code or cause | Fix |
| --- | --- |
| Row lock not granted in time, or a unique constraint lost a race. | Read the record again, then write. |
| `409 OPERATION_IN_PROGRESS` with `Retry-After: 1`: the same key is still running. | Retry with the same body and idempotency key. |
| `409 IDEMPOTENCY_CONFLICT`: the key was used with another body. A key is scoped to principal, tenant, workspace, route and endpoint. | Use a new key for a new body ([API](api.md#creation-and-idempotency)). |
| Model write after the model changed. | Read the model again. |

## 412 PRECONDITION_FAILED on a write

The record changed since its validator was issued. Read it again and reapply the change. A loop of
`412`s means the client caches a stale validator: it is the digest of the canonical representation
and changes on every write ([API](api.md#reads-and-validators)).

## 422 RESULT_TOO_LARGE

The response passed four mebibytes, or a relation expansion passed its budget. Ask for fewer fields, a
smaller page or a narrower expansion. The budget is part of the release contract, not configurable.

## Workspace model doesn't change

| Check | Fix |
| --- | --- |
| The field names a column of the collection's table (the answer names a missing one). | Add the column with a migration; the model never creates one. |
| The write changes a field's type. | Not possible: the type follows the column. |

## Audit log is empty

Audit is read in the workspace's scope, inside a scoped transaction like other reads. Check you are
reading the right workspace and hold `data.audit.read`.

## Deliveries don't run

| Check | Fix |
| --- | --- |
| The subscriber is registered in this deployment; otherwise its delivery fails. | Register it, then requeue. |
| The worker's service principal holds the subscriber's permission, or its fresh context is refused. | Grant it at the access service. |
| The event chain is deeper than ten. | Expected: the depth bound fails it. Stop subscribers from triggering each other. |

Inspect and requeue with `scripts/cli/delivery.ts`
([Operations](operations.md#failed-deliveries)). Claim rules:
[spec §11.5](spec.md#115-claim-retry-and-replay).

## Gateway answers 502

The backend returned something the gateway doesn't understand, or the connection closed. Find the
gateway's request ID in the backend log to correlate both sides.
