# Rotate secrets

Replace every secret of the platform, service by service, in an order that keeps traffic flowing: what each rotation costs callers, which side to change first, and how to prove the new value is in use. It is for [security engineers](../roles/secops.md) and the [operators](../roles/sysops.md) who roll the deployments.

## Before you start

- Every secret lives in your secret manager and reaches the services as a file where the service accepts one ([platform security: secrets](../platform/security.md#secrets)). Rotating means writing a new file and rolling the service that reads it.
- You can roll each deployment without a gap: readiness-gated rolling replacement, ideally `maxUnavailable: 0` with a surge. Each service reads its environment only at start.
- You hold a platform administration credential for Access and know which gateways, Data deployments, consoles and scripts present each Access credential.
- You know whether any Data route still uses the legacy `v4` identity format; if so, [leave it](../data/operations.md#leave-the-legacy-identity-format) before rotating the gateway's secrets.

What each rotation costs:

| Secret | Held by | Presented or verified by | Cost to callers |
| --- | --- | --- | --- |
| `GATEWAY_SESSION_SECRET` | gateway | nobody else | Logins in flight start again; plan for sessions to end as well. |
| `GATEWAY_IDENTITY_SIGNING_KEY` | gateway | upstreams and Data hold the public key | Requests can be refused upstream while keys disagree. |
| `ACCESS_STATE_SECRET` | Access | nobody else | Logins in flight start again. |
| `ACCESS_SECRET_ENCRYPTION_KEY` | Access | nobody else | None, if you roll right after re-encrypting. |
| `ACCESS_SIGNING_KEY` | Access | the gateway and the console, through the JWKS | None: both keys are published during the switch. |
| `ACCESS_ADMIN_TOKEN`, `ACCESS_DECISION_TOKEN` | Access | operators, scripts, console; every gateway | None with the rolling procedure. |
| `ACCESS_ADMIN_TOKENS`, `ACCESS_CONTEXT_TOKENS` entries | Access | operators, console, Data | None if the new entry is added before the old one is removed. |
| Tenant client secrets | Access (encrypted) | the tenant's gateway or console | None inside the 24-hour window. |
| `DATA_CURSOR_KEY_FILE` | Data | nobody else | Open page cursors fail once. |
| Database and shared-state passwords | each service | the database or Redis server | A short reconnect. |
| `CONSOLE_SESSION_SECRET` | console | nobody else | Everyone is signed out of the console. |
| Metrics and control-plane tokens | each service | scrapers, operators | None if both sides change together. |

## Steps

The secrets are mostly independent, but the order below never leaves one service holding a value its peer does not yet accept: for every shared secret, the side that verifies or accepts it changes first, the side that presents it second, and the old value goes last.

### 1. Gateway session secret

It signs the gateway's login state cookie and does not affect the identity signature ([gateway operations: rotating the session secret](../gateway/operations.md#rotating-the-session-secret)).

1. Write the new value to the secret store; it must be the same on every replica.
2. Roll all replicas onto it quickly, with a surge or in a maintenance window. Replicas holding different secrets cannot read each other's login state, so anyone signing in during the rollout must start again.
3. Remove the old value.

The gateway's rollback notes say sessions survive only while this secret is unchanged ([gateway operations: rollback](../gateway/operations.md#rollback)), so expect callers to sign in again after the rotation.

### 2. Gateway identity signing key

The gateway signs each request's identity with this P-256 private key; upstreams and Data hold only the public key ([upstream identity: key](../gateway/upstream-identity.md#key)).

```bash
bun run identity:key                     # a new pair
GATEWAY_IDENTITY_SIGNING_KEY=<the pem>   # the new private key, or GATEWAY_IDENTITY_SIGNING_KEY_BASE64
bun run identity:key --public            # the public key to hand to upstreams
```

1. Give every upstream the new public key and have it accept the old and new keys for the duration of the switch ([gateway operations: rotating the identity key](../gateway/operations.md#rotating-the-identity-key)).
2. Roll the gateway quickly: until the rollout ends, some replicas sign with the old key and some with the new one.
3. Update Data. A Data binding names exactly one `publicKeyFile` and never falls back to another key ([Data spec §4.1](../data/spec.md#41-trusted-route-bindings)), so Data verifies with one key at a time: write the new public key into the binding's file and restart Data right after the gateway rollout ([Data operations: rotating secrets](../data/operations.md#rotating-secrets)). The docs describe no way for a Data binding to accept two keys at once, so requests signed with the other key get `401 UNAUTHENTICATED` until both sides match; keep that window short or schedule it.
4. Once every replica signs with the new key, remove the old public key from the upstreams.

### 3. Access state secret

It signs and encrypts the login state cookie between Access and the tenant's provider ([Access spec §5.3](../access/spec.md#53-login-state)). Generate at least 32 bytes, set the same value on every replica, and roll. Logins in flight end with `400 login_state_invalid` and must start again; replicas with different values cannot read each other's cookies, so roll quickly ([Access operations: rotating secrets](../access/operations.md#rotating-secrets)).

```bash
openssl rand -base64 32   # store it in the file ACCESS_STATE_SECRET_FILE names
```

### 4. Access encryption key

This key encrypts every tenant's provider and gateway client secrets in the database. Replacing it without re-encrypting makes them unreadable ([Access spec §4.3](../access/spec.md#43-secrets-at-rest)).

1. Generate the new key with `openssl rand -base64 32`.
2. Re-encrypt both columns in one transaction. The script prints how many tenants it changed, never a secret, and changes nothing if it fails:

   ```bash
   ACCESS_DATABASE_URL=postgres://… ACCESS_SECRET_ENCRYPTION_KEY=the-old-key \
   ACCESS_NEW_SECRET_ENCRYPTION_KEY=the-new-key bun run scripts/cli/rotate-secrets.ts
   ```
3. Set the new key as `ACCESS_SECRET_ENCRYPTION_KEY` and roll at once: replicas still holding the old key cannot read the re-encrypted secrets.
4. Run `scripts/cli/admin-smoke.ts`.

### 5. Access signing key

Access signs its id and access tokens with this RSA key and publishes the public half at `/oauth/jwks` ([Access spec §4.2](../access/spec.md#42-signing-key)).

1. Generate a key: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`.
2. Move the current key and kid to `ACCESS_PREVIOUS_SIGNING_KEY` and `ACCESS_PREVIOUS_SIGNING_KID`, set the new key and a new `ACCESS_SIGNING_KID`, and roll. The JWKS now lists both.
3. Wait at least five minutes, the lifetime of the tokens the old key signed, then remove both `ACCESS_PREVIOUS_SIGNING_*` variables and roll.

```bash
curl -sS https://access.example.com/oauth/jwks | jq -r '.keys[].kid'   # both kids during step 2
```

Changing the key without keeping the previous one published breaks every live session ([Access troubleshooting: token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems)).

### 6. Access administration and decision tokens

Both rotate with a previous-value variable, so nothing is refused until the last step ([Access spec §4.3.1](../access/spec.md#431-rotating-a-secret)):

1. Copy the current values into `ACCESS_PREVIOUS_ADMIN_TOKEN` and `ACCESS_PREVIOUS_DECISION_TOKEN`; roll Access.
2. Change the holders: every gateway's `GATEWAY_ACCESS_TOKEN` (roll each gateway), and `PLATFORMCTL_ADMIN_TOKEN` wherever operators and scripts use the platform token. Then set the new `ACCESS_ADMIN_TOKEN` and `ACCESS_DECISION_TOKEN`; roll Access.
3. When every holder uses the new values, remove both `ACCESS_PREVIOUS_*` variables; roll Access.

In production each token is at least 16 bytes. Once every gateway presents tenant credentials, retire the shared decision token instead of rotating it: remove `ACCESS_DECISION_TOKEN` and `ACCESS_PREVIOUS_DECISION_TOKEN` together, since the previous value alone stops the start ([Access operations: requirements](../access/operations.md#requirements)).

### 7. Credentials in the Access maps

`ACCESS_ADMIN_TOKENS` (administration) and `ACCESS_CONTEXT_TOKENS` (the access context read by Data and the console) have no previous-value variable, but each map holds as many tokens as you list ([Access configuration: administration credentials](../access/configuration.md#administration-credentials)). Rotate an entry in three rolls:

1. Add the new token next to the old one, with the same scope; roll Access. `ACCESS_ADMIN_TOKENS` has no `_FILE` form, so it is set in the environment.
2. Give the new token to its holder and restart it:

   | Holder | Setting |
   | --- | --- |
   | Data | `DATA_ACCESS_CONTEXT_TOKEN_FILE` |
   | Console | `CONSOLE_ACCESS_CONTEXT_TOKEN`, `CONSOLE_TENANT_ADMIN_TOKENS`, `CONSOLE_ADMIN_TOKEN` |
   | Tenant operators | their `PLATFORMCTL_ADMIN_TOKEN` |
3. Remove the old token from the map; roll Access.

For Data, Access must accept the new token before Data presents it; until the two agree, Data answers `503 AUTHORIZATION_UNAVAILABLE` ([Data operations: rotating secrets](../data/operations.md#rotating-secrets)). A tenant credential's audit `operator` name stays the same across the rotation if you keep its scope unchanged.

### 8. Tenant client secrets

Each tenant's gateway, and a console that signs in as that tenant's client, presents a client secret at Access's token endpoint. When the tenant registration receives a new `clientSecret`, Access keeps accepting the replaced one for 24 hours ([Access spec §4.3.1](../access/spec.md#431-rotating-a-secret)).

1. Send the tenant registration again with the new `clientSecret` and every other required field, as in [Onboard a tenant](onboard-a-tenant.md) ([API: register a tenant](../access/api.md#post-v1admintenants)). From now on both secrets are accepted.
2. Set `GATEWAY_OIDC_CLIENT_SECRET` (or `CONSOLE_CLIENT_SECRET`) to the new value and roll the gateway or console, well inside the 24 hours.
3. After 24 hours the old secret stops working on its own.

Update the tenant first: the 24-hour window protects the replaced secret, not the new one ([Access spec §4.3.1](../access/spec.md#431-rotating-a-secret)). Re-sending the secret already in use is not a rotation and does not reopen the window.

The tenant's provider secret (`idpClientSecret`, Access's own secret at the tenant's provider) is changed with the same call. Whether the provider accepts two secrets during the switch is up to the provider; the docs do not cover it. Access drops the tenant's provider client when the registration changes, so the next login uses the new secret ([Access spec §6.6](../access/spec.md#66-provider-key-rotation)).

### 9. Data cursor key and database credentials

| Secret | How |
| --- | --- |
| Cursor key (`DATA_CURSOR_KEY_FILE`, at least 32 bytes) | Write a new file and restart Data. Cursors handed out before fail with `400 INVALID_CURSOR`, so clients start their listing again from the first page. |
| Role passwords (`data_owner`, `data_runtime`, `data_registry`, `data_delivery`, `data_maintenance`) | Set the new passwords in the environment of `scripts/cli/provision.ts` and run it again, then update the connection URLs; the pools reconnect ([Data operations: database roles](../data/operations.md#database-roles)). |
| Metrics token (`DATA_METRICS_TOKEN_FILE`) | Change the file and the scraper together. |
| Legacy derived key (`identityKeyFile`) | Only `v4` routes read it, and it can sign identities; delete it once no route needs it. |

The gateway public key in Data's bindings is covered in step 2.

### 10. Console credentials

The console keeps sessions in process memory, so a restart signs everyone out anyway ([console operations: rotating secrets](../console/operations.md#rotating-secrets)).

| Secret | How |
| --- | --- |
| `CONSOLE_SESSION_SECRET` (at least 32 characters) | Replace it and restart; everyone signs in again, usually without a prompt from their provider. |
| `CONSOLE_CLIENT_SECRET` | As a tenant client secret, step 8. |
| `CONSOLE_ADMIN_TOKEN`, `CONSOLE_TENANT_ADMIN_TOKENS`, `CONSOLE_ACCESS_CONTEXT_TOKEN` | As map entries, step 7. |

### 11. Everything else

| Secret | How |
| --- | --- |
| `GATEWAY_METRICS_TOKEN`, `ACCESS_METRICS_TOKEN` | Change the scraper and the deployment together. |
| Gateway shared-state passwords | Change client and server in the same window: `redis-cli ACL SETUSER gateway resetpass >"$REDIS_GATEWAY_PASSWORD"` (and `gateway-control`), or `ALTER ROLE` for `gateway_app` and `control_app` ([gateway operations: roles](../gateway/operations.md#roles)). |
| Control-plane tokens | Each token is an entry of the map in `GATEWAY_CONTROL_TOKENS_FILE`, at least 16 characters, and never equal to another secret. Add the new entry, switch its operator, remove the old one. The docs do not say whether `gateway-control` re-reads the file while running, so restart it after each change. |
| `GATEWAY_OIDC_CLIENT_SECRET` | With Access as the provider, this is the tenant client secret of step 8. |
| Access's database password | Not covered by the Access docs; `ACCESS_DATABASE_URL` carries it ([Access operations: database role](../access/operations.md#database-role)). |

## Check that it worked

- Every service answers `GET /readyz` with `200` after its roll; `platformctl status` reads them all at once, and `platformctl doctor` checks the credentials in your profile.
- `bun run identity:key --public` gives the same public key on every gateway replica, and a request through the gateway reaches Data without `401 UNAUTHENTICATED`.
- The Access JWKS lists only the new kid once step 5 is finished.
- `ACCESS_URL=$ACCESS ACCESS_ADMIN_TOKEN=<new token> bun run scripts/cli/admin-smoke.ts` passes, and the old administration token gets `401` after step 6.
- A fresh browser sign-in through each tenant's gateway completes, and `access_logins_total{result!="success"}` does not rise.
- `access_admin_requests_total{status="401"}` stays flat after you remove an old token: a holder you forgot would show up there.

## If something goes wrong

| Symptom | Where to look |
| --- | --- |
| Access refuses to start after a change | [Access troubleshooting: start refusals](../access/troubleshooting.md#start-refusals) |
| The gateway or its control plane refuses to start | [Gateway troubleshooting: startup and readiness](../gateway/troubleshooting.md#startup-and-readiness) |
| Logins fail with `400 login_state_invalid` long after the roll | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| The gateway callback answers `400 login_failed` | [Gateway troubleshooting](../gateway/troubleshooting.md#the-login-callback-answers-400-login_failed) |
| Code exchange gets `401 invalid_client` | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| Sessions break after the signing key changed, or client secrets are unreadable | [Access troubleshooting: token and JWKS problems](../access/troubleshooting.md#token-and-jwks-problems) |
| Upstreams refuse the identity signature | [Gateway troubleshooting](../gateway/troubleshooting.md#the-upstream-refuses-the-identity-signature), [Data troubleshooting: 401](../data/troubleshooting.md#401-unauthenticated) |
| Data answers `503 AUTHORIZATION_UNAVAILABLE` | [Data troubleshooting](../data/troubleshooting.md#503-authorization_unavailable) |
| Every decision is `503 access_unavailable` after a token change | [Gateway troubleshooting](../gateway/troubleshooting.md#503-access_unavailable) |
| Administration calls answer `401` or `429` | [Access troubleshooting: administration refusals](../access/troubleshooting.md#administration-refusals) |

## Related

- [Platform security](../platform/security.md)
- [Gateway operations: secrets](../gateway/operations.md#secrets)
- [Access operations: rotating secrets](../access/operations.md#rotating-secrets)
- [Data operations: rotating secrets](../data/operations.md#rotating-secrets)
- [Console operations: rotating secrets](../console/operations.md#rotating-secrets)
- [Respond to an incident](respond-to-an-incident.md)
- [Upgrade and roll back](upgrade-and-roll-back.md)
