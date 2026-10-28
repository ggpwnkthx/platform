# Recovery

What to do when a gateway deployment misbehaves: failing dependencies, rollbacks, session revocation and
secret rotation. Deployment and configuration are in [Operations](operations.md).

## Dependency failures

| Dependency | When unreachable |
| --- | --- |
| Identity provider | Logins fail with `503`. Callers with a session keep working. |
| Access service | Requests that need a decision get `503 access_unavailable`; other routes are unaffected. A route with a grace (`accessStaleGraceMs`) keeps using the last decision, counted in `gateway_access_stale_total`. |
| Shared state (Redis) | Sessions fail closed (`401`/`503`), decisions are requested again, and limits are counted in the process window, so the deployment degrades to one replica's budget per scope ([spec §9](spec.md#9-limits)). `GATEWAY_RATE_LIMIT_FALLBACK` sets the mode. |
| Upstreams | The route answers `502`; other routes are unaffected. A route with several upstreams tries the next one when the request may be resent, and the breaker moves recently failed upstreams to the end of the list. |

## Symptoms

| Symptom | Meaning | Action |
| --- | --- | --- |
| `/readyz` answers `503` with `config.lastError` | The configuration file is broken. | Fix the file. The last good configuration keeps serving. |
| `/readyz` answers `503` with `sessionStore: unavailable` | The shared state is unreachable. | Restore it. The deployment is out of rotation until then. |
| Every request answers `404 no_route` | The ingress rewrites `Host` without reporting the public host. | Set `x-forwarded-host` at the ingress, or match the host the ingress sends. |
| Every request answers `403 cross_site_request` | Same cause, seen through the browser's origin. | Set `x-forwarded-host` and `x-forwarded-proto` at the ingress. |
| `gateway_shared_state_errors_total` grows | Shared state degraded: decisions are re-requested, limits counted per process. | Restore it. `gateway_rate_limit_fallback_total` shows how much traffic was counted per replica instead of per deployment. |
| `gateway_access_unavailable_total` grows | The access service is unreachable or sends unreadable answers. | Restore it. The gateway fails closed: callers get `503 access_unavailable` until it answers. |
| `gateway_access_stale_total` grows | The access service is unreachable and grace routes are serving the last decision. | Restore it. Revocations are late by the grace; a route that cannot tolerate that sets `accessStaleGraceMs: 0`. |
| `gateway_request_errors_total` grows for one route | That route's upstream is broken. | Repair the upstream. Other routes are unaffected. |
| `gateway_rate_limited_total` grows | A flood. | Review the limits. The limiter is protecting the upstreams. |
| `gateway_cross_site_refusals_total` grows | A client sends requests from another site. | Add its origin to `GATEWAY_ALLOWED_ORIGINS`, or fix the client. |
| Logins fail with `503` | The identity provider is unreachable. | Restore it. Existing sessions keep working. |
| WebSockets close with `1008` | Session expired, access revoked, or route changed. | Nothing, unless unexpected: revalidation is working. |
| The gateway refuses to start | Production without a session secret, identity provider, access service or rate limit. | The error message names the variable. |

## Rollback

The gateway is stateless; a rollback is a deploy of the previous image.

1. Deploy the previous image with the same configuration and secrets. Routes come from the file, so no
   configuration change is needed.
2. The new version's pods drain: readiness answers `503`, WebSockets close with code 1001, and in-flight
   requests get `GATEWAY_SHUTDOWN_TIMEOUT_MS`. Allow at least that long between the signal and pod removal.
3. Sessions live in the shared state and survive the rollback unless `GATEWAY_SESSION_SECRET` changes.
   Changing it logs callers out.
4. The identity signature is versioned. The gateway writes only `v5`, so upstreams keep verifying the
   previous gateway version as long as `GATEWAY_IDENTITY_SIGNING_KEY` is unchanged. A rollback to a
   pre-`1.0` version writes `v4`, which is **removed**: change upstreams that verify `v4` first (see
   [Upstream identity](upstream-identity.md)).

Configuration reloads live: a broken file never takes a running deployment out of rotation, and a fixed
file is picked up within a second.

## Revoking sessions

Sessions live in the shared state under the deployment prefix (`GATEWAY_SESSION_KEY_PREFIX`).

| Goal | How | Cost |
| --- | --- | --- |
| End one session | Delete it (`DEL <prefix>:s:<id>`). | The caller signs in again. |
| **End all sessions of one caller** | `bun run sessions -- --subject <sub>` | The caller signs in again; others are untouched. |
| End all sessions of a deployment | Delete the prefix's keys (`SCAN` + `DEL`, or `FLUSHDB` if the deployment owns the database). | Every caller signs in again. |
| End all sessions of every deployment sharing the state | Delete each deployment prefix's keys. | Same. |

The revocation script talks to the shared Redis or Postgres server and reads the state URL and prefix from
the gateway environment:

```bash
GATEWAY_SESSION_URL=redis://127.0.0.1:6379/0 bun run sessions -- --subject alice@example.test
```

The subject is the identity provider's `sub` ([spec §5.3](spec.md#53-sessions)). The script prints how many sessions it
removed (`0` if the subject has none).

The gateway has no revocation endpoint: an administrative endpoint on the gateway is one an attacker can
reach ([spec §12.7](spec.md#127-control-plane)). A caller's logout also destroys its session and deletes the cookie.

**Subject index.** Sessions are indexed by subject so they can be revoked together. In Redis, the index is
built as sessions are created; sessions older than the index are not in it and expire on their own. In
Postgres, the index is a column, and the migration indexes older sessions:

```bash
bun run postgres:migrate -- postgres://user:password@host:5432/gateway
```

## Rotating the session secret

1. Add the new secret to the secret store.
2. Switch the deployment to it, replacing replicas one by one. **Replicas with the old and new secret
   cannot understand each other** (login state is signed with it), so replace them quickly
   (`maxUnavailable: 0` with a surge, or a maintenance window).
3. Remove the old secret from the store.

Callers in the middle of a login must sign in again, because their login state was signed with the old
secret.

## Rotating the identity key

The session secret does **not** affect the identity signature. The signature uses the deployment's private
key (`GATEWAY_IDENTITY_SIGNING_KEY`), which has its own rotation:

```bash
bun run identity:key                     # a new pair
GATEWAY_IDENTITY_SIGNING_KEY=<the pem>   # the new private key
bun run identity:key --public            # the public key the upstreams need
```

Give the upstreams the new public key, then roll out. During the rollout, replicas with the old and new key
produce different signatures and an upstream holding one public key refuses the other's, so keep the
rollout short and have upstreams hold both public keys while it runs.
