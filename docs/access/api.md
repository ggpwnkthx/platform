# HTTP API

Every endpoint of the access service with its request, response and errors. For the rules behind them, see [spec.md](spec.md).

## Conventions

- Bodies are JSON. Errors are `{"error": "<code>", "message": "<text>"}`, except the token endpoint, which uses the OAuth shape `{"error": "<code>", "error_description": "<text>"}`.
- Every response carries `x-request-id`, the request's identifier in the service logs. A client that sends a valid `x-request-id` gets its own value back.
- Every response carries `x-content-type-options: nosniff`, `x-frame-options: DENY` and `referrer-policy: no-referrer` (§5).

## Probes

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"access","version":"<version>"}` while the process is alive. `version` is the platform release. |
| `GET /readyz` | `200 {"status":"ready"}` when the database answers and migrations are applied; `503 {"status":"draining"}` during a drain; `503 {"status":"not-ready"}` otherwise. |
| `GET /metrics` | Prometheus text. `404` when `ACCESS_METRICS_TOKEN` is unset, `401` when the bearer token does not match. |

```bash
curl -sS https://access.example.com/healthz
curl -sS https://access.example.com/readyz
curl -sS https://access.example.com/metrics -H "authorization: Bearer $ACCESS_METRICS_TOKEN"
```

## API description

### `GET /openapi.json`

The service's OpenAPI description: the paths it serves and their response shapes. The API check compares it with the service's routes.

## OpenID Connect provider

### `GET /oauth/authorize`

The authorization endpoint. The gateway sends the browser here.

| Parameter | Rule |
| --- | --- |
| `client_id` | Required. Names the tenant (§5.2). |
| `redirect_uri` | Required. One of the tenant's registered `clientRedirectUris`. An unregistered URL gets `400 invalid_request` and the browser is not sent to it. |
| `response_type` | Required. `code`. |
| `scope` | Optional. `openid profile email groups`. |
| `state` | Optional. Returned to the gateway. |
| `nonce` | Optional. Bound to the issued token. |
| `code_challenge`, `code_challenge_method` | Optional. `S256`. |
| `tenant` | Only when the tenant's client is `shared_client`. |
| `login_hint` | Optional. An e-mail, used only when the client is shared. |

Response: `302` to the tenant's provider, or `400 invalid_request` (no tenant, bad parameters) or `403 tenant_disabled`.

### `GET /oauth/tenant/callback`

The access service's callback at a tenant's provider. The provider sends the browser here with `code` and `state`.

Response: `302` to the request's `redirect_uri` with the access service's code and the gateway's `state`. Refusals (§5.6): `400 login_state_invalid`, `400 invalid_request`, `403 identity_rejected`, `403 identity_unknown`, `403 principal_disabled`, `403 provider_error`, `403 tenant_disabled`, `502 upstream_unavailable`. An unexpected failure is `500 internal_error` and never carries a dependency's error.

### `POST /oauth/token`

Exchanges the code for tokens. The client authenticates with `client_secret_basic`.

```
POST /oauth/token
Authorization: Basic {client_id}:{client_secret}
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=…&redirect_uri=…&code_verifier=…
```

| Field | Rule |
| --- | --- |
| `grant_type` | Required. `authorization_code`. |
| `code` | Required. The login code. Single use, 60 seconds. |
| `redirect_uri` | Required. Same as in the authorization request. |
| `code_verifier` | Required when the request carried a `code_challenge`. |

```json
{
  "access_token": "eyJ…",
  "token_type": "Bearer",
  "expires_in": 300,
  "id_token": "eyJ…"
}
```

No refresh token is issued (§7.2). The response is never cached.

| Error | When |
| --- | --- |
| `401 invalid_client` | Credentials missing, unreadable or wrong. |
| `400 invalid_request` | Bad grant type, missing code or redirect URI. |
| `400 invalid_grant` | Code unknown, expired, already used, or bound to another client, redirect URI or challenge. |

### `GET /.well-known/openid-configuration`

The discovery document. Fields: §7.5.

### `GET /oauth/jwks`

The service's public keys (JWKS). During a rotation it carries the current and the previous key until the last token signed with the previous key has expired.

### `GET /oauth/userinfo`

The claims of a bearer token's principal: `sub`, `email`, `name`, `roles`.

```bash
curl -sS https://access.example.com/oauth/userinfo -H "authorization: Bearer $ACCESS_TOKEN"
```

`401` when the token is expired, signed with another key, or issued for another audience.

## Decision contract

### `POST /v1/decisions`

The contract the gateway already speaks; the access service does not change it.

```
POST /v1/decisions
Authorization: Bearer {ACCESS_DECISION_TOKEN}
Content-Type: application/json

{"subject":"…","workspaceId":"…","routeId":"…","roles":["…"]}
```

| Field | Rule |
| --- | --- |
| `subject` | Required. A principal id (UUID). |
| `workspaceId` | Optional. Defaults to the empty string. |
| `routeId` | Optional. Defaults to the empty string. |
| `roles` | Optional. Defaults to an empty list. Roles are **context**, never policy (§8.4). |

```json
{"allow": true, "reason": "allowed"}
{"allow": false, "reason": "the principal does not have the role of the workspace", "reasonCode": "missing_role"}
```

A denial carries a reason code; an allow does not. The codes are the gateway's vocabulary (`missing_role`, `access_denied`). The gateway counts the code when present and falls back to the reason text otherwise; code and text always agree (§8.2, §8.7).

Status codes: §8.2. Refusals, all of which the gateway treats as denials (it fails closed):

| Error | When |
| --- | --- |
| `401 unauthorized` | Credential missing or wrong. |
| `400 bad_request` | Body is not JSON, or the subject is not a string or not a principal id. |
| `503 service_unavailable` | Database down, or the decision took longer than `ACCESS_DECISION_TIMEOUT_MS`. |

Credentials are either scheme of §8.8: the deployment's bearer token (any principal on the platform) or a tenant's credentials (that tenant's principals only).

## Access context contract

> [!NOTE]
> Extension: a required integration change for the data backend. The decision contract is unchanged.

A data-owning service uses this contract to learn the **complete** set of a principal's capabilities for a workspace and route. The credential is neither the gateway's nor an administration credential: it is a dedicated read-only credential, scoped to an explicit set of tenants by `ACCESS_CONTEXT_TOKENS`.

### `GET /v1/access-context`

Contract discovery; consumers use it as their readiness check.

```
GET /v1/access-context
Authorization: Bearer {access context credential}
```

```json
{"versions":[1],"maxPermissionKeys":4096,"maxLifetimeMs":5000}
```

`401 unauthorized` when the credential is missing or wrong. Discovery reveals nothing about principals or grants.

### `POST /v1/access-context`

A principal's context.

```
POST /v1/access-context
Authorization: Bearer {access context credential}
Content-Type: application/json

{"version":1,"subject":"…","tenantId":"…","workspaceId":"…","routeId":"…"}
```

| Field | Rule |
| --- | --- |
| `version` | Required. `1`; any other value is `400 bad_request`. |
| `subject` | Required. A principal id (UUID). |
| `tenantId` | Required. The request's tenant (UUID). |
| `workspaceId` | Required. The request's workspace. |
| `routeId` | Required. The request's route. |

Unknown fields and fields of the wrong type are refused. The body is at most 64 KiB.

```json
{
  "version": 1,
  "allow": true,
  "subject": "…",
  "tenantId": "…",
  "workspaceId": "…",
  "routeId": "…",
  "permissionKeys": ["content.editor", "content.reader"],
  "evaluatedAt": "2026-10-21T16:00:00.000Z",
  "validUntil": "2026-10-21T16:00:05.000Z"
}
```

`permissionKeys` is the complete, sorted, deduplicated set of keys of the grants that apply. The response is never partial: more than 4096 keys is `503 service_unavailable`, never an allow with fewer keys.

A denial is `200` with `allow: false`, empty `permissionKeys` and no `validUntil`; it does not reveal the cause.

| Error | When |
| --- | --- |
| `401 unauthorized` | Credential missing or wrong. |
| `403 forbidden` | The credential may not ask about this tenant. |
| `400 bad_request` | Body not understood. |
| `503 service_unavailable` | The policy could not be fully evaluated. |

## Administration

Twelve endpoints under `/v1/admin`, plus `GET /v1/admin/audit`. All require `Authorization: Bearer <credential>`. Shared rules (limits, pagination, error codes, audit): §10.1.

A deployment may define per-tenant credentials in `ACCESS_ADMIN_TOKENS` (§4.6). A tenant credential may act only for its tenant: naming another tenant is `403 forbidden`, and its lists only show its tenant. The audit records the credential's operator.

| Credential | May act for |
| --- | --- |
| `ACCESS_ADMIN_TOKEN` | Every tenant. |
| A tenant credential in `ACCESS_ADMIN_TOKENS` | Its own tenant only. |
| A platform credential in `ACCESS_ADMIN_TOKENS` | Every tenant. |

### `POST /v1/admin/tenants`

Creates a tenant, or updates the tenant with that slug (upsert).

```bash
curl -sS -X POST https://access.example.com/v1/admin/tenants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "slug": "acme",
        "displayName": "Acme Inc",
        "issuer": "https://login.acme.example",
        "idpClientId": "access-acme",
        "idpClientSecret": "the-secret-of-the-provider",
        "idpRedirectUri": "https://access.example.com/oauth/tenant/callback",
        "emailDomain": "acme.example",
        "clientId": "gateway-acme",
        "clientSecret": "the-secret-of-the-gateway",
        "clientRedirectUris": ["https://gateway-acme.example.com/auth/callback"],
        "autoProvision": false,
        "sharedClient": false,
        "default": false,
        "enabled": true
      }'
```

| Field | Rule |
| --- | --- |
| `slug` | Required. `[a-z0-9-]{2,63}`. The row key. |
| `displayName` | Required. |
| `issuer` | Required. The tenant's provider issuer. |
| `idpClientId` | Required. |
| `idpClientSecret` | Required. Encrypted at rest, never returned. |
| `idpRedirectUri` | Optional. Default `https://{ACCESS_PUBLIC_URL}/oauth/tenant/callback`. |
| `idpScopes` | Optional. Default `["openid","email","profile"]`. |
| `idpAlgorithms` | Optional. Default `["RS256"]`. |
| `emailDomain` | Optional. Unique when set. |
| `clientId` | Required. The client id of the tenant's gateway at the access service. Unique across tenants. |
| `clientSecret` | Required. Encrypted at rest, never returned. On replacement, the old secret stays valid for 24 hours alongside the new one. |
| `clientRedirectUris` | Optional. Default `[]`. The gateway's registered callback URLs; the browser returns to one of them with the login code. Any other URL is `400 invalid_request`. A tenant with none refuses every login. |
| `autoProvision` | Optional. Default `false`. |
| `sharedClient` | Optional. Default `false`. Platform operators only: a tenant credential that sends a value different from the stored one gets `403 forbidden`. |
| `default` | Optional. Default `false`. At most one tenant is the default. Platform operators only, as for `sharedClient`. |
| `enabled` | Optional. Default `true`. |

Status codes: §10.2. `409 conflict` when the client id belongs to another tenant or a second tenant would become the default. `403 forbidden` when a tenant credential changes `sharedClient` or `default`.

```json
{
  "id": "6f0f…", "slug": "acme", "displayName": "Acme Inc",
  "issuer": "https://login.acme.example", "emailDomain": "acme.example",
  "clientId": "gateway-acme",
  "clientRedirectUris": ["https://gateway-acme.example.com/auth/callback"],
  "autoProvision": false, "sharedClient": false,
  "default": false, "enabled": true,
  "createdAt": "2026-01-08T10:00:00.000Z"
}
```

### `GET /v1/admin/tenants`

Lists tenants with their principal and grant counts.

```bash
curl -sS https://access.example.com/v1/admin/tenants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

```json
{
  "tenants": [
    {
      "id": "6f0f…", "slug": "acme", "displayName": "Acme Inc",
      "issuer": "https://login.acme.example", "emailDomain": "acme.example",
      "clientId": "gateway-acme", "autoProvision": false, "sharedClient": false,
      "default": false, "enabled": true,
      "userCount": 42, "grantCount": 57,
      "createdAt": "2026-01-08T10:00:00.000Z"
    }
  ]
}
```

### `POST /v1/admin/users`

Creates a principal, or updates the principal with that `(tenant, externalSubject)` pair (upsert). Rules: §10.4.

```bash
curl -sS -X POST https://access.example.com/v1/admin/users \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "externalSubject": "00u1a2b3c4d5",
        "email": "alice@acme.example",
        "displayName": "Alice",
        "status": "active"
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `externalSubject` | Required. The `sub` from the tenant's provider. |
| `email` | Optional. Published in the token until the provider says otherwise. |
| `displayName` | Optional. |
| `status` | Optional. `active` (default) or `disabled`. |

`404 not_found` when the tenant is unknown.

```json
{
  "id": "b1c2…", "tenant": "acme", "externalSubject": "00u1a2b3c4d5",
  "email": "alice@acme.example", "displayName": "Alice", "status": "active",
  "lastLoginAt": null, "createdAt": "2026-01-08T10:05:00.000Z"
}
```

#### Batch of principals

The body may carry a list of principals instead of one.

```bash
curl -sS -X POST https://access.example.com/v1/admin/users \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "principals": [
          {"tenant": "acme", "externalSubject": "00u1a2b3c4d5", "email": "alice@acme.example"},
          {"tenant": "acme", "externalSubject": "00u1a2b3c4d6", "email": "bob@acme.example"}
        ]
      }'
```

At most 1 000 principals per batch. **Each item is written separately**: a written item is audited, a failed item leaves nothing behind and does not stop the others. The response reports every item's outcome. The call is idempotent (§10.4).

```json
{
  "principals": [
    {"tenant": "acme", "externalSubject": "00u1a2b3c4d5", "id": "b1c2…", "created": true},
    {"tenant": "acme", "externalSubject": "00u1a2b3c4d6", "id": null, "created": false,
     "error": "not_found", "message": "the tenant does not exist"}
  ]
}
```

### `GET /v1/admin/users`

Lists principals.

```bash
curl -sS "https://access.example.com/v1/admin/users?tenant=acme&limit=50" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Parameter | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Absent: every tenant. |
| `status` | Optional. `active` or `disabled`. |
| `email` | Optional. Exact e-mail match. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

```json
{
  "principals": [
    {
      "id": "b1c2…", "tenant": "acme", "externalSubject": "00u1a2b3c4d5",
      "email": "alice@acme.example", "displayName": "Alice", "status": "active",
      "lastLoginAt": "2026-01-08T10:05:00.000Z",
      "createdAt": "2026-01-08T10:00:00.000Z"
    }
  ],
  "total": 42, "limit": 50, "offset": 0
}
```

Ordering and paging: §10.5. The list never carries a secret.

### `PUT /v1/admin/grants`

Creates a grant, or updates the grant with the body's `(tenant, user, permission, workspace, route)` tuple. Rules: §10.6.

```bash
curl -sS -X PUT https://access.example.com/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "userId": "b1c2…",
        "permission": "workspace.read",
        "workspaceId": "11111111-1111-4111-8111-111111111111",
        "routeId": "workspace-api",
        "expiresAt": null
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `userId` | The principal id. Exactly one of `userId` and `group` is required. |
| `group` | The group key. Exactly one of `userId` and `group` is required. |
| `permission` | The permission key. Exactly one of `permission` and `role` is required. A missing permission row is **created on demand** in the tenant's scope; keys are per tenant, so two tenants may each have a permission with the same key. |
| `role` | The role key. The grant holds the role's permissions. An unknown role is `404 not_found`. |
| `workspaceId` | Optional. `null` (default) means every workspace of the tenant. |
| `routeId` | Optional. `null` (default) means every route. |
| `expiresAt` | Optional. An ISO 8601 instant; `null` (default) never expires. |
| `grantedBy` | Optional. Who granted it, for the audit log. |

```json
{
  "id": "d3e4…", "tenant": "acme", "userId": "b1c2…",
  "permission": "workspace.read",
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "routeId": "workspace-api", "expiresAt": null, "revokedAt": null,
  "createdAt": "2026-01-08T10:06:00.000Z"
}
```

#### Batch of grants

The body may carry a list instead of one grant: `{"grants": [ … ]}`.

```json
{
  "grants": [
    {"tenant": "acme", "id": "d3e4…", "created": true},
    {"tenant": "acme", "id": null, "created": false,
     "error": "not_found", "message": "the principal does not exist"}
  ]
}
```

### `DELETE /v1/admin/grants/{id}`

Revokes a grant. The row is kept and stamped with `revoked_at`.

```bash
curl -sS -X DELETE https://access.example.com/v1/admin/grants/d3e4… \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -i
```

```
HTTP/1.1 204 No Content
```

Idempotent (§10.7). `404 not_found` when the id does not exist.

### `GET /v1/admin/grants`

Lists grants.

```bash
curl -sS "https://access.example.com/v1/admin/grants?tenant=acme&live=true" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Parameter | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Absent: every tenant. |
| `userId` | Optional. A principal id. |
| `live` | Optional. `true`: grants neither revoked nor expired. `false`: the others. Absent: all. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

```json
{
  "grants": [
    {
      "id": "d3e4…", "tenant": "acme", "userId": "b1c2…",
      "permission": "workspace.read",
      "workspaceId": "11111111-1111-4111-8111-111111111111",
      "routeId": "workspace-api", "expiresAt": null, "revokedAt": null,
      "grantedBy": "ops@example.com",
      "createdAt": "2026-01-08T10:10:00.000Z"
    }
  ],
  "total": 57, "limit": 50, "offset": 0
}
```

### `POST /v1/admin/groups`

Creates a group, or changes the group with that key (upsert). Rules, including membership: §10.9.

```bash
curl -sS -X POST https://access.example.com/v1/admin/groups \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "key": "team-platform",
        "displayName": "The platform team",
        "members": ["00u1a2b3c4d5", "00u9z8y7x6w5"]
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `key` | Required. `[a-z0-9][a-z0-9._-]{0,63}`. |
| `displayName` | Optional. |
| `members` | Optional. The members' **external subjects**. |

```json
{
  "id": "e5f6…", "tenant": "acme", "key": "team-platform",
  "displayName": "The platform team",
  "members": ["00u1a2b3c4d5", "00u9z8y7x6w5"],
  "createdAt": "2026-01-08T10:20:00.000Z"
}
```

### `GET /v1/admin/groups`

Lists groups, newest first. Read-only.

```bash
curl -sS "https://access.example.com/v1/admin/groups?tenant=acme&limit=20" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Query | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Unknown tenant: `404 not_found`. |
| `key` | Optional. A group key. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

Members are listed by external subject, as in the create response.

```json
{
  "groups": [
    {
      "id": "e5f6…", "tenant": "acme", "key": "team-platform",
      "displayName": "The platform team",
      "members": ["00u1a2b3c4d5", "00u9z8y7x6w5"],
      "createdAt": "2026-01-08T10:20:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### `PUT /v1/admin/roles`

Creates a role, or changes the role with that key (upsert). The call **replaces** the role's memberships: the permissions it holds and the roles it names.

```bash
curl -sS -X PUT https://access.example.com/v1/admin/roles \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "key": "role-editor",
        "displayName": "The editors",
        "description": "What the editors may do",
        "permissions": ["workspace.write"],
        "roles": ["role-reader"]
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `key` | Required. `[a-z0-9][a-z0-9._-]{0,63}`. |
| `displayName` | Optional. |
| `description` | Optional. |
| `permissions` | Optional. Permission keys the role holds. Missing keys are created in the tenant's scope. |
| `roles` | Optional. Role keys the role names. An unknown key is `404 not_found`. |

A role that names itself, directly or through other roles, is `409 conflict`: the nesting would never end.

```json
{
  "id": "a1b2…", "tenant": "acme", "key": "role-editor",
  "displayName": "The editors",
  "description": "What the editors may do",
  "permissions": ["workspace.write"],
  "roles": ["role-reader"],
  "createdAt": "2026-01-08T10:30:00.000Z"
}
```

### `GET /v1/admin/roles`

Lists roles, newest first. Read-only.

```bash
curl -sS "https://access.example.com/v1/admin/roles?tenant=acme&limit=20" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Query | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Unknown tenant: `404 not_found`. |
| `key` | Optional. A role key. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

Each role lists its permission keys and the role keys it names, as in the create response.

```json
{
  "roles": [
    {
      "id": "a1b2…", "tenant": "acme", "key": "role-editor",
      "displayName": "The editors",
      "permissions": ["workspace.write"],
      "roles": ["role-reader"],
      "createdAt": "2026-01-08T10:30:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### `DELETE /v1/admin/roles/{id}`

Removes a role that no grant names. Rules: §10.13.

```bash
curl -sS -X DELETE https://access.example.com/v1/admin/roles/a1b2c3d4-… \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

### `GET /v1/admin/audit`

Reads the change audit. Read-only. Rules: §10.15.

```bash
curl -sS "https://access.example.com/v1/admin/audit?tenant=acme&limit=20" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Query | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Unknown tenant: `404 not_found`. |
| `action` | Optional. An action name. |
| `limit` | Optional. Default `50`, maximum `200`. An export carries at most `10000`. |
| `offset` | Optional. Default `0`. |
| `format` | Optional. `json` (default), or `csv` / `jsonl` for an export. Anything else: `400 invalid_request`. |

Actions: `tenant.created`, `tenant.updated`, `principal.created`, `principal.updated`, `group.created`, `group.updated`, `grant.created`, `grant.updated`, `grant.revoked`, `role.created`, `role.updated`, `role.removed`.

The same statement writes the change and its audit row, so both commit or neither does. A failed call leaves no change; repeating it writes the same audit row.

```json
{
  "records": [
    {
      "id": "0f2c…",
      "at": "2026-01-08T10:30:00.000Z",
      "action": "grant.revoked",
      "targetId": "9fbfda13-…",
      "tenant": "acme",
      "operator": "6b1f2c9d0e3a",
      "address": "10.0.0.7",
      "requestId": "8452a08e-ebd7-4e61-ae99-fe051f3e531d"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

`operator` is the fingerprint of the calling credential: the first twelve hex characters of the token's digest. It identifies the operator without exposing the token.

#### Exporting the audit

To hand the history to someone as a file, call the same endpoint with a `format`:

```bash
# CSV, for a spreadsheet
curl -sS "https://access.example.com/v1/admin/audit?format=csv&tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -o acme-audit.csv

# JSON Lines, for a script
curl -sS "https://access.example.com/v1/admin/audit?format=jsonl&tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -o acme-audit.jsonl
```

List filters apply to the export. An export carries at most 10 000 rows; page through a larger audit with `limit` and `offset`.

```csv
id,at,action,targetId,tenant,operator,address,requestId
0f2c…,2026-01-08T10:30:00.000Z,grant.revoked,9fbfda13-…,acme,6b1f2c9d0e3a,10.0.0.7,8452a08e-…
```

## Session in twelve calls

A tenant's full lifecycle, from registration to revocation, using each administration endpoint once. Requires `curl` and `jq`.

```bash
export ACCESS=https://access.example.com
export ACCESS_ADMIN_TOKEN=…

# 1. Register the tenant and its gateway
curl -sS -X POST $ACCESS/v1/admin/tenants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"acme","displayName":"Acme Inc","issuer":"https://login.acme.example",
       "idpClientId":"access-acme","idpClientSecret":"…","clientId":"gateway-acme",
       "clientSecret":"…","emailDomain":"acme.example",
       "clientRedirectUris":["https://gateway-acme.example.com/auth/callback"]}'

# 2. List tenants with their counts
curl -sS $ACCESS/v1/admin/tenants -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 3. Create the principal of an external identity
USER_ID=$(curl -sS -X POST $ACCESS/v1/admin/users \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","externalSubject":"00u1a2b3c4d5","email":"alice@acme.example"}' | jq -r .id)

# 4. List the tenant's principals
curl -sS "$ACCESS/v1/admin/users?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 5. Grant a permission on a workspace and route
GRANT_ID=$(curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"'"$USER_ID"'","permission":"workspace.read",
       "workspaceId":"11111111-1111-4111-8111-111111111111","routeId":"workspace-api"}' | jq -r .id)

# 6. List the tenant's grants
curl -sS "$ACCESS/v1/admin/grants?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 7. Create a group; a grant to the group applies to every member
curl -sS -X POST $ACCESS/v1/admin/groups \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","key":"team-platform","displayName":"The platform team",
       "members":["00u1a2b3c4d5"]}'

# 8. List the tenant's groups
curl -sS "$ACCESS/v1/admin/groups?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 9. Create a role holding a permission
ROLE_ID=$(curl -sS -X PUT $ACCESS/v1/admin/roles \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","key":"role-editor","displayName":"The editors",
       "permissions":["workspace.write"]}' | jq -r .id)

# 10. List the tenant's roles
curl -sS "$ACCESS/v1/admin/roles?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 11. Remove the role (no grant names it)
curl -sS -X DELETE $ACCESS/v1/admin/roles/$ROLE_ID -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 12. Revoke the grant when access must end
curl -sS -X DELETE $ACCESS/v1/admin/grants/$GRANT_ID -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

To grant a role instead of a permission, send `"role":"role-editor"` in place of `"permission"` in step 5.

`scripts/cli/admin-smoke.ts` runs the same sequence against a deployment:

```bash
ACCESS_URL=$ACCESS ACCESS_ADMIN_TOKEN=$ACCESS_ADMIN_TOKEN bun run scripts/cli/admin-smoke.ts
```
