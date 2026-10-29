# Troubleshooting

Symptom-first help for Access: find what you see, then the likely cause, how to check it and how to fix it. It is written for operators and developers; each entry links to the rule in the [specification](spec.md), and the alerts that lead here are in [Operations](operations.md#monitoring).

Every answer carries `x-request-id`, and every log line carries the same id: search the service log for it first. Decision reasons, login refusal reasons and the refused `(tenant, subject)` are in the log, never in the answer the caller sees (§12.3).

## Failed logins

A refused login ends on a page served by Access with a status and an error code. The rules are in §5.6.

| You see | Likely cause | Check | Fix |
| --- | --- | --- | --- |
| `400 invalid_request` on `/oauth/authorize`, and the browser stays on the Access page | The `redirect_uri` is not one of the tenant's `clientRedirectUris`, the `client_id` names no tenant, or a parameter is wrong (§5.2). A tenant with no registered URL refuses every login. | Compare `GATEWAY_OIDC_CLIENT_ID` and `GATEWAY_OIDC_REDIRECT_URI` with the tenant's `clientId` and `clientRedirectUris`; the answer of [`POST /v1/admin/tenants`](api.md#post-v1admintenants) lists both. | Re-send the tenant with the gateway's exact callback URL in `clientRedirectUris`. |
| `403 tenant_disabled` | The tenant has `enabled = false` (§3.1). | `curl -sS $ACCESS/v1/admin/tenants -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"` and read `enabled`. | Re-send the tenant with `"enabled": true`. |
| `502 upstream_unavailable`, the page names one tenant | That tenant's provider is unreachable, slower than `ACCESS_IDP_TIMEOUT_MS`, answers more than one MiB, or resolves to a private address in production (§6.1). | `curl -sS -o /dev/null -w '%{http_code}\n' https://login.acme.example/.well-known/openid-configuration`, also from a pod. | Wait: other tenants work, and logins resume once the provider is back (caches last ten minutes). Don't raise `ACCESS_IDP_TIMEOUT_MS` (5 s). |
| `403 provider_error` | The provider's discovery document is not JSON or lacks `issuer`, `authorization_endpoint`, `token_endpoint` or `jwks_uri`. | Fetch `{issuer}/.well-known/openid-configuration` and read it. | Fix the provider, or register the right `issuer`. |
| `403 identity_rejected` | The provider token failed a check of §6.1: issuer not exactly `idp_issuer` (a trailing slash counts), wrong audience, nonce, algorithm or signature, clock outside `ACCESS_CLOCK_SKEW_SECONDS`, or an empty `sub`. A discovery document naming another issuer is refused the same way. | The service log names the failed check for the request id. | Correct `issuer`, `idpClientId` or `idpAlgorithms` in the tenant registration, or fix the clock of the host that drifted. |
| `403 identity_unknown` | No principal exists for `(tenant, subject)` and the tenant does not auto-provision. | See [Unknown identity](#unknown-identity). | Register the principal. |
| `403 principal_disabled` | The principal's `status` is `disabled` (§3.2). | `curl -sS "$ACCESS/v1/admin/users?tenant=acme&status=disabled" -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"` | Re-send the principal with `"status": "active"` ([`POST /v1/admin/users`](api.md#post-v1adminusers)). |
| `400 login_state_invalid` | The state cookie is missing, expired (it lives ten minutes), already used, unreadable, or its `state` does not match (§5.3). Replicas with different `ACCESS_STATE_SECRET` values cannot read each other's cookies, and changing the secret drops in-flight logins. | Is `ACCESS_STATE_SECRET` the same on every replica? Did the login take longer than ten minutes? Does the browser keep the cookie on `/oauth/tenant/callback`? | Start a new login. Give every replica the same state secret. |
| `500 internal_error` | An unexpected failure; the answer never carries a dependency's error. | The service log for the request id. | Fix what the log names. |
| Logins fail at the exchange; decisions work | The shared store is down, so codes cannot be stored or read (§5.5). | `redis-cli -u "$ACCESS_REDIS_URL" ping` | Restore the store; callers retry. Only a single node may set `ACCESS_ALLOW_MEMORY_STATE=true` (codes die with the process). |
| The gateway's code exchange gets `400 invalid_grant` | The code was already used, is older than 60 s, or was exchanged with another client, redirect URI or PKCE verifier (§5.5). Several replicas on process memory each hold their own codes. | The gateway log for a retried exchange; whether more than one replica runs without `ACCESS_REDIS_URL`. | Give replicas a shared store; make the gateway send the same redirect URI it used at `/oauth/authorize`. |
| The gateway's code exchange gets `401 invalid_client` | `GATEWAY_OIDC_CLIENT_SECRET` is not the tenant's `clientSecret`, or a rotation's 24-hour window has closed (§4.3.1). | Compare the two values (§13.2). | Send the gateway's secret as `clientSecret`, or update the gateway. |
| One tenant's logins fail right after registration | A wrong issuer, client id or redirect URI in the registration; the provider client is cached ten minutes (§6.6). | `curl -sS $ACCESS/v1/admin/tenants -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"` | Repeat the [create call](api.md#post-v1admintenants) with the right values; wait ten minutes or roll for the cache. A client id owned by another tenant gets `409 conflict`. |

## Unknown identity

**You see** `403 identity_unknown`, with a page saying the identity is not known to the platform.

**Cause.** Access maps a login by `(tenant, subject)`, where the subject is the provider's `sub` (§6.2). No principal holds that pair, and the tenant has `autoProvision: false` (§6.4). Common reasons:

- the principal was registered with its e-mail as `externalSubject`; the e-mail is never a key (§6.3);
- the principal was registered under another tenant than the one the login resolved to (§5.2);
- the provider's `sub` changed, for example after the provider was replaced; two subjects are two principals (§14).

**Check.** The log line of the refusal carries the refused `(tenant, subject)`. List the tenant's principals and look for that `externalSubject`:

```bash
curl -sS "$ACCESS/v1/admin/users?tenant=acme" -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

**Fix.** Register the principal with the provider's `sub` as `externalSubject` ([`POST /v1/admin/users`](api.md#post-v1adminusers)), then give it grants. Turning on `autoProvision` creates principals at first login, but with no grant: the login succeeds and every request is still denied until you grant something.

## Decisions denied

The gateway hides the reason and refuses the caller; the reason and its code are in the Access decision log line, with subject, workspace and route (§8.7). The gateway's metric counts `missing_role` apart from `access_denied`.

| Reason in the log | Code | Likely cause | Check | Fix |
| --- | --- | --- | --- | --- |
| `the principal does not exist` | `access_denied` | The subject is not a principal id, or the gateway presents a tenant credential and the subject belongs to another tenant (§8.8). | `GET /v1/admin/users?tenant=…` for the subject's id; which credential the gateway sends. | Register the principal in the right tenant, or give the gateway the credential of the principal's tenant. |
| `the principal is disabled` | `access_denied` | The principal's `status` is `disabled`. | `GET /v1/admin/users?tenant=…&status=disabled` | Re-send the principal with `"status": "active"`. |
| `the tenant is disabled` | `access_denied` | The tenant has `enabled = false`. | `GET /v1/admin/tenants` | Re-send the tenant with `"enabled": true`. |
| `the principal does not have the role of the workspace` | `missing_role` | No live grant matches the workspace and route (§8.3): wrong `workspaceId` or `routeId`, a revoked grant, a disabled permission, a member removed from its group, or a workspace that is not a UUID. | `curl -sS "$ACCESS/v1/admin/grants?tenant=acme&userId=<id>&live=true" -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"`, and compare with the gateway route's workspace and route ids. | Create the grant ([`PUT /v1/admin/grants`](api.md#put-v1admingrants)); `null` workspace or route covers all. |
| `the role of the workspace has expired` | `missing_role` | The matching grant's `expiresAt` has passed. | The same list without `live=true` shows the expired grant. | Re-send the grant with a later `expiresAt`, or `null`. |

Other surprises:

| You see | Cause | Fix |
| --- | --- | --- |
| A revoked grant still allows for a few seconds | The gateway caches decisions for `GATEWAY_ACCESS_CACHE_TTL_MS` (5 s by default); Access caches nothing (§8.6). | Expected. Set `accessCacheTtlMs: 0` on a route that needs immediate revocation. |
| The token's `roles` claim and the decision disagree | The claim is a snapshot taken at login; the decision reads the grants table (§7.3, §8.4). | Expected. A new login refreshes the claim. |
| The `roles` claim lacks some permissions | The claim is capped at 64 entries; the log counts the ones left out (§7.3). | Expected. Decisions still read every grant. |
| An auto-provisioned principal is denied everywhere | Auto-provisioning creates no grant (§6.4). | Grant it something. |

## Decision timeouts and outages

A decision that cannot be computed is a denial: the gateway fails closed on `503` (§8.1).

| You see | Likely cause | Check | Fix |
| --- | --- | --- | --- |
| Readiness `503 not-ready`; decisions `503 service_unavailable` and the gateway denies | The database is down (§12.1). | `pg_isready -h "$ACCESS_DATABASE_HOST" -p 5432 -U access_app -d platform` | Restore the database. Replicas start only once it answers. Decisions are never cached. |
| Decisions `503 service_unavailable` while the database answers; latency alert | A decision took longer than `ACCESS_DECISION_TIMEOUT_MS` (2 s by default); PostgreSQL stopped the statement (§8.3). | `access_decision_duration_seconds`; `access_store_errors_total`; log `the statement is slow` (over 50 ms); `pg_stat_activity`. | Fix the slow dependency. `scripts/cli/explain-decision.ts` prints the decision plan, which should use `grants_user_live` ([Internals](internals.md#capacity)). |
| Pool saturation alert | More concurrent decisions than the 10 connections of a replica. | `pg_stat_activity_count{application_name='access'}` | Find the slow statement first; add replicas when the load is real. |
| Readiness `503 draining` | The replica received `SIGTERM` and is draining (§12.4). | The rollout or the node's events. | Expected during a rollout. |
| `access_store_errors_total{store="redis"}` rises | The shared store is unreachable. | `redis-cli -u "$ACCESS_REDIS_URL" ping` | Restore the store; logins and the administration fail closed until it answers. |

## Administration refusals

Errors are `{"error": "<code>", "message": "<text>"}` (§10.1). Every refusal is logged with endpoint, status and address.

| You see | Likely cause | Fix |
| --- | --- | --- |
| `401 unauthorized` | The bearer token is missing or wrong, or it is a previous token the deployment already removed (§4.3.1). | Send `ACCESS_ADMIN_TOKEN`, or a credential from `ACCESS_ADMIN_TOKENS`. |
| `403 forbidden` | A tenant credential acted for another tenant, tried to create a tenant, or sent a `sharedClient` or `default` value different from the row's (§10.1); or a grant named a principal or group of another tenant (§10.6). | Use a platform credential, or the credential of the right tenant. |
| `429` | A burst of failed authentications from this address (§10.1). Only failed calls count, and an authenticated call clears the count. | Fix the credential first; alert 7 in [Monitoring](operations.md#monitoring) watches this. |
| `503 service_unavailable` | The failed-authentication count could not be read from the shared store, so the call is refused (§10.1). | Restore the store. |
| `409 conflict` | The `clientId` belongs to another tenant, a second tenant would become the default (§10.2), a role would name itself (§10.11), or the role to delete is still named by a grant (§10.13). In a batch, an identity already in use (§10.4). | Pick a unique value; revoke the grants before deleting the role. |
| `404 not_found` | Unknown tenant, principal, grant id, group, group member or role key. | Create the missing object first; group members are external subjects, not ids (§10.9). |
| `400 invalid_request` | A `limit` above `200`, a non-numeric `limit` or negative `offset`; an empty batch or one over 1 000 items; an unknown audit `format`; both or neither of `userId` and `group`. | Correct the request ([API](api.md#administration)). |
| `413` | A body over 64 KiB (a batch body may reach 1 MiB). | Split the call or use a batch. |
| A tenant cannot be written at all | `ACCESS_SECRET_ENCRYPTION_KEY` is not set, and Access never stores a client secret in clear (§4.3). | Set the key and roll. |

## Token and JWKS problems

| You see | Likely cause | Fix |
| --- | --- | --- |
| Warning `the service cannot issue a token: it has no signing key`; the JWKS is empty | `ACCESS_SIGNING_KEY` or `ACCESS_SIGNING_KID` is not set (§4.2). | Set both and roll. |
| The gateway refuses the discovery document | `ACCESS_ISSUER` and `GATEWAY_OIDC_ISSUER` differ, even by a trailing slash (§7.5, §13.2). | Make them the same URL, character for character. |
| Every live session breaks after a restart or deploy | The signing key changed without the previous key in the JWKS. | Keep the old key in `ACCESS_PREVIOUS_SIGNING_KEY` and `ACCESS_PREVIOUS_SIGNING_KID` until its tokens expire ([Rotating secrets](operations.md#rotating-secrets)). |
| `GET /oauth/userinfo` answers `401` | The token is expired (tokens live five minutes), signed with another key, or issued for another audience (§7.5). | Get a new token; check the audience is the gateway's client id. |
| The gateway refuses a bearer token as an id token | A token with a nonce was sent as a bearer token (`GATEWAY_OIDC_REJECT_NONCE_TOKEN`, §7.2). | Send the access token, not the id token. |
| Stored client secrets are unreadable after the encryption key changed | `ACCESS_SECRET_ENCRYPTION_KEY` was replaced without re-encrypting (§4.3). | Run `scripts/cli/rotate-secrets.ts` with the old and new keys ([Rotating secrets](operations.md#rotating-secrets)). |
| A tenant's logins fail after its provider rotated keys | The provider no longer publishes the key that signed the token; an uncached key is re-read at most once every thirty seconds per tenant (§6.6). | Wait for the provider's JWKS to publish the key; a key the provider does not publish stays refused. |

## Access context refusals

| You see | Likely cause | Fix |
| --- | --- | --- |
| `401 unauthorized` | The token is not a key of `ACCESS_CONTEXT_TOKENS` (§9.2). | Add it ([format](configuration.md#access-context-credentials)) and roll. |
| `403 forbidden` | The credential's list lacks the tenant. The list holds tenant ids (UUIDs), not slugs. | Add the tenant id to the credential's list. |
| `400 bad_request` | An unknown or mistyped field, a `version` other than `1`, or a `subject` or `tenantId` that is not a UUID. | Correct the body ([API](api.md#post-v1access-context)). |
| `503 service_unavailable` | The policy could not be evaluated completely, or more than 4096 keys apply (§9.3). | Check the database; reduce the principal's permissions. |
| The data backend stays not ready | Discovery (`GET /v1/access-context`) does not list a version the backend knows (§9.1). | Run matching releases. |

## Start refusals

The service stops at start with `the environment is invalid:` followed by every problem (§4.4). Fix them all, then start again. Variable rules are in [Configuration](configuration.md).

| Message | Fix |
| --- | --- |
| `ACCESS_<NAME> must be set in a production environment: …` | Set the variable, or its `_FILE` form. |
| `ACCESS_DATABASE_URL must name a PostgreSQL server in a production environment: …` | Production cannot use `pglite://` or the default embedded database (§3.9). |
| `the role "<role>" of the database bypasses the isolation of the tenants` | Check with `psql "$ACCESS_DATABASE_URL" -c "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user"`. Point `ACCESS_DATABASE_URL` at a [non-superuser owner role](operations.md#database-role) and roll. Never add `BYPASSRLS` (§3.10). |
| `… must be at least 16 bytes long` or `… must be at least 32 bytes long` | Generate a longer value (§4.1). |
| `… is the value of the example of a development machine` | Replace every value copied from `.env.example`, and every one-character secret (§4.1). |
| `ACCESS_PREVIOUS_DECISION_TOKEN is set without ACCESS_DECISION_TOKEN: …` | Remove both, or set the current token too (§4.3.1). |
| `ACCESS_<NAME> and ACCESS_<NAME>_FILE are both set: …` | Keep one form (§4.5). |
| `ACCESS_<NAME>_FILE names a file that cannot be read: …` | Mount the secret file, or fix its permissions. |
| `ACCESS_ADMIN_TOKENS must be a json object`, `a credential of the administration is at least 16 characters long` | Fix the JSON ([format](configuration.md#administration-credentials)). |
| The start log names an unknown migration; new replicas stay `503 not-ready` | The database holds a migration this release does not know (§3.8). Run the release whose migrations include every name in `access_schema_migrations`. |
| No schema found, naming the directory it looked in | A binary started without `migrations/` beside it (§3.8). Unpack the whole release archive. |

## Tenant cutover problems

The procedure is in [Operations](operations.md#tenant-cutover).

| You see | Likely cause | Fix |
| --- | --- | --- |
| `scripts/compat/shadow.ts` exits non-zero | The two services disagree on some decisions. Only the old service's hard-coded decisions may differ. | Use the reported fingerprint to find the recurring set; fix the copied grants. Do not switch while any other difference remains. |
| `bun run test:compat` is red | The unchanged gateway fails against Access. | Read the runner's output ([Internals](internals.md#compatibility-suite)); never change the gateway to make it pass. |
| Logins fail right after the switch | One of the four gateway settings (issuer, client id, client secret, access URL) does not match Access (§13.2). | Compare them with the tenant registration; roll back by restoring the recorded gateway configuration. |
| Callers must log in again after the switch | Expected: switching a tenant's gateway settings ends its sessions ([Rollout](operations.md#rollout)). | Nothing to fix. |
| Gateway metrics show no decisions from Access | The gateway's `GATEWAY_ACCESS_URL` still names the old service. | Point it at Access. |
