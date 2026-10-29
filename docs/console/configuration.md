# Configuration

Every environment variable the console reads, and what it needs registered at Access before it can sign anyone in. It is for operators setting up a deployment; the procedure is in [operations.md](operations.md).

## How it is read

The console reads `CONSOLE_*` variables from its process environment once, at startup. Values are trimmed, and an empty value counts as unset, so a composition that forwards a variable it does not have behaves as if the variable were absent.

A value the console cannot parse stops the process before it listens. All problems are collected first and reported together in one `ConfigError`, so one restart shows everything that needs fixing. The behavioral rules (including the production https rule) are in [spec §8](spec.md#8-environment).

For development, [`packages/console/.env.example`](../../packages/console/.env.example) holds a working set of values for a local machine. None of them is a deployment secret.

## Variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CONSOLE_ENVIRONMENT` | | `production` | `development` or `production`. Sets the content security policy and session cookie behavior. `development` serves sources through Vite when Vite is installed; otherwise the build is served. |
| `CONSOLE_HOST` | | `0.0.0.0` | Listener address. |
| `CONSOLE_PORT` | | `8083` | Listener port, 1 to 65535. |
| `CONSOLE_PUBLIC_URL` | yes | | URL browsers use. Must be https in production unless `CONSOLE_COOKIE_SECURE=false`. The login callback is `{CONSOLE_PUBLIC_URL}/auth/callback` and must be one of the tenant's `clientRedirectUris`. |
| `CONSOLE_ACCESS_URL` | yes | | Access base URL, as the console reaches it. Browsers use the endpoints in its discovery document. |
| `CONSOLE_CLIENT_ID`, `CONSOLE_CLIENT_SECRET` | yes | | The console's client at Access. The secret is at least 16 characters. |
| `CONSOLE_GATEWAY_URL` | yes | | Gateway base URL, as the console reaches it. Workspace data is read at `{url}/ws/{id}/v1/…`; the host is the host of the Data route. |
| `CONSOLE_DATA_URL` | | | Data base URL, for status-board probes only. |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | | | Read-only access context credential. Without it, administration is open to nobody. |
| `CONSOLE_ADMIN_TOKEN` | | | Platform administration credential. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | | | JSON object mapping tenant slugs to their administration credentials, for example `{"acme":"…"}`. |
| `CONSOLE_ROUTE_ID` | | `console` | The console's route at Access, carrying the `console.*` keys; operator scope is read on it. |
| `CONSOLE_SESSION_SECRET` | yes | | Cookie signing secret, at least 32 characters. |
| `CONSOLE_SESSION_TTL_MS` | | `28800000` (8 hours) | Idle session lifetime. Between `60000` (one minute) and 30 days. |
| `CONSOLE_SESSION_MAX_AGE_MS` | | `86400000` (24 hours) | Maximum session age. Between `60000` (one minute) and 90 days. |
| `CONSOLE_COOKIE_SECURE` | | `true` if the public URL is https | `true` or `false`: whether cookies carry `Secure`. A production console served over http must set `false`. |
| `CONSOLE_PROBE_TIMEOUT_MS` | | `2000` | Timeout for probing a service, `100` to `60000`. |
| `CONSOLE_REQUEST_TIMEOUT_MS` | | `10000` | Timeout for a service call, `100` to `120000`. |
| `CONSOLE_LOG_LEVEL` | | `info` | `debug`, `info`, `warn` or `error`. |

## Value rules

| Kind | Rule |
| --- | --- |
| URLs (`CONSOLE_PUBLIC_URL`, `CONSOLE_ACCESS_URL`, `CONSOLE_GATEWAY_URL`, `CONSOLE_DATA_URL`) | Must parse as an `http` or `https` URL. Trailing slashes are dropped. |
| Administration and access context credentials | At least 16 characters, per Access's rule. |
| `CONSOLE_CLIENT_SECRET` | At least 16 characters. |
| `CONSOLE_SESSION_SECRET` | At least 32 characters. |
| Published values | In production, a value the repository publishes is refused: the example of the console holds the values of its client secret and of its session secret, and a deployment that keeps them holds a credential that everybody knows. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | A JSON object (not an array). Each key must be a tenant slug matching `^[a-z0-9-]{2,63}$`; each value must be a string of at least 16 characters. |
| Integers | Whole numbers within the bounds in the table above. |

## What it needs from Access

| Need | Set at Access | Set in the console |
| --- | --- | --- |
| A client for sign-in | The tenant's client, with `{CONSOLE_PUBLIC_URL}/auth/callback` in its `clientRedirectUris` | `CONSOLE_CLIENT_ID`, `CONSOLE_CLIENT_SECRET` |
| Operator keys | Grants of `console.status`, `console.admin` or `console.platform` on the console's route, with the tenant slug as the workspace | `CONSOLE_ROUTE_ID` (default `console`) |
| Reading operator scope | An access context credential in `ACCESS_CONTEXT_TOKENS` | `CONSOLE_ACCESS_CONTEXT_TOKEN` |
| Tenant administration | A tenant administration credential in `ACCESS_ADMIN_TOKENS` | `CONSOLE_TENANT_ADMIN_TOKENS` |
| Platform administration | A platform administration credential in `ACCESS_ADMIN_TOKENS` | `CONSOLE_ADMIN_TOKEN` |

The Access side of these credentials is described in the [Access spec: administration credentials](../access/spec.md#46-administration-credentials) and the [Access spec: access context](../access/spec.md#9-access-context). The steps to register them are in [operations.md](operations.md#set-up-access).
