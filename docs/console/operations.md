# Operations

Configure, build, deploy and run the console: environment, access service setup, probes, replicas and secret rotation.

## Environment

The console reads `CONSOLE_*` variables once at startup. Any value it cannot parse stops the process before it listens, with every problem reported together. An empty value counts as unset.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CONSOLE_ENVIRONMENT` | | `production` | `development` or `production`. Sets the content security policy and session cookie behavior. `development` serves sources through Vite when Vite is installed; otherwise the build is served. |
| `CONSOLE_HOST` | | `0.0.0.0` | Listener address. |
| `CONSOLE_PORT` | | `8083` | Listener port. |
| `CONSOLE_PUBLIC_URL` | yes | | URL browsers use. Must be https in production unless `CONSOLE_COOKIE_SECURE=false`. The login callback is `{CONSOLE_PUBLIC_URL}/auth/callback` and must be one of the tenant's `clientRedirectUris`. |
| `CONSOLE_ACCESS_URL` | yes | | Access service base URL, as the console reaches it. Browsers use the endpoints in its discovery document. |
| `CONSOLE_CLIENT_ID`, `CONSOLE_CLIENT_SECRET` | yes | | The console's client at the access service. |
| `CONSOLE_GATEWAY_URL` | yes | | Gateway base URL, as the console reaches it. Workspace data is read at `{url}/ws/{id}/v1/…`; the host is the data service route's host. |
| `CONSOLE_DATA_URL` | | | Data service base URL, for status-board probes only. |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | | | Read-only access context credential. Without it, administration is open to nobody. |
| `CONSOLE_ADMIN_TOKEN` | | | Platform administration credential. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | | | JSON object mapping tenant slugs to their administration credentials. |
| `CONSOLE_ROUTE_ID` | | `console` | The console's route at the access service, carrying the `console.*` keys; operator scope is read on it. |
| `CONSOLE_SESSION_SECRET` | yes | | Cookie signing secret, at least 32 characters. |
| `CONSOLE_SESSION_TTL_MS` | | `28800000` (8 hours) | Idle session lifetime. |
| `CONSOLE_SESSION_MAX_AGE_MS` | | `86400000` (24 hours) | Maximum session age. |
| `CONSOLE_COOKIE_SECURE` | | `true` if the public URL is https | Whether cookies carry `Secure`. A production console served over http must set `false`. |
| `CONSOLE_PROBE_TIMEOUT_MS` | | `2000` | Timeout for probing a service. |
| `CONSOLE_REQUEST_TIMEOUT_MS` | | `10000` | Timeout for a service call. |
| `CONSOLE_LOG_LEVEL` | | `info` | `debug`, `info`, `warn` or `error`. |

Administration credentials must be at least 16 characters, per the access service's rule.

## Access service setup

1. **Client.** Register `{CONSOLE_PUBLIC_URL}/auth/callback` in the tenant's `clientRedirectUris`.
2. **Operator keys.** Grant `console.status`, `console.admin` or `console.platform` on the console's route, with the tenant slug as the workspace:

   ```bash
   curl -sS -X PUT "$ACCESS/v1/admin/grants" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"tenant":"acme","userId":"…","permission":"console.admin","workspaceId":"acme","routeId":"console"}'
   ```
3. **Credentials.** Configure the access context credential (`ACCESS_CONTEXT_TOKENS`) and administration credentials (`ACCESS_ADMIN_TOKENS`) that the console holds.

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
| `GET /readyz` | `200 {"status":"ready"}` when the access service serves its discovery document, else `503 {"status":"not-ready"}`. |

Logs are one JSON object per line on stdout, one per request, including the request ID (`x-request-id`).

## Replicas

Sessions and pending logins live in process memory. Run one replica, or pin each browser to one. A restart signs everyone out; while they are still signed in at the tenant's provider, it signs them back in without prompting.

## Rotating secrets

| Secret | How to rotate |
| --- | --- |
| `CONSOLE_SESSION_SECRET` | Replace it; everyone is signed out. |
| `CONSOLE_CLIENT_SECRET` | The access service accepts a client's old secret alongside the new one for a day: update the tenant, then the console. |
| Administration and access context credentials | Add the new credential to the access service, update the console, then remove the old one. |
