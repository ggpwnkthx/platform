# Respond to an incident

A playbook for a suspected compromise: cut off an account or a whole tenant across Access and the gateway, replace the secrets that may have leaked, reconstruct what happened from audits, logs and metrics, and report the finding. It is for [security engineers](../roles/secops.md) on call, working with the [operators](../roles/sysops.md) who can roll deployments.

## Before you start

Have these ready before an incident, not during one:

| You need | Used for |
| --- | --- |
| A platform administration credential for Access | Disabling principals and tenants, revoking grants, reading the audit of every tenant. |
| A control-plane token with the `operate` scope, and a way to reach `gateway-control` on the internal network | Ending gateway sessions and purging cached decisions ([gateway spec §12.7](../gateway/spec.md#127-control-plane)). Its socket is never routed through the ingress. |
| Read access to the JSON logs of the gateway, Access and Data | Following a request id across services. |
| The metrics dashboards for all three services | Spotting denials, refused logins and token guessing. |
| `platformctl` with `PLATFORMCTL_ADMIN_TOKEN` and `PLATFORMCTL_CONTROL_TOKEN` | The CLI equivalents shown below. |

```bash
export ACCESS=https://access.example.com
export ACCESS_ADMIN_TOKEN=…           # platform credential
export CONTROL=http://127.0.0.1:9090  # gateway-control
export CONTROL_TOKEN=…                # scope: operate
```

With Access as the gateway's provider, the subject the gateway knows a caller by is the principal UUID Access issues as `sub` ([Access spec §7.1](../access/spec.md#71-id-token-claims)). Look it up first; every step below uses it:

```bash
USER_ID=$(curl -sS "$ACCESS/v1/admin/users?tenant=acme&email=alice@acme.example" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" | jq -r '.principals[0].id')
```

## Steps

### 1. Cut off one account

Work from the source of truth outwards: stop new decisions in Access, then clear what the gateway remembers.

1. **Disable the principal.** A disabled principal is refused at login (`403 principal_disabled`) and denied at every decision, whatever grants it holds ([Access spec §8.3](../access/spec.md#83-rule)):

   ```bash
   curl -sS -X POST $ACCESS/v1/admin/users \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"tenant":"acme","externalSubject":"00u1a2b3c4d5","status":"disabled"}'
   ```

   ```bash
   platformctl access principals create --tenant acme --subject 00u1a2b3c4d5 --status disabled
   ```
2. **Revoke its grants** if the account itself is legitimate but its rights were abused or wrongly given. Revoked rows stay for the investigation ([Manage access](manage-access.md) shows the loop that revokes every live grant).
3. **Purge the gateway's cached decisions** for the subject, so the next request asks Access instead of reusing an allowance for up to `GATEWAY_ACCESS_CACHE_TTL_MS`:

   ```bash
   curl -sS -X DELETE -H "authorization: Bearer $CONTROL_TOKEN" "$CONTROL/v1/decisions?subject=$USER_ID"
   ```

   ```bash
   platformctl sessions purge-decisions --subject "$USER_ID"
   ```
4. **End the gateway sessions** of the subject, without signing anyone else out ([gateway operations: revoking sessions](../gateway/operations.md#revoking-sessions)):

   ```bash
   curl -sS -X DELETE -H "authorization: Bearer $CONTROL_TOKEN" "$CONTROL/v1/sessions?subject=$USER_ID"
   ```

   ```bash
   platformctl sessions revoke --subject "$USER_ID"
   # or, against the shared state directly:
   GATEWAY_SESSION_URL=redis://127.0.0.1:6379/0 bun run sessions -- --subject "$USER_ID"
   ```

   Each form reports how many sessions it removed. On Redis, sessions created before the subject index existed are not found and only expire on their own; on Postgres, `postgres:migrate` indexes them.

What can still run after these steps:

| Residue | Bound |
| --- | --- |
| A bearer access token Access issued | Lives five minutes, but each request still needs a decision, which is now a denial. |
| An open WebSocket | Closed with `1008` at the next revalidation, within `GATEWAY_WS_REVALIDATE_INTERVAL_MS` (60 s by default); revalidation always asks for a fresh decision ([gateway spec §6.2](../gateway/spec.md#62-outage-grace)). |
| A route with `accessStaleGraceMs` during an Access outage | Serves the last allowance until the grace ends. |
| A Data read cache, when `DATA_CONTEXT_CACHE_TTL_MS` is set | At most 5 s; writes always ask Access. |
| A request already in progress | Runs to completion ([Data spec §5.4](../data/spec.md#54-freshness-and-revocation)). |
| The console | Re-reads operator keys on every page; its own sessions end on restart. |

On routes where these windows are too long, set `accessCacheTtlMs: 0` and `accessStaleGraceMs: 0` in the route table and publish it with `platformctl routes apply` ([gateway configuration: route-level overrides](../gateway/configuration.md#route-level-overrides)).

### 2. Cut off a whole tenant

1. **Disable the tenant.** A disabled tenant refuses every login and denies every decision ([Access spec §3.1](../access/spec.md#31-tenants)). Send its registration again with `"enabled": false`, carrying the required fields as in [Onboard a tenant](onboard-a-tenant.md).
2. **Purge cached decisions** for each of the tenant's workspaces: `DELETE /v1/decisions?workspace=<id>`, or `platformctl sessions purge-decisions --workspace <id>`.
3. **End its sessions.** In the supported topology the tenant has a gateway deployment of its own ([Access spec §1.4](../access/spec.md#14-one-gateway-client-per-tenant)), so you can end every session of that gateway by deleting its key prefix in the shared state (`SCAN` and `DEL`, or `FLUSHDB` when the prefix owns the database), once per prefix ([gateway operations: revoking sessions](../gateway/operations.md#revoking-sessions)).
4. **Withdraw its credentials.** Remove the tenant's entries from `ACCESS_ADMIN_TOKENS`, drop its UUID from every list in `ACCESS_CONTEXT_TOKENS`, and remove it from `CONSOLE_TENANT_ADMIN_TOKENS`; roll Access and the console.
5. **Close its Data workspaces** if data must stop being served at once: `bun run workspace -- disable --id <uuid>`, run as the schema owner, makes the workspace answer `404` ([Data operations: workspaces](../data/operations.md#workspaces)).

### 3. Replace the secrets that may have leaked

Rank the leak by what it lets an attacker do, then follow the matching step of [Rotate secrets](rotate-secrets.md). The signing keys are the trust boundaries between the services ([platform security: trust boundaries](../platform/security.md#trust-boundaries)).

| Leaked | What it allows | Rotate |
| --- | --- | --- |
| `GATEWAY_IDENTITY_SIGNING_KEY` | Minting identities that Data and every upstream accept. | First, step 2. |
| `ACCESS_SIGNING_KEY` | Minting tokens the gateway accepts for any principal. | First, step 5; drop the previous key as soon as you can. |
| `ACCESS_ADMIN_TOKEN` or a platform entry of `ACCESS_ADMIN_TOKENS` | Every administration change in every tenant. | Step 6 or 7. |
| A tenant entry of `ACCESS_ADMIN_TOKENS` | Administration of that tenant only. | Step 7. |
| `ACCESS_DECISION_TOKEN` | Asking about any principal of the platform; it is unscoped. | Step 6. |
| A tenant's gateway client secret | Exchanging that tenant's login codes. | Step 8. |
| `ACCESS_SECRET_ENCRYPTION_KEY` together with a database dump | Reading every tenant's client secrets. | Step 4, then every tenant client secret (step 8). |
| `ACCESS_CONTEXT_TOKENS` entry | Reading the permissions of principals in its tenants. | Step 7. |
| A control-plane token | Its scope: reading, purging sessions, or writing the route table. | Step 11; check the control-plane audit for writes. |
| Shared-state passwords | What that role may do: the gateway's role writes sessions, limits and cached decisions, the control plane's role writes the route table ([gateway spec §12.8](../gateway/spec.md#128-shared-state-roles)). | Step 11. |

The rolling procedures keep the old value valid for a while to avoid an outage. For a leaked value, shorten or skip that window and accept the refusals it causes:

- For the administration and decision tokens, you can set the new value without first copying the old one into `ACCESS_PREVIOUS_*`; every holder you have not updated yet is refused until it is. A gateway refused by Access answers its callers `503 access_unavailable`.
- For a map entry, remove the old token in the same roll that adds the new one.
- For a tenant client secret, Access keeps the replaced secret valid for 24 hours, and the docs describe no way to end that window early. If the old secret must stop working now, disabling the tenant (step 2) is the documented hard stop.

### 4. Find out what happened

Start from what you know (a request id, a subject, a time window) and widen out.

1. **The Access audit** lists every administration change with its operator, address and request id. Filter by tenant or action and keep an export of the window ([Access spec §10.15](../access/spec.md#1015-get-v1adminaudit)):

   ```bash
   curl -sS "$ACCESS/v1/admin/audit?tenant=acme&action=grant.created&limit=200" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
   curl -sS "$ACCESS/v1/admin/audit?format=jsonl&tenant=acme" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -o acme-audit.jsonl
   ```

   ```bash
   platformctl access audit export --tenant acme --format jsonl --out acme-audit.jsonl
   ```

   An operator shown as twelve hex characters is a credential with no name; give operators named tenant credentials so the next audit names a person ([Access operations: hardening](../access/operations.md#hardening)). The grants list shows who granted each right (`grantedBy`).
2. **The control-plane audit** records route-table writes with operator, scope and address: `platformctl routes audit`, or `GET /v1/audit` on the control plane. An unexpected route change or rollback is a sign of a stolen `config` token.
3. **The Data audit** lists committed mutations per workspace with principal, request id and the policy that allowed them; it needs `data.audit.read` and is kept 90 days, so export the window you need before retention deletes it ([Data API: read the audit](../data/api.md#read-the-audit), [Data operations: retention](../data/operations.md#retention)). `platformctl data audit` and the console's audit page read the same trail.
4. **The logs.** Every service writes JSON lines carrying the request's `x-request-id`; search all three for it ([gateway troubleshooting: start here](../gateway/troubleshooting.md#start-here)).

   | Service | What its lines tell you |
   | --- | --- |
   | Gateway | The route, the caller's subject and workspace on every request and refusal line, with the trace id ([gateway spec §12.2](../gateway/spec.md#122-logs)). |
   | Access | Logins with tenant, outcome and refusal reason; decisions with subject, workspace, route, outcome and reason; administration calls with endpoint, status and target ([Access spec §12.3](../access/spec.md#123-logs)). |
   | Data | The error code of each refusal, never Access's reason ([Data operations: logs](../data/operations.md#logs)). |

   The reason behind a gateway denial never reaches the caller and is only in Access's decision log line. No log line carries a token, secret, cookie or `Authorization` header.
5. **The metrics** show the shape and timing of an attack:

   | Metric | Points to |
   | --- | --- |
   | `gateway_auth_failures_total{reason}` | Rejected callers at the gateway, split into `missing_role` and `access_denied`. |
   | `access_decisions_total{result="deny",tenant}` | Denials per tenant; Access alerts when they pass 20 % of decisions for 10 minutes ([Access operations: monitoring](../access/operations.md#monitoring)). |
   | `access_logins_total{result,tenant}` | Refused or failing logins per tenant. |
   | `access_admin_requests_total{status="401"}` | Guessing at the administration token; five failures from one address get `429`. |
   | `data_authorization_denials_total` | Clients going beyond their grants inside Data. |
   | `gateway_rate_limited_total` | A flood held back by the limiter. |

### 5. Report it

If the incident reveals a vulnerability in the platform itself, report it privately, never in a public issue, as [SECURITY.md](../../SECURITY.md) describes: open a security advisory on the repository, or write to `security@ggpwnkthx.com`. Include the service, its version, steps to reproduce and the impact you expect. Each service reports its version on `GET /healthz`, and `platformctl version` shows the versions the deployment reports. The maintainers confirm or close the finding, prepare a fix, release it and then publish the advisory.

### 6. Restore normal service

Once the secrets are replaced and the cause is understood, enable the tenant or principal again by re-sending it with `"enabled": true` or `"status": "active"`, give back the grants that were legitimate, and remove any route overrides you no longer need. Review the [Access hardening list](../access/operations.md#hardening): moving gateways to tenant credentials and unsetting `ACCESS_DECISION_TOKEN` removes the one credential whose reach is the whole platform.

## Check that it worked

- `platformctl access decide --subject "$USER_ID" --workspace "$WORKSPACE" --route workspace-api` exits `6`, and Access's log gives `the principal is disabled` or `the tenant is disabled` as the reason.
- A new sign-in by the account ends on Access's page with `403 principal_disabled` or `403 tenant_disabled`.
- The session revocation and decision purge each reported a count, and the subject's next request through the gateway gets `401` or `403 workspace_forbidden` rather than an upstream answer.
- After rotation, the old credential gets `401` and the new one works (see [Rotate secrets](rotate-secrets.md#check-that-it-worked)).
- The audit export covers the incident window and is stored outside the affected deployment.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| The cut-off account still reaches an upstream | [Gateway troubleshooting: a revoked caller keeps access](../gateway/troubleshooting.md#a-revoked-caller-keeps-access) |
| The control plane answers `401`, `403`, `429` or `503` | [Gateway troubleshooting: control plane](../gateway/troubleshooting.md#control-plane) |
| Administration calls are refused | [Access troubleshooting: administration refusals](../access/troubleshooting.md#administration-refusals) |
| Every request is `503 access_unavailable` after a token change | [Gateway troubleshooting](../gateway/troubleshooting.md#503-access_unavailable) |
| Legitimate callers are denied after the incident | [Access troubleshooting: decisions denied](../access/troubleshooting.md#decisions-denied) |
| Logins fail for a tenant you re-enabled | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| Data refuses requests after the identity key changed | [Data troubleshooting: 401](../data/troubleshooting.md#401-unauthenticated) |

## Related

- [SECURITY.md](../../SECURITY.md)
- [Platform security](../platform/security.md)
- [Rotate secrets](rotate-secrets.md)
- [Manage access](manage-access.md)
- [Troubleshoot a request](troubleshoot-a-request.md)
- [Monitor the platform](monitor-the-platform.md)
- [Back up and restore](back-up-and-restore.md)
