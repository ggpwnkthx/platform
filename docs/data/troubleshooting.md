# Troubleshooting

Data service failures by symptom, each with likely causes and fixes. For alarms and metrics, see
[Operations](operations.md).

## 401 UNAUTHENTICATED

The request didn't come through the gateway, or the signature doesn't match the request.

- **Wrong signature version.** The header is `x-gateway-signature` and its value starts with the
  binding's version: `v5=` for a current-format route. Another version is refused, with no fallback.
- **Wrong key in the binding.** It must be the gateway's **public** P-256 key in PEM
  (`publicKeyFile`). A legacy route names the gateway's derived key
  (`HMAC-SHA256(GATEWAY_SESSION_SECRET, "gateway-identity-signature-v1")`) in `identityKeyFile`, and
  the backend refuses a PEM there.
- **Gateway signs with another key.** The gateway signs with its pair's private key
  (`GATEWAY_IDENTITY_SIGNING_KEY`), which the backend never holds; any other key is refused.
- **Path rewritten after the gateway.** The signature covers the path and query **as the upstream
  received them**, so a proxy rewriting the path breaks it. The binding's path must be the path the
  gateway forwards.
- **Workspace mismatch.** The path's workspace must equal the signature's; a gateway that rewrites
  the workspace path breaks it.
- **Host mismatch.** The binding's host is the authority the gateway signs, including the port if
  any.

## 403 FORBIDDEN

The access service refused the principal's context, or the principal lacks a capability for the
collection.

- **Wrong access service credentials.** They must be the access context contract's credentials,
  scoped to the deployment's tenants.
- **Grant doesn't match.** The principal's grant must match the request's workspace and route. The
  route is the binding's `routeId`, not the collection ID.
- **Recent revocation.** Access service answers aren't cached by default, so a revocation applies on
  the next request.
- **Search on a hidden field.** Searching a field a policy hides is also `403`.

## 404 NOT_FOUND for an existing workspace

- **Workspace disabled.** `bun run scripts/cli/workspace.ts list` shows the registry state.
- **Tenant mismatch.** A binding with `expectedTenantId` refuses workspaces of other tenants.
- **Registry reader sees nothing.** The `DATA_REGISTRY_DATABASE_URL` credential may have lost read
  access to the registry's five columns.
- **Collection not registered.** A workspace that registered anything serves exactly its registered
  collections.

## 503 AUTHORIZATION_UNAVAILABLE

The access service is unavailable or doesn't speak the contract version.

- **Access service too old.** It must be at a revision with the extension; one before `4cedcfc`
  doesn't answer `/v1/access-context`. The baseline revision is in `compatibility.json`.
- **Wrong credential.** The access context credential must be the deployment's, scoped to the
  workspace's tenant.
- **Clock skew.** The two servers' clocks must agree within a second; an answer evaluated in the
  future is refused.

## 503 DATABASE_UNAVAILABLE

- **Role too powerful.** The connection role may not be a superuser or have `BYPASSRLS`.
- **Pool exhausted.** `data_db_pool_waits_total` grows.
- **Statement timeout too short** for a slow query.
- **Database unreachable.** The response reflects the dependency, not an internal error.

## 429 TOO_MANY_REQUESTS

- **Tenant at its share.** The response carries `Retry-After: 1`; the caller must slow down.
- **Bound setting.** `DATA_MAX_IN_FLIGHT_REQUESTS_PER_TENANT` sets it. Unset, it defaults to the
  whole process's bound (see [Configuration](configuration.md)), so a single-tenant deployment
  doesn't need it.
- **Frequent refusals.** `data_tenant_overload_total` counts them; a tenant refused often is sending
  too much. When the whole process is full, the listener answers `503 OVERLOADED` instead.

## 409 CONFLICT

- **Row lock not granted in time.** Another transaction holds the row. The record's current state
  conflicts; read it again before writing.
- **Unique constraint violated.** Two writes of the same record raced and one won.
- **Operation already running.** The response is `409 OPERATION_IN_PROGRESS` with `Retry-After: 1`;
  retry with the same body and idempotency key.

## 422 RESULT_TOO_LARGE

The response exceeds four mebibytes, or a relation expansion exceeds its budget.

- **Fix:** ask for fewer fields, a smaller page or a narrower expansion.
- The budget isn't configurable; it is part of the release contract.

## 412 PRECONDITION_FAILED on a write

The record changed since its validator was issued. Read the record again and reapply the change to
the new version.

A write that returns 412 in a loop means the client keeps a stale validator: the validator is the
digest of the canonical representation and changes on every write.

## 409 IDEMPOTENCY_CONFLICT on a creation

The key was used with a different body. A key is scoped to principal, tenant, workspace, route and
endpoint; the same key in another scope is a different key.

If the same key is in use at that moment, the creation answers `409 OPERATION_IN_PROGRESS` with
`Retry-After: 1`; retry with the same body and key.

## Deliveries don't run

- **Subscriber not registered** in the deployment: its delivery fails rather than being acknowledged.
- **Worker lacks permission.** The worker's service principal must hold the subscriber's permission;
  otherwise the handler's fresh context request is refused.
- **Event chain deeper than ten.** The delivery fails.

`bun run scripts/cli/delivery.ts list` shows delivery state, and
`bun run scripts/cli/delivery.ts requeue --event <uuid> --subscriber <id> --actor <name>` requeues
one with attribution.

## Readiness answers 503

The response gives the reason: connection role, migrations, access service or delivery store. A
migration changed after it was applied is drift; fix it with a new migration, never by editing the
old one.

## Audit log is empty

- **Missing permission.** Without `data.audit.read`, the endpoint answers `403`.
- **Wrong scope.** The audit log is read in the workspace's scope, inside a scoped transaction like
  every other read.

## Workspace model doesn't change

- **Missing permission.** Without `data.model.write`, a model write answers `403`.
- **No such column.** The field must name a column of the collection's table. The deployment owns
  the tables and the model never creates one; the response names the missing column.
- **Type mismatch.** The model can't change a field's type: it always follows the column.
- **Stale model.** If the model changed since it was read, the write answers `409`; read it again.

## Gateway answers 502

The backend returned an error the gateway doesn't understand, or the connection closed. The backend
log holds the gateway's request ID, which correlates both sides.
