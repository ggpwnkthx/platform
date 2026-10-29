# Configuration

Every environment variable Access reads, with its default, whether production requires it and what it means, plus the formats of secrets in files and of the credential maps. It is written for operators; the behavioral rules (validation, production refusals, rotation) are in [spec §4](spec.md#4-environment).

## How the environment is read

Access reads its environment once, at start, in `src/runtime/env.ts`, which is the only module that reads `process.env`. Every problem is collected and reported in one message that starts with `the environment is invalid:` and names each variable, so you fix them all before the next start (§4.4).

Development values are in [`packages/access/.env.example`](../../packages/access/.env.example). Never copy them into production: a production start refuses every example value and every secret made of one repeated character (§4.1).

## Variables

"Production" says whether `ACCESS_ENVIRONMENT=production` refuses to start without the variable.

### Listener and public URLs

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `ACCESS_ENVIRONMENT` | `development` | — | `development` or `production`. Production turns on the requirements of §4.4; the fixtures refuse to run in production. |
| `ACCESS_HOST` | `0.0.0.0` | optional | Listener address. |
| `ACCESS_PORT` | `8081` | optional | Listener port, a whole number from `0` to `65535`. |
| `ACCESS_ISSUER` | `http://localhost:<ACCESS_PORT>` in development; none in production | required | Public issuer URL: the `iss` of every issued token and the issuer the gateway is configured with. Must be an absolute `http` or `https` URL, and the URL the browser and the gateway use. |
| `ACCESS_PUBLIC_URL` | the issuer | optional | Public URL, when it differs from the issuer. Must be an absolute `http` or `https` URL. The discovery document builds its endpoints from it (§7.5). |

### Database and shared store

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `ACCESS_DATABASE_URL` | embedded PostgreSQL in `./.access/pglite` (development only) | required, a server | PostgreSQL holding the eight tables. `postgres://…` or `postgresql://…` names a server; `pglite://<path>` names the embedded database (§3.9). Any other value is refused. |
| `ACCESS_REDIS_URL` | none: codes live in process memory | required, unless `ACCESS_ALLOW_MEMORY_STATE=true` | Shared store for authorization codes and the administration's failed-authentication counts. Required when more than one replica runs. |
| `ACCESS_ALLOW_MEMORY_STATE` | `false` | optional | `true`, `false`, `1` or `0`. Replaces the shared store with process memory. Single-node deployments only: codes die with the process. |

### Credentials

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `ACCESS_ADMIN_TOKEN` | none | required, unless `ACCESS_ADMIN_TOKENS` is set | The bearer token of the twelve administrative endpoints: a platform credential. Without it and without `ACCESS_ADMIN_TOKENS`, the administration refuses every call. |
| `ACCESS_ADMIN_TOKENS` | none | optional | Administration credentials: a JSON object of bearer tokens and their scopes ([format](#administration-credentials), §4.6). |
| `ACCESS_PREVIOUS_ADMIN_TOKEN` | none | optional | The token the current one replaced. Accepted until the deployment removes it (§4.3.1). |
| `ACCESS_DECISION_TOKEN` | none | optional, deprecated | Bearer token the gateway presents on `POST /v1/decisions`. Unscoped: without it, only tenant credentials are accepted (§8.8). |
| `ACCESS_PREVIOUS_DECISION_TOKEN` | none | optional | The token the current one replaced. Accepted until the deployment removes it (§4.3.1); refused at start when `ACCESS_DECISION_TOKEN` is not set. |
| `ACCESS_CONTEXT_TOKENS` | none | optional | Access context credentials (§9): a JSON object of bearer tokens and the tenants each may ask about ([format](#access-context-credentials)). Needed only by a deployment that serves a data backend. |
| `ACCESS_METRICS_TOKEN` | none | optional | Bearer token for `GET /metrics`. Without it the endpoint is not served. |

In production the five single-token variables (`ACCESS_ADMIN_TOKEN`, `ACCESS_PREVIOUS_ADMIN_TOKEN`, `ACCESS_DECISION_TOKEN`, `ACCESS_PREVIOUS_DECISION_TOKEN`, `ACCESS_METRICS_TOKEN`) must hold at least 16 bytes, counted as written (§4.1). The tokens inside the two JSON maps must be at least 16 characters in every environment.

### Secrets and keys

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `ACCESS_STATE_SECRET` | none | required | Signs and encrypts the login state (§5.3). At least 32 bytes. Same value on every replica. |
| `ACCESS_SECRET_ENCRYPTION_KEY` | none | required | Encrypts tenant client secrets at rest (§4.3). At least 32 bytes. Without it, no tenant can be written. |
| `ACCESS_SIGNING_KEY` | none | required | The service's private key, in PEM (`-----BEGIN … PRIVATE KEY-----`). The public part is published at `/oauth/jwks`. |
| `ACCESS_SIGNING_KID` | none | required | The key's identifier in the JWKS, for example `access-1`. |
| `ACCESS_PREVIOUS_SIGNING_KEY` | none | optional | The previous rotation's private key, in PEM. Stays published in the JWKS until the last token it signed has expired (§4.2). |
| `ACCESS_PREVIOUS_SIGNING_KID` | none | optional | The previous key's identifier in the JWKS. |

`ACCESS_STATE_SECRET` and `ACCESS_SECRET_ENCRYPTION_KEY` are checked wherever they are set, not only in production. Their length is counted as decoded: an even-length hex string counts half its characters (64 hex characters are 32 bytes), a base64 string counts its decoded bytes (44 base64 characters are 32 bytes), and anything else counts its UTF-8 bytes. Generate one with `openssl rand -base64 32`.

### Deadlines and logging

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `ACCESS_IDP_TIMEOUT_MS` | `5000` | optional | How long to wait for a tenant's provider. At least `1`. |
| `ACCESS_DECISION_TIMEOUT_MS` | `2000` | optional | How long a decision may take before it is a denial. At least `1`. Also the pool's statement deadline (§8.3). |
| `ACCESS_CLOCK_SKEW_SECONDS` | `60` | optional | Clock tolerance on provider tokens (§6.1). At least `0`. |
| `ACCESS_LOG_LEVEL` | `info` | optional | `debug`, `info`, `warn` or `error`. An unknown value falls back to `info` and never stops the service. |

Integer variables must be whole numbers; an empty or non-numeric value stops the service.

## Secrets in files

Set `ACCESS_<NAME>_FILE` to a path, and Access reads the value of `ACCESS_<NAME>` from that file (§4.5). These variables accept a file:

| Variable | File variable |
| --- | --- |
| `ACCESS_ADMIN_TOKEN` | `ACCESS_ADMIN_TOKEN_FILE` |
| `ACCESS_PREVIOUS_ADMIN_TOKEN` | `ACCESS_PREVIOUS_ADMIN_TOKEN_FILE` |
| `ACCESS_DECISION_TOKEN` | `ACCESS_DECISION_TOKEN_FILE` |
| `ACCESS_PREVIOUS_DECISION_TOKEN` | `ACCESS_PREVIOUS_DECISION_TOKEN_FILE` |
| `ACCESS_CONTEXT_TOKENS` | `ACCESS_CONTEXT_TOKENS_FILE` |
| `ACCESS_METRICS_TOKEN` | `ACCESS_METRICS_TOKEN_FILE` |
| `ACCESS_STATE_SECRET` | `ACCESS_STATE_SECRET_FILE` |
| `ACCESS_SECRET_ENCRYPTION_KEY` | `ACCESS_SECRET_ENCRYPTION_KEY_FILE` |
| `ACCESS_SIGNING_KEY` | `ACCESS_SIGNING_KEY_FILE` |
| `ACCESS_PREVIOUS_SIGNING_KEY` | `ACCESS_PREVIOUS_SIGNING_KEY_FILE` |

`ACCESS_ADMIN_TOKENS` has no file form in this release: set it in the environment.

```bash
ACCESS_SIGNING_KEY_FILE=/run/secrets/access-signing-key.pem
ACCESS_STATE_SECRET_FILE=/run/secrets/access-state-secret
```

Surrounding whitespace, including the trailing newline, is trimmed. The start fails with `ACCESS_<NAME> and ACCESS_<NAME>_FILE are both set` when you set both forms, and with `ACCESS_<NAME>_FILE names a file that cannot be read` when the file is missing or unreadable.

## Administration credentials

`ACCESS_ADMIN_TOKENS` is a JSON object. Each key is a bearer token; each value is its scope (§4.6, §10.1):

```json
{
  "the-token-of-the-operator-of-the-platform": null,
  "the-token-of-the-operator-of-acme": {"tenant": "acme", "operator": "alice"}
}
```

| Value | Credential |
| --- | --- |
| `null` | A platform credential: it may act for every tenant. |
| `{"tenant": "<slug>"}` | A tenant credential for the tenant with that slug. |
| `{"tenant": "<slug>", "operator": "<name>"}` | The same, with the operator name the audit records. |

Each token is at least 16 characters. A value that is not a JSON object, a scope that is neither `null` nor an object, an empty `tenant` or a non-string `operator` stops the service at start. `ACCESS_ADMIN_TOKEN` and `ACCESS_ADMIN_TOKENS` may be set together.

## Access context credentials

`ACCESS_CONTEXT_TOKENS` is a JSON object. Each key is a bearer token; each value is the list of tenant ids (UUIDs) that token may ask about, or `null` for a platform credential (§9.2):

```json
{"the-token-of-the-backend-of-acme": ["22222222-2222-4222-8222-222222222222"]}
```

Each token is at least 16 characters. A value that is not a JSON object, or a scope that is neither `null` nor a list of strings, stops the service at start.

## Files the service reads

| File | Read when | Meaning |
| --- | --- | --- |
| `src/platform/postgres/migrations/*.sql` | At start | The schema, applied in name order (§3.8). |
| `migrations/` next to the executable | At start, when the directory above is absent | The schema shipped with a compiled binary. |
| The file named by each `ACCESS_<NAME>_FILE` | At start | A secret ([Secrets in files](#secrets-in-files)). |

Access reads no other configuration file: tenants, principals, groups, roles and grants live in the database and change only through the administration (§10).

## Variables of the scripts and tests

These variables are read by operator scripts and test suites, never by the service.

| Variable | Read by | Meaning |
| --- | --- | --- |
| `ACCESS_URL` | `scripts/cli/admin-smoke.ts`, `scripts/compat/shadow.ts` | The Access deployment to call. The smoke test defaults to `http://127.0.0.1:8081`. |
| `ACCESS_SMOKE_SLUG` | `scripts/cli/admin-smoke.ts` | Slug of the smoke test's tenant. Default `smoke`. |
| `ACCESS_NEW_SECRET_ENCRYPTION_KEY` | `scripts/cli/rotate-secrets.ts` | The new encryption key; `ACCESS_SECRET_ENCRYPTION_KEY` holds the old one. |
| `OLD_ACCESS_URL`, `OLD_ACCESS_TOKEN` | `scripts/compat/shadow.ts` | The service being replaced, during a [shadow comparison](operations.md#shadow-comparison). |
| `ACCESS_ADMIN_DATABASE_URL` | `scripts/cli/provision.ts` | A server administrator's connection, used once to create the service's role and database. |
| `ACCESS_OWNER_PASSWORD` | `scripts/cli/provision.ts` | Password of the role the script creates. At least 16 characters. |
| `ACCESS_DATABASE_NAME` | `scripts/cli/provision.ts` | Name of the database the script creates. Default `access`. |
| `ACCESS_EXPLAIN_PRINCIPALS`, `ACCESS_EXPLAIN_GRANTS` | `scripts/cli/explain-decision.ts` | Size of the generated data set. Default `1000` each. |
| `ACCESS_TEST_DATABASE_URL` | the test suites | Runs the database tests against a PostgreSQL server instead of the embedded database. |
| `ACCESS_GATEWAY_PATH`, `GATEWAY_REPOSITORY`, `GATEWAY_COMMIT`, `COMPAT_MIRROR`, `COMPAT_WORKSPACE`, `COMPAT_KEEP`, `COMPAT_TESTS` | `scripts/compat/compatibility.ts` | The compatibility suite's reference and checkout ([Internals](internals.md#compatibility-suite)). |
| `ACCESS_EXTERNAL_URL`, `ACCESS_EXTERNAL_ADMIN_TOKEN`, `ACCESS_EXTERNAL_ACCESS_TOKEN` | the compatibility suite | Test a running service, such as a release image, instead of starting one. The last one is that service's decision token. |
