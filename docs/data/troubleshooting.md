# Troubleshooting

Data failures listed by the symptom you see, with the likely cause, what to check and how to fix it. It is for operators and developers; alarms and metrics are in [Operations](operations.md#alarms), and every error code is in [spec §9.7](spec.md#97-errors).

## Startup fails with "the environment is invalid"

The configuration check found one or more bad variables and lists them all in that one message. Each entry names the variable and the reason, for example a missing `DATA_CURSOR_KEY_FILE`, a cursor key shorter than 32 bytes, or a production `DATA_ACCESS_URL` without `https`. Fix every entry, then restart. The rules for each variable are in [Configuration](configuration.md).

## 401 UNAUTHENTICATED

The request did not come through the gateway, or its signature does not match the binding ([spec §4](spec.md#4-gateway-trust-contract)).

| Check | Fix |
| --- | --- |
| `x-gateway-signature` starts with the binding's version (`v5=` for a current route). | Align gateway and binding; no other version is accepted. |
| The binding's `publicKeyFile` holds the gateway's **public** P-256 key in PEM. A legacy route's `identityKeyFile` holds the derived key; a PEM there is refused. | Put the right key in the binding ([Leave the legacy identity format](operations.md#leave-the-legacy-identity-format)). |
| The gateway signs with the pair's private key (`GATEWAY_IDENTITY_SIGNING_KEY`). | Give Data the matching public key. |
| A proxy after the gateway rewrites the path or query. | The signature covers them as received; make the binding's path the one the gateway forwards. |
| The path's workspace equals the signature's. | Stop rewriting the workspace path. |
| The binding's `host` is the authority the gateway signs, port included. | Correct `host`. |

## 403 FORBIDDEN

Access refused the context, or the principal lacks a capability ([spec §8](spec.md#8-data-authorization)).

| Check | Fix |
| --- | --- |
| The Access credential is the access context contract's, scoped to the deployment's tenants. | Replace `DATA_ACCESS_CONTEXT_TOKEN_FILE`. |
| The grant matches the workspace and the route; the route is the binding's `routeId`, not the collection. | Grant the right route in Access. |
| A grant was just revoked. | Expected: answers are not cached by default, so a revocation applies on the next request. |
| The request searches a field a policy hides. | Search visible fields only. |
| Audit reads lack `data.audit.read`, or model writes lack `data.model.write`. | Grant the permission. |

## 404 NOT_FOUND for an existing workspace

| Check | Fix |
| --- | --- |
| `bun run scripts/cli/workspace.ts list` shows it disabled. | `bun run scripts/cli/workspace.ts enable --id <uuid>`, if it should serve. |
| A binding with `expectedTenantId` names another tenant. | Correct the binding or the tenant. |
| The `DATA_REGISTRY_DATABASE_URL` role can still read the registry's five columns. | Restore its `SELECT` on them. |
| The workspace registered some collections, but not this one. | Register it with `bun run collection -- register` ([Modeling](modeling.md#choose-the-collections-a-workspace-serves)). |

## 503 AUTHORIZATION_UNAVAILABLE

Access is down or does not speak the contract version ([spec §5](spec.md#5-access-context-contract)).

| Check | Fix |
| --- | --- |
| Access answers `/v1/access-context`. Revisions before `4cedcfc` do not; the baseline revision is in `compatibility.json`. | Upgrade Access. |
| The context credential is the deployment's, scoped to the workspace's tenant. | Rotate both sides ([Operations](operations.md#rotating-secrets)). |
| The servers' clocks agree within a second; an answer evaluated in the future is refused. | Fix time synchronization. |

## 503 DATABASE_UNAVAILABLE

| Check | Fix |
| --- | --- |
| The connection role is a superuser or has `BYPASSRLS`. | Use `data_runtime`. |
| `data_db_pool_waits_total` grows. | Raise `DATA_DB_POOL_MAX` or find the slow queries. |
| A slow query hits `DATA_DB_STATEMENT_TIMEOUT_MS`. | Add an index or raise the timeout ([Configuration](configuration.md#budgets)). |
| The database is unreachable. | Restore connectivity; the code names the dependency, not an internal error. |

## 503 on readiness

The answer's `reason` names the failing part: connection role, migrations, Access or delivery store. A migration edited after it was applied is drift: revert the edit and write a new migration ([Operations](operations.md#migrations-and-drift)).

## 429 TOO_MANY_REQUESTS

A tenant used its whole share of `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT`, which defaults to the process bound, so single-tenant deployments need not set it. The answer carries `Retry-After: 1`, and the caller must slow down. `data_tenant_overload_total` shows how often tenants are refused. When the whole process is full, the listener answers `503 OVERLOADED` instead.

## 409 conflicts

| Code or cause | Fix |
| --- | --- |
| A row lock was not granted in time, or a unique constraint lost a race. | Read the record again, then write. |
| `409 OPERATION_IN_PROGRESS` with `Retry-After: 1`: the same key is still running. | Retry with the same body and idempotency key. |
| `409 IDEMPOTENCY_CONFLICT`: the key was used with another body. A key is scoped to principal, tenant, workspace, route and endpoint. | Use a new key for a new body ([spec §9.6](spec.md#96-creation-and-idempotency)). |
| A model write after the model changed. | Read the model again. |

## 412 PRECONDITION_FAILED on a write

The record changed after its validator was issued. Read it again and reapply the change. A loop of `412` answers means the client caches a stale validator: the validator is the digest of the canonical representation and changes on every write ([spec §9.4](spec.md#94-reads-and-validators)).

## 422 RESULT_TOO_LARGE

The answer passed four mebibytes, or a relation expansion passed its budget. Ask for fewer fields, a smaller page or a narrower expansion. The budget is part of the release contract and is not configurable.

## Workspace model does not change

| Check | Fix |
| --- | --- |
| The field names a column of the collection's table (the error names a missing one). | Add the column with a migration; the model never creates one. |
| The write changes a field's type. | Not possible: the type follows the column. |

## Audit log is empty

The audit is read in the workspace's scope, inside a scoped transaction like other reads. Check that you read the right workspace and hold `data.audit.read`.

## Deliveries do not run

| Check | Fix |
| --- | --- |
| The subscriber is registered in this deployment; otherwise its delivery fails. | Register it, then requeue. |
| The worker's service principal holds the subscriber's permission; otherwise its fresh context is refused. | Grant it in Access. |
| The event chain is deeper than ten. | Expected: the depth bound fails it. Stop subscribers from triggering each other. |

Inspect and requeue with `scripts/cli/delivery.ts` ([Operations](operations.md#failed-deliveries)).

## Gateway answers 502

Data returned something the gateway does not understand, or the connection closed. Find the gateway's request ID in the Data log to correlate both sides.
