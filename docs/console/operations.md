# Operations

How to build, deploy and run the console in production: Access setup, the credentials it holds, probes and logs, replicas, and secret rotation. It is for operators and secops; variables are in [configuration.md](configuration.md) and behavior rules in the [specification](spec.md).

## Build and run

```bash
bun run --cwd packages/console build   # dist/: browser files and the server
bun run --cwd packages/console start   # src/main.ts serves the build
```

The release publishes the image of the console like the three services: `ghcr.io/ggpwnkthx/console:<version>`. The image builds from `packages/console/Dockerfile`. Its build stage runs `vite build` and reads the `docs/` tree into the server build. The final image contains only the build and the process, with no development modules and no secrets: it runs as the non-root `bun` user, exposes port `8083`, writes only to stdout (the file system can be read-only), and checks `GET /healthz` every 15 seconds.

The digest of the image is in the file `digests.json` of the release, and a deployment pins the digest rather than the tag.

The standalone stack is `deploy/compose/console.compose.yaml`; the full platform stack includes the console too.

## Set up Access

Do this once per tenant whose people use the console.

1. Register `{CONSOLE_PUBLIC_URL}/auth/callback` in the tenant's `clientRedirectUris`.
2. Grant `console.status`, `console.admin` or `console.platform` on the console's route, with the tenant slug as the workspace:

   ```bash
   curl -sS -X PUT "$ACCESS/v1/admin/grants" \
     -H "authorization: Bearer $ACCESS_ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"tenant":"acme","userId":"…","permission":"console.admin","workspaceId":"acme","routeId":"console"}'
   ```
3. Configure, in Access, the access context credential (`ACCESS_CONTEXT_TOKENS`) and the administration credentials (`ACCESS_ADMIN_TOKENS`) that the console holds, then give the same values to the console's variables.

The mapping from each Access setting to its console variable is in [configuration.md](configuration.md#what-it-needs-from-access).

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

## Probes and logs

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok","service":"console","version":"…"}` while the process is alive. |
| `GET /readyz` | `200 {"status":"ready"}` when Access serves its discovery document, else `503 {"status":"not-ready"}`. |

Logs go to stdout as one JSON object per line, one line per request, including the request ID (`x-request-id`). Probe requests are not logged. Set the level with `CONSOLE_LOG_LEVEL`.

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

Access's side of a client secret rotation is in the [Access spec: rotating a secret](../access/spec.md#431-rotating-a-secret).
