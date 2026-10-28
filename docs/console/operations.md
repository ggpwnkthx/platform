# The console — operations

## The environment

The console reads the variables of the prefix `CONSOLE_` once, when it
starts. A value that is not understood stops the process before it
listens, and every problem is named at once. An empty value is an absent
value.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CONSOLE_ENVIRONMENT` | | `production` | `development` serves the sources through Vite when Vite is installed; otherwise the build is served. |
| `CONSOLE_HOST` | | `0.0.0.0` | The address of the listener. |
| `CONSOLE_PORT` | | `8083` | The port of the listener. |
| `CONSOLE_PUBLIC_URL` | yes | | The url the browser reaches the console at. The callback of the login is `{CONSOLE_PUBLIC_URL}/auth/callback`, and it has to be one of the `clientRedirectUris` of the tenant. |
| `CONSOLE_ACCESS_URL` | yes | | The access service, as the console reaches it. The browser reaches it at the endpoints of its discovery document. |
| `CONSOLE_CLIENT_ID`, `CONSOLE_CLIENT_SECRET` | yes | | The client of the tenant at the access service. |
| `CONSOLE_GATEWAY_URL` | yes | | The gateway, as the console reaches it: the data of a workspace is read at `{url}/ws/{id}/v1/…`. The host is the host of the route of the data service. |
| `CONSOLE_DATA_URL` | | | The data service, for its probes only. |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | | | The credential of the contract of the access context. Without it, the administration is open to nobody. |
| `CONSOLE_ADMIN_TOKEN` | | | The credential of the administration of the platform. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | | | A json object of the slugs of the tenants and of their credentials. |
| `CONSOLE_ROUTE_ID` | | `console` | The route of the console at the access service: the route of the keys `console.*`. |
| `CONSOLE_SESSION_SECRET` | yes | | The secret of the cookies: 32 characters at least. |
| `CONSOLE_SESSION_TTL_MS` | | `28800000` | How long a session survives without being used. |
| `CONSOLE_SESSION_MAX_AGE_MS` | | `86400000` | How long a session may be used at all. |
| `CONSOLE_COOKIE_SECURE` | | https of the public url | Whether the cookies carry `Secure`. A production console served in http has to say `false`. |
| `CONSOLE_PROBE_TIMEOUT_MS` | | `2000` | The budget of a probe of a service. |
| `CONSOLE_REQUEST_TIMEOUT_MS` | | `10000` | The budget of a call to a service. |
| `CONSOLE_LOG_LEVEL` | | `info` | `debug`, `info`, `warn` or `error`. |

The credentials of the administration are at least 16 characters long:
the rule of the access service.

## The access service

The console needs three things of the access service:

1. **Its client.** The tenant registers `{CONSOLE_PUBLIC_URL}/auth/callback`
   among its `clientRedirectUris`.
2. **The keys of the operators.** The grants of `console.status`,
   `console.admin` or `console.platform`, on the route of the console,
   for the workspace that is the slug of the tenant:

   ```bash
   curl -sS -X PUT "$ACCESS/v1/admin/grants" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"tenant":"acme","userId":"…","permission":"console.admin","workspaceId":"acme","routeId":"console"}'
   ```
3. **The credentials** of the access context (`ACCESS_CONTEXT_TOKENS`) and
   of the administration (`ACCESS_ADMIN_TOKENS`) that the console holds.

## The build and the process

```bash
bun run --cwd packages/console build   # dist/: the files of the browser, and the server
bun run --cwd packages/console start   # src/main.ts serves the build
```

The image is built from `packages/console/Dockerfile`: the build stage
runs `vite build`, and the image holds the build and the process, and no
module of the development. The stack of the console alone is
`deploy/compose/console.compose.yaml`, and the stack of the whole
platform carries it too.

## The probes

| Endpoint | Answer |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"console","version":"…"}` as long as the process is alive. |
| `GET /readyz` | `200 {"status":"ready"}` when the access service answers its discovery document, `503 {"status":"not-ready"}` otherwise. |

The log is one json object per line on the standard output, one line per
request, with its identifier (`x-request-id`).

## The replicas

The sessions and the logins in flight live in the memory of the process.
A deployment runs one replica, or pins a browser to a replica; a restart
signs everybody out, and the provider of the tenant signs them in again
without a question while they are signed in there.

## The rotation of the secrets

| Secret | Rotation |
| --- | --- |
| `CONSOLE_SESSION_SECRET` | A new secret signs everybody out. |
| `CONSOLE_CLIENT_SECRET` | The access service accepts the old secret of a client beside the new one for a day: change the tenant, then the console. |
| The credentials of the administration and of the access context | Add the new credential to the access service, change the console, remove the old one. |
