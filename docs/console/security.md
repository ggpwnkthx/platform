# Security

Which platform credentials the console holds, what it does with them, and where trust stops. The rules themselves are in the [specification](spec.md); this page is a reviewer's checklist.

## Credentials it holds

| Credential | Used for | Allows |
| --- | --- | --- |
| `CONSOLE_CLIENT_SECRET` | Exchanging a login code at the access service | Signing a caller in as the tenant's client |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | Reading an operator's scope through the access context contract | Reading a principal's keys (read-only) |
| `CONSOLE_TENANT_ADMIN_TOKENS` | Tenant administration, for that tenant's operators | Changing the tenant's users, groups and rights |
| `CONSOLE_ADMIN_TOKEN` | Platform administration, for operators holding `console.platform` | Changing every tenant |
| `CONSOLE_SESSION_SECRET` | Signing console cookies | Nothing outside the console |
| Callers' access tokens | Data calls through the gateway | Whatever the data service's policies allow that caller, for five minutes |

## What it never holds

- **The gateway's identity-signing private key.** Every data request carries the caller's token; holding the key would let the console act as the gateway toward every upstream.
- **A database.** The console reaches no platform store.
- **A decision.** Every refusal it shows comes from a service. The console hides what a scope doesn't open, and the service refuses it anyway.

## Sessions

- The browser holds a **signed session identifier** (32 random bytes) in `console_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` over https.
- The cookie never outlives its session, and a login replaces any existing session.
- A pending login is single-use, lives ten minutes, and is bound to the starting browser by `console_login` (`Path=/auth/callback`). The post-login redirect is a console path, never a URL.

Rules: [spec](spec.md) §3.

## Requests

- Every `POST` must come from a console page: the browser's `Origin` must match the console, or the request is refused before the session is read.
- A built console's content security policy allows only its own scripts (`script-src 'self'`), forbids framing, and sends no referrer to other sites.
- A record change carries the validator of the version the caller read; a creation carries its form's idempotency key.

Rules: [spec](spec.md) §2.

## Operator scope

A login token's keys are a snapshot from login time, and the console never decides with them. It reads the caller's access context on every page, keeps it until `validUntil` and no longer, and fails closed when the context can't be read. Revocation: [spec](spec.md) §4.

## Limits

- Sessions live in process memory: run one replica, or pin each browser to a replica.
- The console lists a caller's workspaces from its grants, using the tenant's credential. A right covering every workspace of a tenant names none, so the caller opens such a workspace by ID.
