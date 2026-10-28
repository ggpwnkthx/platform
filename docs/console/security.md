# The console — security

The console is a client of the platform, and it holds credentials of it.
This page says which ones, what it does with them, and where the trust
stops.

## What the console holds

| Credential | What it is for | What it may do |
| --- | --- | --- |
| `CONSOLE_CLIENT_SECRET` | The exchange of the code of a login at the access service. | Sign a caller in as the client of the tenant. |
| `CONSOLE_ACCESS_CONTEXT_TOKEN` | The scope of an operator, read from the contract of the access context. | Read the keys of a principal. It is read only. |
| `CONSOLE_TENANT_ADMIN_TOKENS` | The administration of a tenant, for the operators of that tenant. | Change the users, the groups and the rights of that tenant. |
| `CONSOLE_ADMIN_TOKEN` | The administration of the platform, for the operators who hold `console.platform`. | Change every tenant. |
| `CONSOLE_SESSION_SECRET` | The signature of the cookies of the console. | Nothing outside the console. |
| The access tokens of the callers | The calls of the data, through the gateway. | What the policies of the data service let that caller do, for five minutes. |

## What it never holds

- **The private key of the identity signature of the gateway.** A console
  that could sign an identity could impersonate the gateway. The console
  reaches the data service through the gateway, with the token of the
  caller, like any other client.
- **A database.** The console reaches no store of the platform.
- **A decision.** Every refusal the console shows is a refusal of a
  service. The console hides what a scope does not open, and the service
  refuses it anyway.

## The sessions

- The browser holds the **signed identifier** of a session (32 random
  bytes) in `console_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, and
  `Secure` when the console is served in https. The token of the caller
  never reaches the browser.
- A session ends after `CONSOLE_SESSION_TTL_MS` without use (8 hours) and
  after `CONSOLE_SESSION_MAX_AGE_MS` in all (24 hours). The cookie never
  outlives it.
- A login replaces the session the browser had.
- The login in flight is single use, lives ten minutes, and is bound to
  the browser that began it by `console_login`
  (`Path=/auth/callback`). The target of the redirect after a login is a
  path of the console, never a url.

## The requests

- A request that changes something — every `POST` — comes from a page of
  the console: the `Origin` the browser names is the origin of the
  console, or the request is refused before it reaches the session.
- A built console answers with a policy of the content that allows the
  scripts of the console and nothing else (`script-src 'self'`), refuses
  to be framed, and never sends a referrer to another site.
- A change of a record carries the validator of the record the caller
  read; a creation carries the idempotency key of its form.

## The scope of an operator

The keys of the token of a login are a snapshot of the moment of the
login. The console never decides with them: it reads the access context
of the caller on every page, keeps it until its `validUntil` and never
longer, and fails closed when the context cannot be read. A right that is
revoked closes the administration from the next page on.

## The limits

- The sessions live in the memory of the process: a deployment runs one
  replica of the console, or pins a browser to a replica.
- The console reads the workspaces of a caller from its grants with the
  credential of its tenant. A right on every workspace of a tenant names
  none, and the caller opens such a workspace by its identifier.
