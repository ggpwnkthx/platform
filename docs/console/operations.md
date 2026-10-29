# Operations

Configure, build, deploy and run the console: environment, Access setup, the credentials it holds, probes, replicas and secret rotation. Behavior rules are in the [specification](spec.md).

## Environment

The console reads `CONSOLE_*` variables once at startup. Any value it cannot parse stops the process before it listens, with every problem reported together. An empty value counts as unset.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CONSOLE_ENVIRONMENT` | | `production` | `development` or `production`. Sets the content security policy and session cookie behavior. `development` serves sources through Vite when Vite is installed; otherwise the build is served. |
| `CONSOLE_HOST` | | `0.0.0.0` | Listener address. |
| `CONSOLE_PORT` | | `8083` | Listener port. |
| `CONSOLE_PUBLIC_URL` | yes | | URL browsers use. Must be https in production unless `CONSOLE_COOKIE_SECURE=false`. The login callback is `{CONSOLE_PUBLIC_URL}/auth/callback` and must be one of the tenant's `clientRedirectUris`. |
| `CONSOLE_ACCESS_URL` | yes | | Access base URL, as the console reaches it. Browsers use the endpoints in its discovery document. |
| `CONSOLE_CLIENT_ID`, `CONSOLE_CLIENT_SECRET` | yes | | The console's client at Access. |
| `CONSOLE_GATEWAY_URL` | yes | | Gateway base URL, as the console reaches it. Workspace data is read at `{url}/ws/{id}/v1/…`; the host is Data route's host. |
| `CONSOLE_DATA_URL` | | | Data base URL, for status-board probes only. |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | | | Read-only access context credential. Without it, administration is open to nobody. |
| `CONSOLE_ADMIN_TOKEN` | | | Platform administration credential. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | | | JSON object mapping tenant slugs to their administration credentials. |
| `CONSOLE_ROUTE_ID` | | `console` | The console's route at Access, carrying the `console.*` keys; operator scope is read on it. |
| `CONSOLE_SESSION_SECRET` | yes | | Cookie signing secret, at least 32 characters. |
| `CONSOLE_SESSION_TTL_MS` | | `28800000` (8 hours) | Idle session lifetime. |
| `CONSOLE_SESSION_MAX_AGE_MS` | | `86400000` (24 hours) | Maximum session age. |
| `CONSOLE_COOKIE_SECURE` | | `true` if the public URL is https | Whether cookies carry `Secure`. A production console served over http must set `false`. |
| `CONSOLE_PROBE_TIMEOUT_MS` | | `2000` | Timeout for probing a service. |
| `CONSOLE_REQUEST_TIMEOUT_MS` | | `10000` | Timeout for a service call. |
| `CONSOLE_LOG_LEVEL` | | `info` | `debug`, `info`, `warn` or `error`. |

Administration credentials must be at least 16 characters, per Access's rule.

## Access setup

1. **Client.** Register `{CONSOLE_PUBLIC_URL}/auth/callback` in the tenant's `clientRedirectUris`.
2. **Operator keys.** Grant `console.status`, `console.admin` or `console.platform` on the console's route, with the tenant slug as the workspace:

   ```bash
   curl -sS -X PUT "$ACCESS/v1/admin/grants" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"tenant":"acme","userId":"…","permission":"console.admin","workspaceId":"acme","routeId":"console"}'
   ```
3. **Credentials.** Configure the access context credential (`ACCESS_CONTEXT_TOKENS`) and administration credentials (`ACCESS_ADMIN_TOKENS`) that the console holds.

## Credentials it holds

| Credential | Used for | Allows |
| --- | --- | --- |
| `CONSOLE_CLIENT_SECRET` | Exchanging a login code at Access | Signing a caller in as the tenant's client |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | Reading an operator's scope through the access context contract | Reading a principal's keys (read-only) |
| `CONSOLE_TENANT_ADMIN_TOKENS` | Tenant administration, for that tenant's operators | Changing the tenant's users, groups and rights |
| `CONSOLE_ADMIN_TOKEN` | Platform administration, for operators holding `console.platform` | Changing every tenant |
| `CONSOLE_SESSION_SECRET` | Signing console cookies | Nothing outside the console |
| Callers' access tokens | Data calls through the gateway | Whatever Data's policies allow that caller, for five minutes |

It never holds:

- **the gateway's identity-signing private key**: every data request carries the caller's token, and the key would let the console act as the gateway toward every upstream;
- **a database connection**: it reaches no platform store;
- **a decision**: every refusal it shows comes from a service, which refuses even what the console fails to hide.

Sessions, login and cookie rules: [spec §3](spec.md#3-sessions). Request origin and content security policy: [spec §2](spec.md#2-requests). Operator scope and revocation: [spec §4](spec.md#4-operator-scope).

## Build and run

```bash
bun run --cwd packages/console build   # dist/: browser files and the server
bun run --cwd packages/console start   # src/main.ts serves the build
```

The image builds from `packages/console/Dockerfile`: the build stage runs `vite build`, and the final image contains only the build and the process, no development modules. The standalone stack is `deploy/compose/console.compose.yaml`; the full platform stack includes the console too.

## Probes and logs

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"console","version":"…"}` while the process is alive. |
| `GET /readyz` | `200 {"status":"ready"}` when Access serves its discovery document, else `503 {"status":"not-ready"}`. |

Logs are one JSON object per line on stdout, one per request, including the request ID (`x-request-id`).

## Replicas and limits

- Sessions and pending logins live in process memory. Run one replica, or pin each browser to one.
- A restart signs everyone out; callers still signed in at the tenant's provider are signed back in without a prompt.
- The workspace list comes from the caller's grants, read with the tenant's credential. A right covering every workspace of a tenant names none, so the caller opens such a workspace by ID.

## Rotating secrets

| Secret | How to rotate |
| --- | --- |
| `CONSOLE_SESSION_SECRET` | Replace it; everyone is signed out. |
| `CONSOLE_CLIENT_SECRET` | Access accepts a client's old secret alongside the new one for a day: update the tenant, then the console. |
| Administration and access context credentials | Add the new credential to Access, update the console, then remove the old one. |
