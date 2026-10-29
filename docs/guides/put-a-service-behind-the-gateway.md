# Put a service behind the gateway

Expose your own HTTP service through the gateway: describe it as a route, publish the route table, make the service check the identity the gateway signs, grant callers access in Access, and prove the whole path works. Developers who own the service do most of it ([developer](../roles/developer.md)); an operator with control-plane rights publishes the table ([sysops](../roles/sysops.md)).

## Before you start

| You need | Why | Where it is described |
| --- | --- | --- |
| A running deployment: gateway, Access, and the control plane when routes live in the shared state | The route is served by the gateway and decided by Access | [Platform operations](../platform/operations.md), [Deploy the platform](deploy-the-platform.md) |
| Your service on an address only the gateway can reach | The signature proves the gateway sent a request; network exposure would let others try | [Gateway operations: deployment review](../gateway/operations.md#deployment-review) |
| A control-plane token with the `config` scope, or write access to the route-table file | Publishing a table is a `config` write | [gateway spec §12.7](../gateway/spec.md#127-control-plane) |
| The deployment's public identity key | Your service verifies signatures with it | [Upstream identity: key](../gateway/upstream-identity.md#key) |
| An Access administration credential and the tenant's principals | Callers need a grant on your route | [Manage access](manage-access.md) |
| `platformctl` with a profile for the deployment (optional) | Every step below has a CLI form | [CLI usage](../cli/usage.md#write-your-first-profile) |

## Steps

### 1. Write the route

A route is one entry in the `routes` list of the route table. Pick an `id` (lowercase kebab-case, unique, at most 63 characters): Access receives it as `routeId`, so grants and logs name your service by it.

```json
{
  "id": "reports-api",
  "match": { "host": "api.example.com", "path": "/reports/{workspaceId}/" },
  "upstream": "http://reports.internal:3000",
  "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } },
  "forwardAuthorization": false
}
```

Decide each part on purpose:

| Part | Choice | Reference |
| --- | --- | --- |
| `match.host` | An exact host, `*.example.com` for subdomains, or `*`. The most specific host always wins. | [gateway spec §3.3](../gateway/spec.md#33-route-precedence) |
| `match.path` | Literal segments plus placeholders. Add `match.methods` only if the route must refuse the other methods. | [gateway spec §3.1](../gateway/spec.md#31-fields) |
| Workspace placeholder | `auth.workspace.param` names the placeholder Access is asked about; `requireUuid` turns a non-UUID into `400 bad_request`. | [gateway spec §6](../gateway/spec.md#6-workspace-access) |
| No workspace | Leave `auth.workspace` out and set `accessCheck: true` so Access still decides on subject, route and roles. | [gateway spec §6.3](../gateway/spec.md#63-routes-without-a-workspace) |
| `auth.mode` | `session` for browsers, `jwt` for API clients, `any` for both, `none` only for public content. | [gateway spec §5.1](../gateway/spec.md#51-modes) |
| `upstream` | One URL, or a list tried in order when a resendable request cannot connect. | [gateway spec §11.4](../gateway/spec.md#114-multiple-upstreams) |
| `rewrite` | Set it when your service expects another path than the public one, for example `/{rest}` to drop the prefix. | [gateway spec §11.1.1](../gateway/spec.md#1111-path-rewrite) |
| `forwardAuthorization` | `false` unless your service really needs the caller's bearer token. | [gateway spec §7](../gateway/spec.md#7-header-policy) |
| `crossSite` | `strict` when your service changes state on a `GET`. | [gateway spec §8](../gateway/spec.md#8-cross-site-requests) |
| `timeouts`, `maxBodyBytes` | Raise them for slow answers or large uploads; keep the ingress limits in step. | [gateway spec §11.2](../gateway/spec.md#112-phases-and-budgets) |
| `accessCacheTtlMs`, `accessStaleGraceMs` | `0` cache for immediate revocation; a grace to ride out short Access outages. | [Gateway configuration: route-level overrides](../gateway/configuration.md#route-level-overrides) |
| `websocket` | `true` to accept upgrades; the upstream must then speak plain `ws`. | [gateway spec §10](../gateway/spec.md#10-websockets) |

The gateway refuses an unknown key, a route that is ambiguous with another, and `accessCheck` on a `none` route, so mistakes show up at validation rather than in traffic ([gateway spec §3.2](../gateway/spec.md#32-ambiguous-tables-are-rejected)).

### 2. Validate and publish the table

The gateway always replaces the whole table, never one route. Start from the active table, add your route to its `routes` list, and save the result as `routes.json`.

With the CLI (`PLATFORMCTL_CONTROL_TOKEN` holds the token):

```bash
platformctl routes get                      # active revision and table
platformctl routes validate ./routes.json   # errors, conflicts, warnings, diff; writes nothing
platformctl routes apply ./routes.json      # new revision, compare-and-swap on the active one
platformctl routes replicas                 # every replica should report the new revision
```

Over HTTP, against the control plane's internal address:

```bash
CONTROL=http://127.0.0.1:9090
curl -s -H "Authorization: Bearer $TOKEN" $CONTROL/v1/config | jq '.revision'
curl -s -H "Authorization: Bearer $TOKEN" --data-binary @routes.json $CONTROL/v1/config/validate
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'If-Match: "41"' \
  --data-binary @routes.json $CONTROL/v1/config
curl -s -H "Authorization: Bearer $TOKEN" $CONTROL/v1/replicas
```

A `409` means the table moved since you read it, or you touched a protected route: read it again and reapply your change. The full procedure, with rollback, is in [Gateway operations: changing the route table](../gateway/operations.md#changing-the-route-table).

A deployment that keeps routes in a file (`GATEWAY_CONFIG_SOURCE=file`) has no control plane write: edit the `GATEWAY_CONFIG` file instead, and the gateway reloads it atomically ([gateway spec §12.3](../gateway/spec.md#123-reload-and-readiness)).

Read the warnings the validation and the running-policy log report for your route, such as `authorization_forwarded` or `no_workspace_check`. Each one names a permissive setting you should be able to justify ([gateway spec §12.2](../gateway/spec.md#122-logs)).

### 3. Give your service the public key

Get the public half of the deployment key from whoever runs the gateway, and load it into your service's configuration:

```bash
bun run identity:key --public
```

Your service only ever holds this public key. It never needs the private key or the session secret, and a public key cannot sign an identity ([Upstream identity: key](../gateway/upstream-identity.md#key)).

### 4. Verify the signed identity on every request

The gateway removes any `x-gateway-*` header a client sent and writes its own: `x-gateway-user`, `x-gateway-email`, `x-gateway-roles`, `x-gateway-workspace` and `x-gateway-signature` ([Upstream identity: headers](../gateway/upstream-identity.md#headers)). Your service must check the signature before it reads any of them.

The quickest correct path is to copy the standalone reference verifier, [examples/upstream-identity/verify.ts](../../packages/gateway/examples/upstream-identity/verify.ts), whose only import is `jose`, and call it from your request handler:

```ts
const result = await verifyIdentity({ request, headers, publicKey: key })
if (!result.ok) {
  log.warn({ reason: result.reason }, 'identity refused')
  return new Response('forbidden', { status: 403 })
}
```

The complete TypeScript and Go examples are in [Upstream identity: code](../gateway/upstream-identity.md#code). Three inputs trip up most implementations:

| Input | Take it from |
| --- | --- |
| Path | The path your service received, after any `rewrite` |
| Query | The raw query string, with its leading `?`, or an empty string |
| Host | `x-forwarded-host`, lower-cased |

A `mode: none` route forwards requests with no identity and no signature, so decide per route whether your service accepts them ([Upstream identity: failed verification](../gateway/upstream-identity.md#failed-verification)).

The roles in `x-gateway-roles` come from the caller's token, which was issued at login. If your service needs the caller's current permissions, it can read them from Access's context contract with a credential of its own, as Data does ([Access API: access context](../access/api.md#post-v1access-context)).

### 5. Test the verifier against the gateway's signer

The reference verifier ships with [verify.test.ts](../../packages/gateway/examples/upstream-identity/verify.test.ts), which signs with the gateway's real signer. Run the same kind of test against your own implementation, and pin the gateway revision you test against ([Upstream identity: compatibility](../gateway/upstream-identity.md#compatibility)).

### 6. Grant callers access in Access

The gateway asks Access whether the caller's principal may use the workspace on route `reports-api`. A grant answers yes when its workspace and route match or are left empty (`null` covers every workspace or every route). The permission key is up to you, as long as it is enabled ([Access spec §8.3](../access/spec.md#83-rule)).

```bash
platformctl access grants put --tenant acme --user-id <principal id> \
  --permission reports.read \
  --workspace-id 11111111-1111-4111-8111-111111111111 --route-id reports-api
```

The same grant over HTTP:

```bash
curl -sS -X PUT https://access.example.com/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"<principal id>","permission":"reports.read",
       "workspaceId":"11111111-1111-4111-8111-111111111111","routeId":"reports-api"}'
```

In the console, an operator does the same on the tenant's **Rights** page ([console user guide](../console/user-guide.md#administer-a-tenant)). Grants to groups, roles and expiry dates are covered in [Manage access](manage-access.md) and the [Access API](../access/api.md#put-v1admingrants).

## Check that it worked

1. Put your route's decision to Access before any traffic arrives. A denial ends with exit status `6`:

   ```bash
   platformctl access decide --subject <principal id> \
     --workspace 11111111-1111-4111-8111-111111111111 --route reports-api
   ```

2. Sign in through the gateway with a redirect to your route, for example `https://api.example.com/auth/login?redirect=/reports/11111111-1111-4111-8111-111111111111/`, then call it again with the session cookie:

   ```bash
   curl -s -i "https://api.example.com/reports/11111111-1111-4111-8111-111111111111/summary" \
     -H "cookie: gateway_session=<value from the browser>"
   ```

3. Your service's log should show a verified identity whose subject is the principal id. The gateway's log line for the response's `x-request-id` names route `reports-api`, the subject and the workspace ([gateway spec §12.2](../gateway/spec.md#122-logs)).
4. Try the refusals on purpose. A principal without a grant gets `403 workspace_forbidden` from the gateway. A request sent straight to your service's address, without the gateway, must get your own `403`.
5. On `/metrics`, `gateway_requests_total{route="reports-api"}` counts your traffic and `gateway_upstream_failures_total` stays flat ([gateway spec §12.1](../gateway/spec.md#121-health-readiness-and-metrics)).

## If something goes wrong

| Symptom | Look here |
| --- | --- |
| Validation or apply refuses the table, or the change has no effect | [Gateway troubleshooting: route-table change](../gateway/troubleshooting.md#a-route-table-change-has-no-effect), [control plane statuses](../gateway/troubleshooting.md#control-plane) |
| `404 no_route` for your path | [Gateway troubleshooting](../gateway/troubleshooting.md#404-no_route-on-some-requests) |
| `401 unauthorized` or a login loop | [Gateway troubleshooting: 401](../gateway/troubleshooting.md#401-unauthorized) |
| `403 workspace_forbidden` | [Gateway troubleshooting](../gateway/troubleshooting.md#403-workspace_forbidden), then [Access: decisions denied](../access/troubleshooting.md#decisions-denied) |
| `400 bad_request` on the workspace path | [Gateway troubleshooting](../gateway/troubleshooting.md#400-bad_request-on-a-workspace-route) |
| Your service refuses every signature | [Gateway troubleshooting: identity signature](../gateway/troubleshooting.md#the-upstream-refuses-the-identity-signature) |
| `502 bad_gateway` or `504 gateway_timeout` | [Gateway troubleshooting: upstreams](../gateway/troubleshooting.md#502-bad_gateway) |
| Anything else | [Troubleshoot a request](troubleshoot-a-request.md) |

## Related

- [Upstream identity](../gateway/upstream-identity.md)
- [Gateway specification](../gateway/spec.md)
- [Gateway configuration](../gateway/configuration.md)
- [Gateway operations](../gateway/operations.md)
- [CLI usage](../cli/usage.md)
- [Manage access](manage-access.md)
- [Build an app on Data](build-an-app-on-data.md)
- [Troubleshoot a request](troubleshoot-a-request.md)
