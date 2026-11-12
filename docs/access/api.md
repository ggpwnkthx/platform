# HTTP API

Every Access endpoint with its request, response, errors and a `curl` example, ending with a tenant's whole session in twenty-one calls. It is written for developers and operators who call Access; the rules behind each endpoint are in the [specification](spec.md), cited as `§N`.

## Conventions

- Bodies are JSON. Errors are `{"error": "<code>", "message": "<text>"}`, except the token endpoint, which uses the OAuth shape `{"error": "<code>", "error_description": "<text>"}`.
- Every response carries `x-request-id` (the client's own value if it sent a valid one), `x-content-type-options: nosniff`, `x-frame-options: DENY` and `referrer-policy: no-referrer` (§5.6).
- The examples use `https://access.example.com`; replace it with your `ACCESS_PUBLIC_URL` ([Configuration](configuration.md)).
- When a call fails, look the status and error code up in [Troubleshooting](troubleshooting.md).

## Probes

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"access","version":"<version>"}` (§12.1). |
| `GET /readyz` | `200 {"status":"ready"}`, `503 {"status":"draining"}` or `503 {"status":"not-ready"}` (§12.1). |
| `GET /metrics` | Prometheus text. `404` when `ACCESS_METRICS_TOKEN` is unset, `401` when the bearer token does not match. |

```bash
curl -sS https://access.example.com/healthz
curl -sS https://access.example.com/readyz
curl -sS https://access.example.com/metrics -H "authorization: Bearer $ACCESS_METRICS_TOKEN"
```

## API description

### `GET /openapi.json`

The OpenAPI description of the served paths and response shapes. The repository's API check (`bun run api:check`) compares it with the registered routes.

## OpenID Connect provider

### `GET /oauth/authorize`

| Parameter | Rule |
| --- | --- |
| `client_id` | Required. Names the tenant (§5.2). |
| `redirect_uri` | Required. One of the tenant's `clientRedirectUris`; otherwise `400 invalid_request`. |
| `response_type` | Required. `code`. |
| `scope` | Optional. `openid profile email groups offline_access`. |
| `state` | Optional. Returned to the gateway. |
| `nonce` | Optional. Bound to the issued token. |
| `code_challenge`, `code_challenge_method` | Optional. `S256`. |
| `tenant` | Only when the tenant's client is `shared_client`. |
| `provider` | Optional. The slug of a provider of the tenant of the login (§5.2.1). |
| `login_hint` | Optional. An e-mail, used only when the client is shared. |

Response: `302` to the tenant's provider, `400 invalid_request` (no tenant, bad parameters, unregistered `redirect_uri`) or `403 tenant_disabled`.

A shared client that names no tenant and carries no hint answers `302` to `/oauth/discover`: the caller is asked for the address of the login (§5.2.2).

### `GET /oauth/discover`

The page that asks for the address of the caller (§5.2.2). The caller never leaves the origin of the service.

The page needs a login that is in flight: the cookie of the page holds its state, and a login that is not in flight has no page.

```html
<form method="post" action="/oauth/discover">
  <input type="hidden" name="token" value="…" />
  <input id="email" name="email" type="email" required autocomplete="username" />
</form>
```

The page names no tenant of the platform: an answer that says whether a domain is known tells the caller which tenants the platform holds.

### `POST /oauth/discover`

The answer of the form of the address (§5.2.2).

| Field | Rule |
| --- | --- |
| `token` | Required. The state of the provider: it is bound to the state of the login. |
| `email` | Required. The address of the caller. |

The answer is `302` to the provider of the tenant the domain of the address names. A login that is not in flight, a token that does not match it and an address that is no address answer `400 login_state_invalid` with a page saying that the login has to start again.

### `GET /oauth/local/authorize`

The page that asks for the password of a local provider (§5.4.1). Access serves it: the caller never leaves the origin of the service.

The page needs the state of a login in flight: it is in the cookie of the page, and a login that is not in flight has no page.

```html
<form method="post" action="/oauth/local/login">
  <input type="hidden" name="token" value="…" />
  <input id="email" name="email" type="email" required autocomplete="username" />
  <input id="password" name="password" type="password" required autocomplete="current-password" />
</form>
```

### `POST /oauth/local/login`

The answer of the form of the password (§5.4.2).

| Field | Rule |
| --- | --- |
| `token` | Required. The state of the provider: it is bound to the state of the login. |
| `email` | Required. The address of the account. |
| `password` | Required. The password of the account. |

A credential that signed in answers `302` with the callback of Access: `Location: /oauth/tenant/callback?code=…&state=…`.

A refused sign-in answers `403 identity_rejected` with a page saying that the address or the password is wrong — the same answer for an address that names no account, a wrong password, a disabled account and a locked account. Too many failures from one address answer `429 too_many_requests`.

### `GET /oauth/tenant/callback`

Where the tenant's provider returns the browser with `code` and `state`. Response: `302` to the request's `redirect_uri` with Access's code and the gateway's `state`. Refusals (§5.6): `400 login_state_invalid`, `400 invalid_request`, `403 identity_rejected`, `403 identity_unknown`, `403 principal_disabled`, `403 provider_error`, `403 tenant_disabled`, `502 upstream_unavailable`. An unexpected failure is `500 internal_error` and never carries a dependency's error.

### `POST /oauth/token`

Exchanges the code for tokens; the client authenticates with `client_secret_basic`.

```http
POST /oauth/token
Authorization: Basic {client_id}:{client_secret}
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=…&redirect_uri=…&code_verifier=…
```

| Field | Rule |
| --- | --- |
| `grant_type` | Required. `authorization_code` or `refresh_token`. |
| `code` | Required for `authorization_code`. The login code. Single use, 60 seconds. |
| `redirect_uri` | Required for `authorization_code`. Same as in the authorization request. |
| `code_verifier` | Required when the request carried a `code_challenge`. |
| `refresh_token` | Required for `refresh_token`. Single use, twelve hours (§7.6). |

```json
{
  "access_token": "eyJ…",
  "token_type": "Bearer",
  "expires_in": 300,
  "id_token": "eyJ…",
  "refresh_token": "…"
}
```

The refresh token is in the answer only when the login asked for the scope `offline_access`; `cache-control: no-store`.

| Error | When |
| --- | --- |
| `401 invalid_client` | Credentials missing, unreadable or wrong. |
| `400 invalid_request` | Bad grant type, missing code, redirect URI or refresh token. |
| `400 invalid_grant` | Code unknown, expired, already used, or bound to another client, redirect URI or challenge; or a refresh token unknown, expired, already used, or bound to another client. |

### `GET /.well-known/openid-configuration`

The discovery document. Fields: §7.5.

### `GET /oauth/jwks`

The service's public keys; during a rotation, the current and previous key (§4.2).

### `GET /oauth/userinfo`

The claims of a bearer token's principal: `sub`, `email`, `name`, `roles`.

```bash
curl -sS https://access.example.com/oauth/userinfo -H "authorization: Bearer $ACCESS_TOKEN"
```

`401` when the token is expired, signed with another key, or issued for another audience.

## The catalog of the providers

### `GET /v1/catalog`

The providers the platform supports out of the box (§5.4.3). The catalog is a description of the platform: a preset fills the issuer, the scopes and the algorithms of a provider, and it says how the client of Access is registered at the vendor. Every caller may read it.

```bash
curl -sS https://access.example.com/v1/catalog
```

```json
{
  "providers": [
    {
      "key": "entra",
      "displayName": "Microsoft Entra ID",
      "slug": "entra",
      "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
      "scopes": ["openid", "email", "profile"],
      "algorithms": ["RS256"],
      "steps": [
        "Register an application of type web at Entra ID, with the redirect URI {ACCESS_PUBLIC_URL}/oauth/tenant/callback and no other.",
        "Create a client secret of the application and copy its value: it is shown once.",
        "Grant the delegated permissions openid, email and profile.",
        "The issuer of the tenant is the one of the application: https://login.microsoftonline.com/{tenant-id}/v2.0."
      ]
    }
  ]
}
```

A preset never constrains what a tenant registers: every field of a registration belongs to the tenant.

## Decision contract

### `POST /v1/decisions`

```http
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

Only a denial carries `reasonCode` (`missing_role` or `access_denied`), which always agrees with the text (§8.2, §8.7). The gateway treats every refusal as a denial:

| Error | When |
| --- | --- |
| `401 unauthorized` | Credential missing or wrong. |
| `400 bad_request` | Body is not JSON, or the subject is not a string or not a principal id. |
| `503 service_unavailable` | Database down, or the decision took longer than `ACCESS_DECISION_TIMEOUT_MS`. |

Credentials (§8.8): the deployment's bearer token (any principal) or a tenant's credentials (its principals only).

## Access context contract

> [!NOTE]
> Extension: a required integration change for the data backend. The decision contract is unchanged.

A data-owning service reads a principal's complete capabilities for a workspace and route (§9). The credential is a dedicated read-only one from `ACCESS_CONTEXT_TOKENS`, scoped to listed tenants.

### `GET /v1/access-context`

Contract discovery, used by consumers as a readiness check.

```http
GET /v1/access-context
Authorization: Bearer {access context credential}
```

```json
{"versions":[1],"maxPermissionKeys":4096,"maxLifetimeMs":5000}
```

`401 unauthorized` when the credential is missing or wrong.

### `POST /v1/access-context`

A principal's context.

```http
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

Unknown or mistyped fields are refused; the body is at most 64 KiB.

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

`permissionKeys` is complete, sorted and deduplicated; more than 4096 keys is `503 service_unavailable` (§9.3). A denial is `200` with `allow: false`, empty `permissionKeys` and no `validUntil`.

| Error | When |
| --- | --- |
| `401 unauthorized` | Credential missing or wrong. |
| `403 forbidden` | The credential may not ask about this tenant. |
| `400 bad_request` | Body not understood. |
| `503 service_unavailable` | The policy could not be fully evaluated. |

## Administration

The twenty-one administrative endpoints live under `/v1/admin`, next to `GET /v1/admin/audit`; every call sends `Authorization: Bearer <credential>`. The credential is `ACCESS_ADMIN_TOKEN` or one from `ACCESS_ADMIN_TOKENS` (§4.6); a tenant credential acts only for its tenant, and naming another is `403 forbidden`. Limits, pagination, error codes and auditing: §10.1.

### `POST /v1/admin/tenants`

Upsert by slug (§10.2).

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
| `issuer` | Required to create a tenant. The tenant's provider issuer. A change that leaves it out keeps the issuer the tenant has. |
| `idpClientId` | Required to create a tenant. A change that leaves it out keeps the client the tenant has. |
| `idpClientSecret` | Required to create a tenant. Encrypted at rest, never returned. A change that leaves it out keeps the secret the tenant has. |
| `idpRedirectUri` | Optional. Default `https://{ACCESS_PUBLIC_URL}/oauth/tenant/callback` when the tenant is created. A change that leaves it out keeps the callback the tenant has. |
| `idpScopes` | Optional. Default `["openid","email","profile"]` when the tenant is created. A change that leaves it out keeps the scopes the tenant has. |
| `idpAlgorithms` | Optional. Default `["RS256"]` when the tenant is created. A change that leaves it out keeps the algorithms the tenant has. |
| `emailDomain` | Optional. Unique when set. |
| `clientId` | Required. The client id of the tenant's gateway at Access. Unique across tenants. |
| `clientSecret` | Required. Encrypted at rest, never returned. On replacement, the old secret stays valid for 24 hours alongside the new one. |
| `clientRedirectUris` | Optional. Default `[]`. The gateway's callback URLs; a tenant with none refuses every login. |
| `autoProvision` | Optional. Default `false`. A tenant that provisions its identities creates a principal at the first login of an identity it does not know (§6.4). |
| `autoProvisionAdmin` | Optional. Default `true`. A tenant that hands its administration to its first identity gives the role that administers it to the principal that signs in first (§6.4). |
| `sharedClient` | Optional. Default `false`. Platform operators only (§10.1). |
| `default` | Optional. Default `false`. At most one tenant. Platform operators only. |
| `enabled` | Optional. Default `true`. |

`409 conflict` when the client id belongs to another tenant or a second default would appear; `403 forbidden` when a tenant credential changes `sharedClient` or `default`; `400 invalid_request` when the call creates a tenant and names no provider of its identity, and when the call changes the provider of a tenant — the issuer or the client — and names no secret of it. The secret of a provider belongs to that provider.

A tenant that is created holds the role that administers it, `admin`, and the role holds the permissions an administration needs: the right to open the administration of the tenant, the detail of the status of the services, and the capabilities that administer a workspace (§6.4).

```json
{
  "id": "6f0f…", "slug": "acme", "displayName": "Acme Inc",
  "issuer": "https://login.acme.example", "idpClientId": "access-acme",
  "emailDomain": "acme.example",
  "clientId": "gateway-acme",
  "clientRedirectUris": ["https://gateway-acme.example.com/auth/callback"],
  "autoProvision": false, "autoProvisionAdmin": true,
  "sharedClient": false,
  "default": false, "enabled": true,
  "createdAt": "2026-01-08T10:00:00.000Z"
}
```

### `GET /v1/admin/tenants`

Tenants with principal and grant counts.

```bash
curl -sS https://access.example.com/v1/admin/tenants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

```json
{
  "tenants": [
    {
      "id": "6f0f…", "slug": "acme", "displayName": "Acme Inc",
      "issuer": "https://login.acme.example", "idpClientId": "access-acme",
      "emailDomain": "acme.example",
      "clientId": "gateway-acme", "autoProvision": false, "autoProvisionAdmin": true,
      "sharedClient": false,
      "default": false, "enabled": true,
      "userCount": 42, "grantCount": 57,
      "createdAt": "2026-01-08T10:00:00.000Z"
    }
  ]
}
```

### `POST /v1/admin/users`

Upsert by `(tenant, provider, externalSubject)` (§10.4).

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
| `provider` | Optional. The slug of the provider of the principal. Absent: the default provider of the tenant. |
| `email` | Optional. Published in the token until the provider says otherwise. |
| `displayName` | Optional. |
| `status` | Optional. `active` (default) or `disabled`. |

`404 not_found` when the tenant or the provider is unknown.

```json
{
  "id": "b1c2…", "tenant": "acme", "provider": "default",
  "externalSubject": "00u1a2b3c4d5",
  "email": "alice@acme.example", "displayName": "Alice", "status": "active",
  "lastLoginAt": null, "createdAt": "2026-01-08T10:05:00.000Z"
}
```

#### Batch of principals

Send `principals` instead of one principal:

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

At most 1 000 per batch. Items are written separately, and a failed item does not stop the others (§10.4).

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
      "id": "b1c2…", "tenant": "acme", "provider": "default",
      "externalSubject": "00u1a2b3c4d5",
      "email": "alice@acme.example", "displayName": "Alice", "status": "active",
      "lastLoginAt": "2026-01-08T10:05:00.000Z",
      "createdAt": "2026-01-08T10:00:00.000Z"
    }
  ],
  "total": 42, "limit": 50, "offset": 0
}
```

Ordering and paging: §10.5.

### `POST /v1/admin/providers`

Upsert by `(tenant, slug)` (§10.16). The slug of a provider never changes.

```bash
curl -sS -X POST https://access.example.com/v1/admin/providers \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "slug": "okta",
        "displayName": "Okta",
        "issuer": "https://login.okta.example",
        "idpClientId": "access-acme-okta",
        "idpClientSecret": "the-secret-of-okta",
        "idpRedirectUri": "https://access.example.com/oauth/tenant/callback",
        "idpScopes": ["openid", "email", "profile"]
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `slug` | Required. The name of the provider inside the tenant, `[a-z0-9-]{2,63}`. It never changes. |
| `displayName` | Optional. The name shown to a human. |
| `enabled` | Optional. `true` (default) or `false`. A disabled provider signs nobody in. |
| `issuer` | Required when the provider is created. |
| `idpClientId` | Required when the provider is created. |
| `idpClientSecret` | Required when the provider is created. A change that names another provider and no secret is refused. |
| `idpRedirectUri` | Required when the provider is created. |
| `idpScopes` | Optional. Default `openid`, `email`, `profile`. |

`400 invalid_request` when the slug is `default` — the default provider of a tenant is the registration of the tenant — and when a change names another provider and no secret of it. `404 not_found` when the tenant is unknown.

```json
{
  "provider": {
    "id": "d4e5…", "tenant": "acme", "slug": "okta", "displayName": "Okta",
    "enabled": true, "issuer": "https://login.okta.example",
    "idpClientId": "access-acme-okta",
    "idpRedirectUri": "https://access.example.com/oauth/tenant/callback",
    "idpScopes": ["openid", "email", "profile"],
    "idpAlgorithms": ["RS256"],
    "createdAt": "2026-01-08T10:05:00.000Z"
  }
}
```

### `GET /v1/admin/providers`

```bash
curl -sS "https://access.example.com/v1/admin/providers?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Parameter | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Absent: every tenant. |
| `slug` | Optional. The slug of the provider. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

```json
{
  "providers": [
    {
      "id": "d4e5…", "tenant": "acme", "slug": "okta", "displayName": "Okta",
      "enabled": true, "issuer": "https://login.okta.example",
      "idpClientId": "access-acme-okta",
      "idpRedirectUri": "https://access.example.com/oauth/tenant/callback",
      "idpScopes": ["openid", "email", "profile"],
      "idpAlgorithms": ["RS256"],
      "createdAt": "2026-01-08T10:05:00.000Z"
    }
  ],
  "total": 2, "limit": 50, "offset": 0
}
```

The secret of a provider is never answered.

### `DELETE /v1/admin/providers/{id}`

```bash
curl -sS -X DELETE https://access.example.com/v1/admin/providers/d4e5… \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

`204` when the provider is removed. `400 invalid_request` when the provider is the default one of its tenant, `409 conflict` when it holds principals, `404 not_found` when the identifier names no provider.

### `POST /v1/admin/routes`

Upsert by `(kind, key)` (§10.18). A route that is created waits for its proof: it routes nothing until the owner of the domain publishes the challenge.

```bash
curl -sS -X POST https://access.example.com/v1/admin/routes \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "kind": "domain",
        "key": "acme.example",
        "provider": "okta"
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `kind` | Optional. `domain` (default) or `address`. |
| `key` | Required. The domain, or the address. |
| `provider` | Optional. The provider of the tenant the login signs in at. Absent: the default provider of the tenant. |

`400 invalid_request` when the key is neither a domain nor an address. `404 not_found` when the tenant is unknown or when the provider belongs to no tenant. `403 forbidden` when a credential of a tenant names another tenant.

```json
{
  "route": {
    "id": "e7f8…", "kind": "domain", "key": "acme.example",
    "tenant": "acme", "provider": "okta",
    "status": "pending", "verification": null,
    "challenge": "9f2c1d4b8e7a6350",
    "verifiedAt": null, "verifiedBy": null,
    "createdAt": "2026-01-08T10:05:00.000Z"
  }
}
```

The challenge is the token the owner of the domain publishes as a TXT record of `_access.acme.example`.

### `GET /v1/admin/routes`

```bash
curl -sS "https://access.example.com/v1/admin/routes?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Parameter | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Absent: every tenant. |
| `kind` | Optional. `domain` or `address`. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

```json
{
  "routes": [
    {
      "id": "e7f8…", "kind": "domain", "key": "acme.example",
      "tenant": "acme", "provider": "okta",
      "status": "verified", "verification": "dns",
      "challenge": "9f2c1d4b8e7a6350",
      "verifiedAt": "2026-01-08T10:06:00.000Z", "verifiedBy": null,
      "createdAt": "2026-01-08T10:05:00.000Z"
    }
  ],
  "total": 1, "limit": 50, "offset": 0
}
```

### `POST /v1/admin/routes/{id}/verify`

The proof of a route, or the refusal of one.

```bash
curl -sS -X POST https://access.example.com/v1/admin/routes/e7f8…/verify \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"status": "verified", "verification": "dns"}'
```

| Field | Rule |
| --- | --- |
| `status` | Required. `verified` or `rejected`. |
| `verification` | Required. `dns` or `operator`. |

The proof of a domain is the TXT record of `_access` of the domain: the service reads it and compares it with the challenge of the route. `409 conflict` when the record does not carry the challenge — the owner of the domain has not published it yet. `403 forbidden` when a credential of a tenant tries to verify a route with the operator of the platform. `404 not_found` when the identifier names no route.

### `POST /v1/admin/credentials`

Upsert by `(tenant, provider, email)` (§10.17). The provider must be a local one.

```bash
curl -sS -X POST https://access.example.com/v1/admin/credentials \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "tenant": "acme",
        "provider": "local",
        "email": "alice@acme.example",
        "password": "a-long-password-of-the-account"
      }'
```

| Field | Rule |
| --- | --- |
| `tenant` | Required. The tenant slug. |
| `provider` | Required. The slug of the **local** provider of the credential. |
| `email` | Required. The address of the account. |
| `password` | Required. At least 12 characters, at most 128. |
| `status` | Optional. `active` (default) or `disabled`. |

`400 invalid_request` when the provider is not a local one and when the password is too short or too long. `404 not_found` when the tenant does not exist, and when the provider does not exist either.

```json
{
  "credential": {
    "id": "e6f7…", "tenant": "acme", "provider": "local",
    "email": "alice@acme.example", "status": "active",
    "failedAttempts": 0, "lockedUntil": null,
    "passwordChangedAt": "2026-01-08T10:05:00.000Z",
    "createdAt": "2026-01-08T10:05:00.000Z"
  }
}
```

The answer never carries the verifier of the password.

### `GET /v1/admin/credentials`

```bash
curl -sS "https://access.example.com/v1/admin/credentials?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

| Parameter | Rule |
| --- | --- |
| `tenant` | Optional. A tenant slug. Absent: every tenant. |
| `provider` | Optional. The slug of the provider. |
| `email` | Optional. Exact e-mail match. |
| `limit` | Optional. Default `50`, maximum `200`. |
| `offset` | Optional. Default `0`. |

### `DELETE /v1/admin/credentials/{id}`

```bash
curl -sS -X DELETE https://access.example.com/v1/admin/credentials/e6f7… \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

`204` when the credential is removed. `404 not_found` when the identifier names no credential.

### `PUT /v1/admin/grants`

Upsert by `(tenant, user, permission, workspace, route)` (§10.6).

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
| `permission` | The permission key, created in the tenant's scope if missing. Exactly one of `permission` and `role` is required. A capability of the platform may only be granted by a credential of the platform (§3.3). |
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

Send `{"grants": [ … ]}` instead of one grant; the response reports each item:

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

Revokes a grant; the row is kept with `revoked_at` set.

```bash
curl -sS -X DELETE https://access.example.com/v1/admin/grants/d3e4… \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -i
```

```http
HTTP/1.1 204 No Content
```

Idempotent; `404 not_found` for an unknown id (§10.7).

### `GET /v1/admin/grants`

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

Upsert by key; membership rules in §10.9.

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

Groups, newest first.

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

Upsert by key; **replaces** the role's permissions and nested roles (§10.11).

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
| `permissions` | Optional. Permission keys the role holds. Missing keys are created in the tenant's scope. A capability of the platform may only be put in a role by a credential of the platform (§3.3). |
| `roles` | Optional. Role keys the role names. An unknown key is `404 not_found`. |

A role that names itself, directly or through others, is `409 conflict`.

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

Roles, newest first.

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

Removes a role that no grant names (§10.13).

```bash
curl -sS -X DELETE https://access.example.com/v1/admin/roles/a1b2c3d4-… \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

### `GET /v1/admin/audit`

Reads the change audit (§10.15).

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

Actions: `tenant.created`, `tenant.updated`, `principal.created`, `principal.updated`, `group.created`, `group.updated`, `grant.created`, `grant.updated`, `grant.revoked`, `role.created`, `role.updated`, `role.removed`, and for a role's memberships `role.permission.granted`, `role.permission.revoked`, `role.role.nested`, `role.role.unnested`.

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

`operator` is the credential's name, or the first twelve hex characters of its digest (§10.1).

#### Exporting the audit

Add `format` to get a file:

```bash
# CSV, for a spreadsheet
curl -sS "https://access.example.com/v1/admin/audit?format=csv&tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -o acme-audit.csv

# JSON Lines, for a script
curl -sS "https://access.example.com/v1/admin/audit?format=jsonl&tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -o acme-audit.jsonl
```

Filters apply. An export holds at most 10 000 rows; page with `limit` and `offset` beyond that.

```csv
id,at,action,targetId,tenant,operator,address,requestId
0f2c…,2026-01-08T10:30:00.000Z,grant.revoked,9fbfda13-…,acme,6b1f2c9d0e3a,10.0.0.7,8452a08e-…
```

## Session in twenty-one calls

The twenty-one calls of the session take a tenant from registration to revocation, using each administration endpoint once. You need `curl` and `jq`.

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

# 5. Register a local provider of the tenant
PROVIDER_ID=$(curl -sS -X POST $ACCESS/v1/admin/providers \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","kind":"local","slug":"local","displayName":"The accounts of the tenant"}' | jq -r .provider.id)

# 6. List the tenant's providers
curl -sS "$ACCESS/v1/admin/providers?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 7. Write a credential of the local provider
CREDENTIAL_ID=$(curl -sS -X POST $ACCESS/v1/admin/credentials \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","provider":"local","email":"alice@acme.example",
       "password":"a-long-password-of-the-account"}' | jq -r .credential.id)

# 8. List the tenant's credentials
curl -sS "$ACCESS/v1/admin/credentials?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 9. Grant a permission on a workspace and route
GRANT_ID=$(curl -sS -X PUT $ACCESS/v1/admin/grants \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","userId":"'"$USER_ID"'","permission":"workspace.read",
       "workspaceId":"11111111-1111-4111-8111-111111111111","routeId":"workspace-api"}' | jq -r .id)

# 10. List the tenant's grants
curl -sS "$ACCESS/v1/admin/grants?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 11. Create a group; a grant to the group applies to every member
curl -sS -X POST $ACCESS/v1/admin/groups \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","key":"team-platform","displayName":"The platform team",
       "members":["00u1a2b3c4d5"]}'

# 12. List the tenant's groups
curl -sS "$ACCESS/v1/admin/groups?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 13. Create a role holding a permission
ROLE_ID=$(curl -sS -X PUT $ACCESS/v1/admin/roles \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","key":"role-editor","displayName":"The editors",
       "permissions":["workspace.write"]}' | jq -r .id)

# 14. List the tenant's roles
curl -sS "$ACCESS/v1/admin/roles?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 15. Register the route of the domain of the tenant
ROUTE_ID=$(curl -sS -X POST $ACCESS/v1/admin/routes \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"tenant":"acme","kind":"domain","key":"acme.example"}' | jq -r .route.id)

# 16. List the tenant's routes
curl -sS "$ACCESS/v1/admin/routes?tenant=acme" \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 17. Verify the route: the operator of the platform vouches for the domain
curl -sS -X POST $ACCESS/v1/admin/routes/$ROUTE_ID/verify \
  -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"status":"verified","verification":"operator"}'

# 18. Remove the role (no grant names it)
curl -sS -X DELETE $ACCESS/v1/admin/roles/$ROLE_ID -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 19. Remove the credential
curl -sS -X DELETE $ACCESS/v1/admin/credentials/$CREDENTIAL_ID -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 20. Remove the provider (it holds no principal)
curl -sS -X DELETE $ACCESS/v1/admin/providers/$PROVIDER_ID -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"

# 21. Revoke the grant when access must end
curl -sS -X DELETE $ACCESS/v1/admin/grants/$GRANT_ID -H "authorization: Bearer $ACCESS_ADMIN_TOKEN"
```

To grant a role, send `"role":"role-editor"` instead of `"permission"` in step 9. `scripts/cli/admin-smoke.ts` runs the same sequence against a deployment:

```bash
ACCESS_URL=$ACCESS ACCESS_ADMIN_TOKEN=$ACCESS_ADMIN_TOKEN bun run scripts/cli/admin-smoke.ts
```
