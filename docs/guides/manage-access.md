# Manage access

Day-to-day administration of who may do what: granting and revoking permissions and roles on a workspace and route, organizing people in groups, knowing how long a revocation takes to reach every service, and reading or exporting the audit of those changes. It is for platform and tenant operators and for [security engineers](../roles/secops.md); the people who run the deployment are described in [sysops](../roles/sysops.md).

## Before you start

| You need | Notes |
| --- | --- |
| An administration credential | A platform credential acts for every tenant; a tenant credential from `ACCESS_ADMIN_TOKENS` acts only for its own tenant ([Access spec §4.6](../access/spec.md#46-administration-credentials)). |
| The tenant slug | Every write names it. |
| The workspace UUID and the gateway route id | A grant matches a request only when both agree with what the gateway sends ([Access spec §8.3](../access/spec.md#83-rule)). The route id is the `id` of the gateway route. |
| For the CLI: `PLATFORMCTL_ADMIN_TOKEN` and an Access address | Commands that change something ask first; pass `--yes` in scripts ([CLI usage](../cli/usage.md#everyday-work)). |
| For the console: the `console.admin` key (one tenant) or `console.platform` (every tenant) | Open **Operators** ([console user guide](../console/user-guide.md#administer-a-tenant)). |
| For purging gateway caches: a control-plane token with the `operate` scope | `PLATFORMCTL_CONTROL_TOKEN` for the CLI ([gateway spec §12.7](../gateway/spec.md#127-control-plane)). |

```bash
export ACCESS=https://access.example.com
export ACCESS_ADMIN_TOKEN=…   # or a tenant credential
```

A grant gives one subject (a principal or a group) one permission or one role, on one workspace or all of them (`null`), on one route or all of them (`null`), until it is revoked or reaches its optional `expiresAt` ([Access spec §3.4](../access/spec.md#34-grants)). Writes are upserts and revocations are idempotent, so repeating a call is safe.

## Steps

### 1. Find out who holds what

Look a person up by e-mail, then list their live grants ([API: principals](../access/api.md#get-v1adminusers), [API: grants](../access/api.md#get-v1admingrants)):

```bash
curl -sS "$ACCESS/v1/admin/users?tenant=acme&email=alice@acme.example" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" | jq -r '.principals[0].id'
curl -sS "$ACCESS/v1/admin/grants?tenant=acme&userId=$USER_ID&live=true" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

```bash
platformctl access principals list --tenant acme --email alice@acme.example
platformctl access grants list --tenant acme --user-id "$USER_ID" --live
```

The grants list shows each grant's `grantedBy`, and `live=false` shows only revoked or expired ones. Lists are paged with `limit` (at most `200`) and `offset`. The grants list filters by principal only; grants a person holds through groups are visible on the console's user page, which shows direct and group rights together.

To test a specific request, ask Access the gateway's question; the CLI exits `6` on a denial:

```bash
platformctl access decide --subject "$USER_ID" --workspace "$WORKSPACE" --route workspace-api
```

### 2. Grant a permission on a workspace and route

```bash
curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"'"$USER_ID"'","permission":"workspace.read",
       "workspaceId":"'"$WORKSPACE"'","routeId":"workspace-api",
       "expiresAt":"2026-12-31T23:59:59Z","grantedBy":"ops@example.com"}'
```

```bash
platformctl access grants put --tenant acme --user-id "$USER_ID" --permission workspace.read \
  --workspace-id "$WORKSPACE" --route-id workspace-api \
  --expires-at 2026-12-31T23:59:59Z --granted-by ops@example.com
```

In the console, use **Rights**: pick a user or group, a permission or role, the workspace and route, and an optional expiry.

A permission key that does not exist yet is created in the tenant's own scope ([Access spec §10.6](../access/spec.md#106-put-v1admingrants)). Leave out `expiresAt` for a grant that never expires; leave out `workspaceId` or `routeId` to cover every workspace or route of the tenant. What a permission lets someone do inside Data is decided by Data's policies, not by Access ([Data configuration: policy bundle](../data/configuration.md#policy-bundle)).

A new grant can wait behind a cached denial at the gateway for up to the decision cache lifetime; step 6 explains how to clear it.

### 3. Organize people in groups

A grant to a group holds for every member. Members are given by their provider `sub`, and each call **replaces** the membership: anyone you leave out is removed ([API: groups](../access/api.md#post-v1admingroups)).

```bash
curl -sS -X POST $ACCESS/v1/admin/groups \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","key":"team-platform","displayName":"The platform team",
       "members":["00u1a2b3c4d5","00u9z8y7x6w5"]}'

curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","group":"team-platform","permission":"workspace.write",
       "workspaceId":"'"$WORKSPACE"'","routeId":"workspace-api"}'
```

```bash
platformctl access groups create --tenant acme --key team-platform \
  --display-name "The platform team" --member 00u1a2b3c4d5 --member 00u9z8y7x6w5
platformctl access grants put --tenant acme --group team-platform --permission workspace.write \
  --workspace-id "$WORKSPACE" --route-id workspace-api
platformctl access groups list --tenant acme
```

In the console, use **Groups**. A member that is not a principal of the tenant is refused with `404 not_found`, so register people first. Membership is read from the table on every decision, so removing someone from a group takes away the group's grants at their next decision.

### 4. Bundle permissions in roles

A role is a named set of permissions and other roles; granting it gives all of them ([API: roles](../access/api.md#put-v1adminroles)). Like a group, a write **replaces** the role's contents.

```bash
curl -sS -X PUT $ACCESS/v1/admin/roles \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","key":"role-editor","displayName":"The editors",
       "permissions":["workspace.write"],"roles":["role-reader"]}'

curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"'"$USER_ID"'","role":"role-editor",
       "workspaceId":"'"$WORKSPACE"'","routeId":"workspace-api"}'
```

```bash
platformctl access roles put --tenant acme --key role-editor --display-name "The editors" \
  --permission workspace.write --role role-reader
platformctl access grants put --tenant acme --user-id "$USER_ID" --role role-editor \
  --workspace-id "$WORKSPACE" --route-id workspace-api
```

In the console, save the role on **Roles** and grant it on **Rights**. A role that would include itself, directly or through others, is refused with `409 conflict`. A role can be removed (`DELETE /v1/admin/roles/{id}`, or `platformctl access roles remove <id>`) only once no grant names it, so revoke those grants first ([Access spec §10.13](../access/spec.md#1013-delete-v1adminrolesid)).

### 5. Revoke a grant, or switch a person off

Revoking stamps the grant with `revoked_at` and keeps the row for history; repeating it still answers `204` ([API: revoke a grant](../access/api.md#delete-v1admingrantsid)).

```bash
curl -sS -X DELETE $ACCESS/v1/admin/grants/$GRANT_ID \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -i
```

```bash
platformctl access grants revoke "$GRANT_ID"
# every live grant of one principal, in a script:
platformctl --output json access grants list --tenant acme --user-id "$USER_ID" --live \
  | jq -r '.grants[].id' | xargs -n1 platformctl --yes access grants revoke
```

In the console, revoke from **Rights** or from the user's page.

To stop a person everywhere at once, disable the principal instead: a disabled principal is refused at login and denied at every decision, and its grants stay in place for when it is enabled again ([Access spec §3.2](../access/spec.md#32-users)).

```bash
curl -sS -X POST $ACCESS/v1/admin/users \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","externalSubject":"00u1a2b3c4d5","status":"disabled"}'
```

```bash
platformctl access principals create --tenant acme --subject 00u1a2b3c4d5 --status disabled
```

### 6. Make the revocation take effect

Access caches nothing: its very next decision reflects the change. The delay comes from caches in front of and behind it.

| Layer | How long it can lag | How to shorten it |
| --- | --- | --- |
| Gateway decision cache | `GATEWAY_ACCESS_CACHE_TTL_MS`, 5 s by default, or the route's `accessCacheTtlMs` ([Access spec §8.6](../access/spec.md#86-revocation-latency)) | Purge it (below), or set `accessCacheTtlMs: 0` on sensitive routes so every request asks Access. |
| Gateway outage grace | While Access is unreachable, a route with `accessStaleGraceMs` keeps serving the last allowance until the grace ends ([gateway spec §6.2](../gateway/spec.md#62-outage-grace)) | Keep `accessStaleGraceMs: 0` where a late revocation is unacceptable. |
| Open WebSockets | Rechecked every `GATEWAY_WS_REVALIDATE_INTERVAL_MS` (60 s by default) with a fresh decision, then closed with `1008` | Lower the interval. |
| Data's context cache | Off by default (`DATA_CONTEXT_CACHE_TTL_MS=0`); at most 5 s when set, never past the context's `validUntil`; writes always ask Access afresh ([Data spec §5.4](../data/spec.md#54-freshness-and-revocation)) | Leave the cache off. A request already running when you revoke may still finish. |
| The token's `roles` claim and the `x-gateway-roles` header | A snapshot taken at sign-in; it changes at the next sign-in ([Access spec §7.3](../access/spec.md#73-roles-claim)) | Nothing to do for decisions, which never read it; end the person's sessions if an upstream relies on the header. |
| Console operator keys | Re-read on every page, kept no longer than the context's `validUntil` ([console spec §4](../console/spec.md#4-operator-scope)) | Nothing: administration closes from the next page. |

To skip the gateway's cache, purge the cached decisions of the subject, of a workspace, or both, with an `operate` token ([gateway operations: revoking sessions](../gateway/operations.md#revoking-sessions)). The subject is the principal UUID, which is the `sub` Access issues:

```bash
CONTROL=http://127.0.0.1:9090
curl -sS -X DELETE -H "authorization: Bearer $CONTROL_TOKEN" "$CONTROL/v1/decisions?subject=$USER_ID"
curl -sS -X DELETE -H "authorization: Bearer $CONTROL_TOKEN" "$CONTROL/v1/decisions?workspace=$WORKSPACE"
```

```bash
platformctl sessions purge-decisions --subject "$USER_ID"
platformctl sessions purge-decisions --workspace "$WORKSPACE"
```

Revoking grants does not end anyone's session: the person stays signed in and is simply denied. To cut a compromised account off completely, follow [Respond to an incident](respond-to-an-incident.md).

### 7. Audit the changes and export them

Every administration change writes an audit row in the same statement, naming the action, target, tenant, operator, address and request id ([Access spec §10.15](../access/spec.md#1015-get-v1adminaudit)). The operator is the credential's name when it has one, otherwise the first twelve hex characters of its digest, which is why per-operator tenant credentials make the audit readable. A tenant credential sees only its own tenant's rows.

```bash
curl -sS "$ACCESS/v1/admin/audit?tenant=acme&action=grant.revoked&limit=50" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

```bash
platformctl access audit list --tenant acme --action grant.revoked
```

The actions are `tenant.created`, `tenant.updated`, `principal.created`, `principal.updated`, `group.created`, `group.updated`, `grant.created`, `grant.updated`, `grant.revoked`, `role.created`, `role.updated` and `role.removed`.

To hand the audit to a spreadsheet or a script, ask for `csv` or `jsonl` ([API: exporting the audit](../access/api.md#exporting-the-audit)):

```bash
curl -sS "$ACCESS/v1/admin/audit?format=csv&tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -o acme-audit.csv
```

```bash
platformctl access audit export --tenant acme --format jsonl --out acme-audit.jsonl
```

The console's **Audit** page exports the same two formats. One export answer holds at most 10 000 rows; for a longer audit, page through it with `limit` and `offset` on the HTTP call, since the CLI's export command takes neither option.

Two other trails complete the picture: the gateway control plane records its own writes (`platformctl routes audit`, or `GET /v1/audit` on the control plane), and Data records committed mutations per workspace for holders of `data.audit.read` ([Data API: read the audit](../data/api.md#read-the-audit)).

## Check that it worked

- After a grant: `platformctl access decide …` exits `0`, and the person's request through the gateway is no longer `403 workspace_forbidden`.
- After a revocation: the grant appears in `platformctl access grants list --tenant acme --user-id "$USER_ID"` with `revokedAt` set, `platformctl access decide …` exits `6`, and the audit holds a `grant.revoked` row.
- After a purge: the CLI reports how many cached decisions it removed, and the next request is decided afresh.
- On the metrics, `access_decisions_total{result="deny"}` for the tenant and `gateway_auth_failures_total{reason="missing_role"}` move in step with the revocations you made.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| A write answers `400`, `403`, `404`, `409`, `413` or `429` | [Access troubleshooting: administration refusals](../access/troubleshooting.md#administration-refusals) |
| A grant exists but the person is still denied | [Access troubleshooting: decisions denied](../access/troubleshooting.md#decisions-denied) |
| A revoked person keeps access | [Gateway troubleshooting: a revoked caller keeps access](../gateway/troubleshooting.md#a-revoked-caller-keeps-access) |
| The gateway answers `403 workspace_forbidden` | [Gateway troubleshooting](../gateway/troubleshooting.md#403-workspace_forbidden) |
| Data answers `403 FORBIDDEN` although Access allows | [Data troubleshooting](../data/troubleshooting.md#403-forbidden) |
| A purge answers `401`, `403` or `429` | [Gateway troubleshooting: control plane](../gateway/troubleshooting.md#control-plane) |
| A `platformctl` command refuses | [CLI usage: when something refuses](../cli/usage.md#when-something-refuses) |

## Related

- [Access API: administration](../access/api.md#administration)
- [Access spec §10: administration](../access/spec.md#10-administration)
- [CLI spec: access commands](../cli/spec.md#55-access)
- [Onboard a tenant](onboard-a-tenant.md)
- [Respond to an incident](respond-to-an-incident.md)
- [Troubleshoot a request](troubleshoot-a-request.md)
