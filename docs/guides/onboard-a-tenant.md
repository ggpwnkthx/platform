# Onboard a tenant

Bring a new customer onto the platform: register it and its identity provider in Access, connect its gateway, register its first principal and grant, hand its operator a credential of their own, and prove that a request through the gateway is allowed. A platform operator does this (see [sysops](../roles/sysops.md)), with a [security engineer](../roles/secops.md) issuing the secrets.

## Before you start

| You need | Why |
| --- | --- |
| An Access deployment in production, with `ACCESS_SECRET_ENCRYPTION_KEY` set | Without that key Access refuses to write any tenant ([Access spec §4.3](../access/spec.md#43-secrets-at-rest)). |
| A platform administration credential (`ACCESS_ADMIN_TOKEN`, or a `null`-scoped entry of `ACCESS_ADMIN_TOKENS`) | Only a platform credential may create a tenant ([Access spec §10.1](../access/spec.md#101-common-rules)). |
| The tenant's OpenID Connect provider: its `https` issuer, and a client registered there for Access with its id and secret | Access logs callers in at that provider. It must support PKCE, and in production its issuer must resolve to public addresses ([Access spec §6.1](../access/spec.md#61-validating-the-provider-token)). |
| Access's callback, `{ACCESS_PUBLIC_URL}/oauth/tenant/callback`, registered at that provider | The provider sends the browser back there. |
| A gateway deployment for this tenant, and the public URL it is reached under | One gateway deployment serves one tenant ([Access spec §1.4](../access/spec.md#14-one-gateway-client-per-tenant)); see [Deploy the platform](deploy-the-platform.md). |
| The workspace UUID the tenant will use, and the gateway route id that serves it | Grants name both. |
| The provider's `sub` for the first person to sign in | Principals are keyed by it, never by e-mail ([Access spec §6.2](../access/spec.md#62-mapping-key)). |
| `curl` and `jq`, or the CLI (`platformctl`) with `PLATFORMCTL_ADMIN_TOKEN` and an Access address in its profile | Every step below is an administration call ([CLI usage](../cli/usage.md#credentials)). |

The examples use the tenant `acme`, Access at `https://access.example.com` and the tenant's gateway at `https://gateway-acme.example.com`:

```bash
export ACCESS=https://access.example.com
export ACCESS_ADMIN_TOKEN=…      # a platform credential
export WORKSPACE=11111111-1111-4111-8111-111111111111
```

## Steps

### 1. Choose the tenant's identifiers

Write these down before the first call; several services must agree on them later.

| Value | Example | Rule |
| --- | --- | --- |
| Slug | `acme` | `[a-z0-9-]{2,63}`, the row's key in Access. |
| Gateway client id | `gateway-acme` | Unique across all tenants; a second tenant claiming it gets `409 conflict`. |
| Gateway client secret | from your secret manager | Stored encrypted by Access and never returned. |
| Gateway callback | `https://gateway-acme.example.com/auth/callback` | Must equal the gateway's `GATEWAY_OIDC_REDIRECT_URI` exactly. |
| E-mail domain | `acme.example` | Optional and unique; only a hint for shared clients ([Access spec §5.2](../access/spec.md#52-resolving-the-tenant)). |

### 2. Register the tenant and its identity provider

One upsert, keyed by slug, records both the tenant's provider and its gateway client ([API: register a tenant](../access/api.md#post-v1admintenants)):

```bash
curl -sS -X POST $ACCESS/v1/admin/tenants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"acme","displayName":"Acme Inc",
       "issuer":"https://login.acme.example",
       "idpClientId":"access-acme","idpClientSecret":"…",
       "idpRedirectUri":"https://access.example.com/oauth/tenant/callback",
       "emailDomain":"acme.example",
       "clientId":"gateway-acme","clientSecret":"…",
       "clientRedirectUris":["https://gateway-acme.example.com/auth/callback"]}' | jq .
```

The same call with the CLI:

```bash
platformctl access tenants create --slug acme --display-name "Acme Inc" \
  --issuer https://login.acme.example \
  --idp-client-id access-acme --idp-client-secret "$IDP_CLIENT_SECRET" \
  --idp-redirect-uri https://access.example.com/oauth/tenant/callback \
  --email-domain acme.example \
  --client-id gateway-acme --client-secret "$GATEWAY_CLIENT_SECRET" \
  --client-redirect-uri https://gateway-acme.example.com/auth/callback
```

In the console, a platform operator creates the tenant from **Operators** ([console user guide](../console/user-guide.md#administer-a-tenant)).

Keep the defaults unless you have a reason: `autoProvision` stays `false`, so nobody gets a principal just by signing in, and `sharedClient` stays `false`, so the tenant's gateway logs in only this tenant's people. Note the `id` in the answer: it is the tenant UUID that Data and the access context credentials use. A `201` means created, a `200` means an existing slug was updated.

A wrong issuer, client id or callback can be fixed by repeating the call, but Access keeps the provider client for ten minutes ([Access spec §6.6](../access/spec.md#66-provider-key-rotation)), so wait that long or roll the replicas.

### 3. Configure the tenant's gateway

The gateway treats Access as its only identity provider and its only decision service. Four values must match the registration character for character ([Access spec §13.2](../access/spec.md#132-settings-that-must-agree)):

```bash
GATEWAY_OIDC_ISSUER=https://access.example.com          # = ACCESS_ISSUER
GATEWAY_OIDC_CLIENT_ID=gateway-acme                     # = clientId
GATEWAY_OIDC_CLIENT_SECRET=…                            # = clientSecret
GATEWAY_OIDC_REDIRECT_URI=https://gateway-acme.example.com/auth/callback
GATEWAY_OIDC_SCOPES=openid,profile,email,groups
GATEWAY_OIDC_ROLES_CLAIM=roles
GATEWAY_ACCESS_URL=https://access.example.com
GATEWAY_ACCESS_TOKEN=…                                  # = ACCESS_DECISION_TOKEN
```

The reference gateway authenticates its decision calls with a bearer token only, so `GATEWAY_ACCESS_TOKEN` carries Access's shared, unscoped `ACCESS_DECISION_TOKEN` ([Access spec §8.8](../access/spec.md#88-gateway-credentials)). The docs do not describe how to make the reference gateway present the tenant's client id and secret on decisions instead.

A production gateway also needs its session secret, identity signing key, a rate limit and shared state; the full list is in [gateway configuration: required in production](../gateway/configuration.md#required-in-production).

The route that serves the tenant's workspace needs a workspace placeholder, and its `id` is the `routeId` your grants will name ([gateway spec §3](../gateway/spec.md#3-configuration-file)):

```json
{
  "id": "workspace-api",
  "match": { "host": "gateway-acme.example.com", "path": "/ws/{workspaceId}/" },
  "upstream": "http://upstream-b:3000",
  "auth": { "mode": "any", "workspace": { "param": "workspaceId", "requireUuid": true } }
}
```

Publish the table with `platformctl routes apply ./routes.json` or the control plane ([gateway operations: changing the route table](../gateway/operations.md#changing-the-route-table)). Connecting an upstream is covered in [Put a service behind the gateway](put-a-service-behind-the-gateway.md).

### 4. Connect Data, if the tenant uses it

Data serves a workspace only after two things exist:

1. The workspace is registered in Data under the tenant UUID from step 2 ([Data operations: workspaces](../data/operations.md#workspaces)):

   ```bash
   DATA_OWNER_DATABASE_URL=… bun run workspace -- create \
     --id $WORKSPACE --tenant <access tenant uuid> --slug acme --name "Acme"
   ```
2. Data's access context credential may ask about this tenant. Unless that token has the platform-wide `null` scope, add the tenant UUID (not the slug) to its list in `ACCESS_CONTEXT_TOKENS` and roll Access ([Access configuration: access context credentials](../access/configuration.md#access-context-credentials)):

   ```json
   {"the-token-of-the-backend": ["22222222-2222-4222-8222-222222222222", "<access tenant uuid>"]}
   ```

Data's binding for the route must carry the same `routeId` as the gateway route ([Data configuration: bindings file](../data/configuration.md#bindings-file)). Building on Data is covered in [Build an app on Data](build-an-app-on-data.md).

### 5. Register the first principal

A principal is the platform identity of one external account, keyed by the tenant and the provider's `sub` ([API: register a principal](../access/api.md#post-v1adminusers)):

```bash
USER_ID=$(curl -sS -X POST $ACCESS/v1/admin/users \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","externalSubject":"00u1a2b3c4d5","email":"alice@acme.example","displayName":"Alice"}' \
  | jq -r .id)
```

```bash
platformctl access principals create --tenant acme --subject 00u1a2b3c4d5 \
  --email alice@acme.example --display-name Alice
```

For a whole team, send up to 1 000 principals in one batch: `platformctl access principals import --file ./principals.json`, or the console's **Users** page with one `identity, e-mail, name` line per person. Each item succeeds or fails on its own ([API: batch of principals](../access/api.md#batch-of-principals)).

### 6. Give the first grant

A principal with no grant is refused everywhere. Grant a permission on the workspace and the gateway route from step 3 ([API: grants](../access/api.md#put-v1admingrants)):

```bash
curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"'"$USER_ID"'","permission":"workspace.read",
       "workspaceId":"'"$WORKSPACE"'","routeId":"workspace-api","grantedBy":"ops@example.com"}'
```

```bash
platformctl access grants put --tenant acme --user-id "$USER_ID" --permission workspace.read \
  --workspace-id "$WORKSPACE" --route-id workspace-api --granted-by ops@example.com
```

In the console this is the **Rights** page. Groups, roles, expiry and revocation are in [Manage access](manage-access.md).

### 7. Sign in for the first time

Open `https://gateway-acme.example.com/auth/login` in a browser. The gateway sends the browser to Access, Access resolves the tenant from the client id and forwards it to the tenant's provider, and the browser comes back to the gateway with a session ([Access spec §5.4](../access/spec.md#54-flow)). The token the gateway receives names the principal's UUID as its subject and lists the live grants' permissions in `roles`.

To let the tenant's people use the console as well, add `{CONSOLE_PUBLIC_URL}/auth/callback` to the tenant's `clientRedirectUris` ([console operations: set up Access](../console/operations.md#set-up-access)). The CLI's sign-in likewise needs its local callback allowed by the tenant ([CLI usage: sign in](../cli/usage.md#sign-in)).

### 8. Give the tenant's operator a credential

Instead of sharing the platform token, add a tenant credential to `ACCESS_ADMIN_TOKENS` and roll Access. Its scope names the slug and the operator, so the audit records a person rather than a fingerprint ([Access configuration: administration credentials](../access/configuration.md#administration-credentials)):

```json
{
  "the-token-of-the-operator-of-the-platform": null,
  "the-token-of-the-operator-of-acme": {"tenant": "acme", "operator": "alice"}
}
```

Each token is at least 16 characters. `ACCESS_ADMIN_TOKENS` has no `_FILE` form in this release, so set it in the environment. With this credential the operator can manage `acme`'s principals, groups, roles and grants, but cannot create tenants, touch another tenant, or change `sharedClient` or `default`.

For the console, also put the token in `CONSOLE_TENANT_ADMIN_TOKENS` (`{"acme":"…"}`) and grant the operator `console.admin` on the `console` route with the slug as workspace ([console configuration: what it needs from Access](../console/configuration.md#what-it-needs-from-access)):

```bash
curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"'"$USER_ID"'","permission":"console.admin","workspaceId":"acme","routeId":"console"}'
```

## Check that it worked

1. Ask Access the question the gateway will ask. The subject is the principal UUID, not the provider's `sub`; the CLI exits `0` on an allowance and `6` on a denial ([CLI spec §6.2](../cli/spec.md#62-exit-status)):

   ```bash
   platformctl access decide --subject "$USER_ID" --workspace "$WORKSPACE" --route workspace-api

   curl -sS -X POST $ACCESS/v1/decisions \
     -H "authorization: Bearer $ACCESS_DECISION_TOKEN" -H "content-type: application/json" \
     -d '{"subject":"'"$USER_ID"'","workspaceId":"'"$WORKSPACE"'","routeId":"workspace-api"}'
   # {"allow":true,"reason":"allowed"}
   ```
2. After the first sign-in, the principal's `lastLoginAt` is set and the tenant's counts have grown:

   ```bash
   curl -sS "$ACCESS/v1/admin/users?tenant=acme&email=alice@acme.example" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" | jq '.principals[0].lastLoginAt'
   curl -sS $ACCESS/v1/admin/tenants -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
     | jq '.tenants[] | select(.slug=="acme") | {userCount, grantCount}'
   ```
3. In the signed-in browser, open a path under `https://gateway-acme.example.com/ws/<workspace>/`. A response from the upstream, not a `403 workspace_forbidden`, proves login, decision and forwarding together. With Data behind the route, `platformctl data me --workspace "$WORKSPACE"` shows the principal, tenant and route Data sees.
4. On the metrics, `access_logins_total{tenant="acme",result="success"}` and `access_decisions_total{tenant="acme",result="allow"}` rise while `gateway_auth_failures_total` stays flat.
5. The audit holds `tenant.created`, `principal.created` and `grant.created` for the tenant: `platformctl access audit list --tenant acme`.

`scripts/cli/admin-smoke.ts` exercises all twelve administration calls against a deployment. It works on its own tenant (`ACCESS_SMOKE_SLUG`, default `smoke`), not on `acme` ([Access configuration: variables of the scripts and tests](../access/configuration.md#variables-of-the-scripts-and-tests)).

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| The tenant call answers `409 conflict`, `403 forbidden` or `400 invalid_request` | [Access troubleshooting: administration refusals](../access/troubleshooting.md#administration-refusals) |
| A tenant cannot be written at all | [Access troubleshooting: administration refusals](../access/troubleshooting.md#administration-refusals) (encryption key missing) |
| The browser stays on an Access page with `400 invalid_request`, `403 tenant_disabled`, `502 upstream_unavailable` or `403 identity_rejected` | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| `403 identity_unknown` at first sign-in | [Access troubleshooting: unknown identity](../access/troubleshooting.md#unknown-identity) |
| The gateway refuses Access's discovery document, or tokens stop verifying | [Access troubleshooting: token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems) |
| The gateway callback answers `400 login_failed` | [Gateway troubleshooting: login callback](../gateway/troubleshooting.md#the-login-callback-answers-400-login_failed) |
| Signed in, but requests get `403 workspace_forbidden` | [Gateway troubleshooting](../gateway/troubleshooting.md#403-workspace_forbidden), then [Access troubleshooting: decisions denied](../access/troubleshooting.md#decisions-denied) |
| Requests get `503 access_unavailable` | [Gateway troubleshooting](../gateway/troubleshooting.md#503-access_unavailable) |
| Data answers `401 UNAUTHENTICATED`, `403 FORBIDDEN` or `503 AUTHORIZATION_UNAVAILABLE` | [Data troubleshooting](../data/troubleshooting.md#403-forbidden), and [Access troubleshooting: access context refusals](../access/troubleshooting.md#access-context-refusals) |
| A `platformctl` command refuses | [CLI usage: when something refuses](../cli/usage.md#when-something-refuses) |

## Related

- [Access operations: first tenant](../access/operations.md#first-tenant) and [tenant cutover](../access/operations.md#tenant-cutover), for moving an existing tenant from another service
- [Access API: session in twelve calls](../access/api.md#session-in-twelve-calls)
- [Manage access](manage-access.md)
- [Rotate secrets](rotate-secrets.md)
- [Troubleshoot a request](troubleshoot-a-request.md)
- [Deploy the platform](deploy-the-platform.md)
