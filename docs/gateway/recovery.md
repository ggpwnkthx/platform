# The recovery of the gateway

How to deploy, configure and run the gateway is in
[operations.md](operations.md). This document is what an operator reads
when the deployment is not behaving: a dependency that fails, a
rollback, a session to end and a secret to rotate.

## What happens when a dependency fails

| Piece | When it is not reachable |
| --- | --- |
| The identity provider | The logins fail with `503`. The callers that have a session keep working. |
| The access service | The requests that need a decision are refused with `503 access_unavailable`. The other routes are unaffected. A route that has a grace (`accessStaleGraceMs`) goes on with the last decision of the service, and the decisions that were served this way are counted in `gateway_access_stale_total`. |
| The shared state (Redis) | The sessions fail closed (`401`/`503`), the decisions are asked for again, and the limits are counted in the window of the process: the deployment degrades to the budget of one replica per scope (§9 of the specification). The mode is `GATEWAY_RATE_LIMIT_FALLBACK`. |
| The upstreams | The requests of the route are answered with `502`. The other routes are unaffected. A route that names several upstreams tries the next one when the request may be sent again, and the breaker moves an upstream that failed recently to the end of the list, so the next request of the route goes to an upstream that answered recently. |

## The recovery

| Symptom | What it means | What the operator does |
| --- | --- | --- |
| `/readyz` answers `503` with `config.lastError` | The configuration file is broken. | The file is corrected. The last good configuration keeps serving the traffic. |
| `/readyz` answers `503` with `sessionStore: unavailable` | The shared state is not reachable. | The shared state is restored. The deployment is out of the rotation until then. |
| Every request answers `404 no_route` | The ingress rewrites the `Host` header and does not report the public host. | The ingress sets `x-forwarded-host`, or the routes match the host the ingress sends. |
| Every request answers `403 cross_site_request` | The same, with the origin the browser sends. | The ingress sets `x-forwarded-host` and `x-forwarded-proto`. |
| `gateway_shared_state_errors_total` grows | The shared state is degraded: the decisions are asked for again, and the limits are counted in the window of the process. | The shared state is restored. `gateway_rate_limit_fallback_total` says how much of the traffic was counted per replica instead of per deployment. |
| `gateway_access_unavailable_total` grows | The access service is not reachable, or it answers something the gateway cannot read. | The access service is restored. The gateway fails closed: the callers are refused with `503 access_unavailable` until the service answers again. |
| `gateway_access_stale_total` grows | The access service is not reachable, and the routes that have a grace went on with the last decision of the service. | The access service is restored. The revocations of the callers are late by the grace: a route that may not be late sets `accessStaleGraceMs: 0`. |
| `gateway_request_errors_total` grows for one route | The upstream of the route is broken. | The upstream is repaired. The other routes are unaffected. |
| `gateway_rate_limited_total` grows | A flood. | The limits are reviewed. The limiter protects the upstreams. |
| `gateway_cross_site_refusals_total` grows | A client of the platform sends requests from another site. | The origin of the client is added to `GATEWAY_ALLOWED_ORIGINS`, or the client is fixed. |
| The logins fail with `503` | The identity provider is not reachable. | The provider is restored. The callers that have a session keep working. |
| The WebSockets close with `1008` | The session expired, the access was revoked, or the route changed. | Nothing, unless it is unexpected: the revalidation is doing its job. |
| The gateway refuses to start | A production deployment without a session secret, without an identity provider, without an access service, or without a rate limit. | The message names the variable. |

## The rollback

The gateway is a stateless process: a rollback is the deployment of the
previous image.

1. The deployment of the previous image is started with the same
   configuration and the same secrets. The routes are read from the file, so
   a rollback does not need a change of the configuration.
2. The pods of the new version are drained: the readiness answers `503`, the
   WebSockets are closed with the code 1001 and the requests that are in
   flight get `GATEWAY_SHUTDOWN_TIMEOUT_MS`. The orchestrator has to allow
   at least that much time between the signal and the removal of the pod.
3. The sessions of the callers live in the shared state: they survive the
   rollback, as long as `GATEWAY_SESSION_SECRET` did not change. A rollback
   that changes the secret of the sessions logs the callers out.
4. The signature of the identity is versioned: the gateway writes `v5`
   only, and an upstream that verifies the signature keeps working with
   the previous version of the gateway, as long as
   `GATEWAY_IDENTITY_SIGNING_KEY` did not change. A rollback to a version
   before the `1.0` release writes `v4`, which is **removed**: an
   upstream that verifies `v4` has to be changed first, and the migration
   is in [upstream-identity.md](upstream-identity.md).

The configuration is reloaded on the fly: a broken file never takes a
running deployment out of the rotation, and a corrected file is picked up
within a second.

## The invalidation of the sessions

The sessions of the callers live in the shared state, under the prefix of
the deployment (`GATEWAY_SESSION_KEY_PREFIX`).

| What is wanted | How | What it costs |
| --- | --- | --- |
| End the session of one caller | The session is removed from the state (`DEL <prefix>:s:<id>`). | The caller has to sign in again. |
| **End every session of one caller** | `bun run sessions -- --subject <sub>` | The caller has to sign in again. The other callers are untouched. |
| End the sessions of the callers of a deployment | The keys of the prefix are removed (`SCAN` + `DEL`, or `FLUSHDB` when the deployment has the state to itself). | Every caller has to sign in again. |
| End every session of every deployment that shares the state | The keys of the prefix of the deployment are removed. | The same. |

The script of the revocation talks to the state the replicas share — a Redis
server or a Postgres server — and it takes the url of the state and the
prefix of the deployment from the environment of the gateway:

```bash
GATEWAY_SESSION_URL=redis://127.0.0.1:6379/0 bun run sessions -- --subject alice@example.test
```

The subject is the `sub` of the identity provider. The script prints the
number of sessions it removed, and it prints `0` when the subject has no
session.

The gateway has no endpoint for the revocation: a gateway that answers an
administrative request is a request an attacker reaches. The rule is in
[spec.md](spec.md) §12.7.

**The index of the sessions.** The sessions are indexed by subject, so they
can be revoked at once. The index of Redis is built as the sessions are
created: a session that was created before the index existed is not in it,
and it expires on its own. The index of Postgres is a column of the table,
and the sessions that were created before the column existed are indexed by
the migration:

```bash
bun run postgres:migrate -- postgres://user:password@host:5432/gateway
```

The rotation of the secret of the sessions has the same effect on the
sessions that are in flight: the state of a login is signed with the old
secret, so a caller that was in the middle of a login has to sign in again.

The sessions of a caller can also be ended by the gateway itself: the logout
destroys the session of the caller and deletes its cookie.

## The rotation of the secret of the sessions

1. The new secret is added to the secret store.
2. The deployment is changed to the new secret. The replicas are replaced one
   by one: **a replica with the old secret and a replica with the new secret
   do not understand each other** (the state of a login is signed with the
   secret), so the replicas of a rollout have to be replaced quickly
   (`maxUnavailable: 0` with a surge, or a maintenance window).
3. The old secret is removed from the secret store.

The callers that were in the middle of a login have to sign in again.

The rotation of the secret of the sessions does **not** touch the
signature of the identity any more: the signature is signed with the
private key of the deployment (`GATEWAY_IDENTITY_SIGNING_KEY`), and it is
independent of the secret of the sessions. The key of the identity has its
own rotation, and it is the one the upstreams are given:

```bash
bun run identity:key                     # a new pair
GATEWAY_IDENTITY_SIGNING_KEY=<the pem>   # the new private key
bun run identity:key --public            # the public key the upstreams need
```

The upstreams are given the new public key, and the deployment is rolled
out. A replica with the old key and a replica with the new key sign
different signatures, and an upstream that holds one public key refuses
the signatures of the other: the rollout has to be quick, and the
upstreams have to hold both public keys for the length of it.
