/**
 * The schema of the environment.
 *
 * The schema is the only place that names the variables of the process:
 * the names of the variables never leave the module of the environment,
 * and the rest of the gateway receives the settings it needs.
 *
 * The schema of the gateway and the schema of the control plane are two
 * schemas: the control plane is a separate process with an environment of
 * its own.
 */
import { z } from 'zod'

/** An integer of the environment. */
function intEnv(defaultValue: number, options: { min?: number; max?: number } = {}) {
  let schema = z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    z.coerce.number().int('a whole number is expected')
  )
  if (options.min !== undefined) {
    const min = options.min
    schema = schema.refine((value) => value >= min, {
      message: `the value must be at least ${min}`,
    })
  }
  if (options.max !== undefined) {
    const max = options.max
    schema = schema.refine((value) => value <= max, {
      message: `the value must be at most ${max}`,
    })
  }
  return schema.default(defaultValue)
}

/** A boolean of the environment. */
function boolEnv() {
  return z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1')
    .optional()
}

/** A list of the environment, separated by commas. */
function listEnv() {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
    .default([])
}

/** A certificate authority, given as PEM or as base64. */
function tlsCaEnv() {
  return z.string().optional()
}

/**
 * A PEM value, given directly or as base64.
 *
 * The secret stores hand out the certificates of a deployment in base64,
 * because a PEM in an environment variable is hard to read.
 */
export function pemOf(pem: string | undefined, base64: string | undefined): string | undefined {
  if (pem) return pem
  if (!base64) return undefined
  try {
    return Buffer.from(base64, 'base64').toString('utf8')
  } catch {
    throw new Error('the value is not base64')
  }
}

export const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),

  GATEWAY_CONFIG: z.string().default('./config/routes.json'),
  /**
   * Where the route table comes from.
   *
   * `file` (the default) reads the table from `GATEWAY_CONFIG` and watches
   * the file. `store` reads it from the shared state, where the control
   * plane writes the revisions of the table: the pointer of the active
   * revision is watched, and every replica converges on the same table.
   */
  GATEWAY_CONFIG_SOURCE: z.enum(['file', 'store']).default('file'),
  GATEWAY_HOST: z.string().default('0.0.0.0'),
  GATEWAY_PORT: intEnv(8080, { max: 65_535 }),

  GATEWAY_OIDC_ISSUER: z.string().optional(),
  GATEWAY_OIDC_CLIENT_ID: z.string().optional(),
  GATEWAY_OIDC_CLIENT_SECRET: z.string().optional(),
  GATEWAY_OIDC_REDIRECT_URI: z.string().optional(),
  GATEWAY_OIDC_SCOPES: listEnv(),
  GATEWAY_OIDC_ROLES_CLAIM: z.string().default('roles'),
  /**
   * The claims a bearer token has to carry.
   *
   * The gateway validates the signature, the issuer, the audience, the
   * expiry and the subject of a bearer token, and nothing else: many
   * providers do not publish a claim that says the token is an access
   * token. A provider that does publish one is named here, and a token
   * that does not carry it is refused.
   */
  GATEWAY_OIDC_REQUIRED_TOKEN_CLAIMS: listEnv(),
  /**
   * Refuses a bearer token that carries a nonce.
   *
   * The check is on by default: the id token of this client always carries
   * a nonce and an access token never does, and an id token travels through
   * the browser. A provider whose access tokens carry a nonce anyway turns
   * the check off explicitly.
   */
  GATEWAY_OIDC_REJECT_NONCE_TOKEN: boolEnv(),
  /**
   * The longest lifetime a bearer token may have, in milliseconds.
   *
   * The lifetime is the time between the moment the token was issued and
   * the moment it expires: the bound is on the lifetime and not on the
   * validity that is left, so a long-lived token does not become
   * acceptable again when it is close to its expiry.
   *
   * The bound is what turns the removal of a caller from the identity
   * provider into a delay that is bounded by the deployment: the token of a
   * caller that was removed keeps working for at most this long.
   *
   * The default is a day: it refuses nothing that a provider of access
   * tokens issues in practice, and it refuses a token that was issued with
   * a lifetime of weeks. Zero disables the bound.
   */
  GATEWAY_OIDC_MAX_TOKEN_AGE_MS: intEnv(86_400_000, { min: 0 }),
  GATEWAY_OIDC_AUDIENCE: z.string().optional(),
  GATEWAY_OIDC_ALLOW_INSECURE: boolEnv(),
  /**
   * Allows a client of the identity provider without a secret.
   *
   * The setting is the production validation of the deployment: without a
   * secret the client is public, and the provider accepts the code of the
   * browser without a proof that the caller is the gateway.
   */
  GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT: boolEnv(),

  GATEWAY_ACCESS_URL: z.string().optional(),
  GATEWAY_ACCESS_TOKEN: z.string().optional(),
  GATEWAY_ACCESS_TIMEOUT_MS: intEnv(3_000, { min: 1 }),
  /**
   * The number of failures of Access before it is not called
   * any more, in milliseconds of the cooldown that follows.
   *
   * The breaker only refuses: it never lets a caller in, so it cannot be
   * a hole. It is what keeps an outage of the service from making the
   * gateway slow: a request that would wait for a call that is going to
   * fail is answered at once instead.
   *
   * Zero disables the breaker: the service is called on every request and
   * a request waits for the whole budget of the call when the service does
   * not answer.
   */
  GATEWAY_ACCESS_BREAKER_FAILURES: intEnv(5, { min: 0 }),
  GATEWAY_ACCESS_BREAKER_COOLDOWN_MS: intEnv(5_000, { min: 0, max: 3_600_000 }),
  GATEWAY_ACCESS_CACHE_TTL_MS: intEnv(5_000, { min: 0 }),
  /**
   * How long a decision of Access may be served after the
   * service became unreachable, in milliseconds.
   *
   * Zero disables it: an unreachable service is an outage and the gateway
   * answers `503` to it, which is the answer that tells the operator that
   * the service is down. A value above zero keeps the traffic of the
   * deployment flowing while the service is down, at the price of a
   * revocation that is late by that much.
   */
  GATEWAY_ACCESS_STALE_GRACE_MS: intEnv(0, { min: 0, max: 3_600_000 }),
  /**
   * Allows the gateway to call Access without a token.
   *
   * The setting is the production validation of the deployment: the access
   * service refuses a call without a token, so a deployment that does not
   * allow it has to configure one.
   */
  GATEWAY_ACCESS_ALLOW_ANONYMOUS: boolEnv(),

  GATEWAY_SESSION_SECRET: z.string().optional(),
  GATEWAY_SESSION_URL: z.string().default('memory://local'),
  GATEWAY_SESSION_KEY_PREFIX: z.string().default('gateway'),
  GATEWAY_SESSION_TTL_MS: intEnv(28_800_000, { min: 1_000 }),
  GATEWAY_SESSION_MAX_AGE_MS: intEnv(86_400_000, { min: 0 }),
  GATEWAY_SESSION_TOUCH_INTERVAL_MS: intEnv(60_000, { min: 0 }),
  GATEWAY_SESSION_MAX_SESSIONS: intEnv(5_000, { min: 1 }),
  /**
   * Allows a production deployment that keeps the state in the process.
   *
   * The state of a deployment has to be shared: a session that lives in the
   * memory of one replica is unknown to the others, and a limit that lives
   * in the memory of one replica is the limit of that replica and not the
   * limit of the deployment. A deployment that is a single node may say
   * explicitly that it accepts the in-process state.
   */
  GATEWAY_ALLOW_MEMORY_STATE: boolEnv(),
  GATEWAY_SESSION_TLS_CA: tlsCaEnv(),
  GATEWAY_SESSION_TLS_CA_BASE64: tlsCaEnv(),

  /**
   * The private key that signs the identity of a request, as a PEM.
   *
   * The key is an elliptic curve key on the curve P-256. The gateway holds
   * the private key and the upstreams are given the public one, so an
   * upstream that verifies an identity cannot mint one. The script
   * `scripts/identity-key.ts` generates a pair.
   *
   * A production deployment has to set it: without it the key is generated
   * for the process, so no upstream can verify an identity and the
   * replicas do not share it.
   */
  GATEWAY_IDENTITY_SIGNING_KEY: z.string().optional(),
  GATEWAY_IDENTITY_SIGNING_KEY_BASE64: z.string().optional(),

  /**
   * The TLS of the connections to the upstreams.
   *
   * The authority that signs the certificate of the upstream, and the
   * certificate of the gateway with its private key for the upstreams that
   * ask for one. The certificate and the key belong together: a certificate
   * without a key is a setting that looks active but is not.
   */
  GATEWAY_UPSTREAM_TLS_CA: z.string().optional(),
  GATEWAY_UPSTREAM_TLS_CA_BASE64: z.string().optional(),
  GATEWAY_UPSTREAM_TLS_CERT: z.string().optional(),
  GATEWAY_UPSTREAM_TLS_CERT_BASE64: z.string().optional(),
  GATEWAY_UPSTREAM_TLS_KEY: z.string().optional(),
  GATEWAY_UPSTREAM_TLS_KEY_BASE64: z.string().optional(),

  GATEWAY_SHARED_STATE_URL: z.string().optional(),
  GATEWAY_SHARED_STATE_KEY_PREFIX: z.string().default('gateway'),
  GATEWAY_SHARED_STATE_TLS_CA: tlsCaEnv(),
  GATEWAY_SHARED_STATE_TLS_CA_BASE64: tlsCaEnv(),

  /**
   * The number of connections of the pool of a replica, when the shared
   * state lives in a Postgres server.
   *
   * A Postgres server has a limit of connections and it is much lower than
   * the limit of a Redis server: a deployment with several replicas and a
   * pool per replica has to fit in it, or behind a pooler.
   */
  GATEWAY_POSTGRES_POOL_MAX: intEnv(10, { min: 1, max: 1000 }),
  /** How long the client waits for a connection of the pool. */
  GATEWAY_POSTGRES_CONNECTION_TIMEOUT_MS: intEnv(5_000, { min: 100 }),
  /** How long a statement of the gateway may run, in milliseconds. */
  GATEWAY_POSTGRES_STATEMENT_TIMEOUT_MS: intEnv(5_000, { min: 100 }),
  /**
   * Whether the server waits for the disk before it answers.
   *
   * The state of the shared state is a protection and not a ledger: the
   * default is `off`, the same guarantee a Redis server gives without its
   * append only file. It is the difference between a millisecond and a
   * tenth of a millisecond on every transaction of the limiter.
   */
  GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT: z.enum(['on', 'off']).optional(),
  /**
   * Builds the schema of the shared state when the client connects.
   *
   * The statements are idempotent, so a deployment whose replicas start at
   * the same time does not race with itself. A production deployment that
   * applies its own migrations says no here.
   */
  GATEWAY_POSTGRES_AUTO_MIGRATE: boolEnv(),

  /**
   * The name of the master, when the shared state is behind sentinel.
   *
   * The hosts of the urls are then the sentinels. The master and the
   * replicas are discovered from them, and a failover is transparent for
   * the gateway.
   */
  GATEWAY_REDIS_SENTINEL_MASTER: z.string().optional(),

  GATEWAY_COOKIE_SECURE: boolEnv(),
  GATEWAY_LOG_LEVEL: z.string().optional(),
  GATEWAY_METRICS_TOKEN: z.string().optional(),
  GATEWAY_MAX_BODY_BYTES: intEnv(10_485_760, { min: 0 }),
  GATEWAY_MAX_CONCURRENT_REQUESTS: intEnv(1_000, { min: 0 }),
  /**
   * The maximum number of requests that may be inside the gateway at the
   * same time.
   *
   * The cap above bounds the exchanges with the upstreams. This one
   * bounds the whole pipeline, including the phase that waits for a
   * dependency: the limits, the session and the decision of the access
   * service. A request that waits for a hanging Access would
   * never reach the cap above.
   */
  GATEWAY_MAX_PENDING_REQUESTS: intEnv(1_000, { min: 0 }),
  /**
   * The budget of one attempt to an upstream, when the route names several.
   *
   * An attempt that has another upstream behind it is abandoned when it
   * does not answer in time, and the next upstream is tried. It applies
   * only to a request that may be sent twice.
   *
   * Zero disables it: the budget of the answer governs the exchange.
   */
  GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS: intEnv(2_000, { min: 0 }),
  /**
   * The size of a body that may be sent again to a second upstream.
   *
   * A body that fits is held in memory, so that the request may be sent to
   * the next upstream when the first one fails. A body that does not fit
   * is streamed and the request is sent once.
   *
   * The memory of the gateway is bounded by this value and by the number of
   * exchanges that run at the same time.
   *
   * Zero disables it: every body is streamed.
   */
  GATEWAY_REPLAY_MAX_BYTES: intEnv(65_536, { min: 0 }),
  /**
   * The number of consecutive failures before an upstream is skipped.
   *
   * The breaker is passive: it learns from the failures the gateway
   * observes and it never probes an upstream. An upstream that failed
   * recently is moved to the end of the list, so a request that may not be
   * sent twice — a `POST`, most of the traffic of an API — still reaches
   * an upstream that answered recently.
   *
   * Zero disables the breaker: the order of the list is always the order of
   * the file.
   */
  GATEWAY_UPSTREAM_BREAKER_FAILURES: intEnv(3, { min: 0 }),
  /**
   * How long an upstream is skipped, in milliseconds.
   *
   * The upstream is tried again when the cooldown is over, even when it
   * failed in the meantime.
   */
  GATEWAY_UPSTREAM_BREAKER_COOLDOWN_MS: intEnv(30_000, { min: 0 }),

  GATEWAY_TRUSTED_PROXIES: listEnv(),
  /**
   * The number of trusted proxies that are in front of the gateway.
   *
   * Every one of them appends the address it observed to the chain of
   * `x-forwarded-for`. The number of the proxies is what tells the
   * entries they wrote from the ones a client injected: the address of the
   * caller is the entry that is this many positions from the right, and a
   * client cannot choose it.
   *
   * The default is one: a deployment behind a single ingress, which is
   * the usual one.
   */
  GATEWAY_TRUSTED_PROXY_HOPS: intEnv(1, { min: 1, max: 16 }),
  GATEWAY_EXTERNAL_PROTO: z.enum(['http', 'https']).default('http'),
  GATEWAY_ALLOWED_ORIGINS: listEnv(),
  GATEWAY_CSRF_STRICT: boolEnv(),

  GATEWAY_RATE_LIMIT_MAX: intEnv(0, { min: 0 }),
  GATEWAY_RATE_LIMIT_WINDOW_MS: intEnv(60_000, { min: 1_000 }),
  GATEWAY_RATE_LIMIT_GLOBAL_MAX: intEnv(0, { min: 0 }),
  GATEWAY_RATE_LIMIT_GLOBAL_WINDOW_MS: intEnv(60_000, { min: 1_000 }),
  GATEWAY_RATE_LIMIT_PRINCIPAL_MAX: intEnv(0, { min: 0 }),
  GATEWAY_RATE_LIMIT_PRINCIPAL_WINDOW_MS: intEnv(60_000, { min: 1_000 }),
  GATEWAY_RATE_LIMIT_TOTAL_MAX: intEnv(0, { min: 0 }),
  GATEWAY_RATE_LIMIT_TOTAL_WINDOW_MS: intEnv(1_000, { min: 100 }),
  /**
   * What happens to a request when the state the replicas share cannot be
   * reached.
   *
   * The limiter of a scope that lives in the shared state has no window to
   * count the request in while the server is down.
   *
   * - `local`: the request is counted in the window of the **process**, so
   *   the protection against a flood survives the outage of the shared
   *   state. The budget of a caller is spent a little faster than it
   *   should be, because the window of the process does not know about the
   *   requests the other replicas counted.
   * - `open`: every request is allowed. The behaviour of the releases
   *   before this one: a hiccup of the server is not an outage of the
   *   deployment, and the protection against a flood is gone for as long as
   *   the server is down.
   * - `closed`: every request is refused, with a `retry-after`.
   *
   * The default is `local`: the limiter is the only protection of the
   * gateway against a flood, and a protection that disappears with the
   * server is not one the deployment can rely on.
   */
  GATEWAY_RATE_LIMIT_FALLBACK: z.enum(['open', 'local', 'closed']).default('local'),
  /**
   * Allows a production deployment with every rate limit disabled.
   *
   * The limiter is the only protection of the gateway against a flood, and
   * a deployment that turns it off has to say so explicitly: a setting that
   * looks active but is not is a security hole.
   */
  GATEWAY_ALLOW_NO_RATE_LIMITS: boolEnv(),
  GATEWAY_LOGIN_RATE_LIMIT_MAX: intEnv(30, { min: 0 }),
  GATEWAY_LOGIN_RATE_LIMIT_WINDOW_MS: intEnv(60_000, { min: 1_000 }),

  GATEWAY_WS_MAX_CONNECTIONS: intEnv(1_000, { min: 0 }),
  GATEWAY_WS_MAX_PAYLOAD_BYTES: intEnv(16_777_216, { min: 1 }),
  GATEWAY_WS_MAX_BUFFERED_BYTES: intEnv(262_144, { min: 0 }),
  GATEWAY_WS_MAX_BUFFERED_MESSAGES: intEnv(100, { min: 0 }),
  GATEWAY_WS_BACKPRESSURE_LIMIT_BYTES: intEnv(1_048_576, { min: 1 }),
  GATEWAY_WS_PING_INTERVAL_MS: intEnv(30_000, { min: 0 }),
  GATEWAY_WS_PONG_TIMEOUT_MS: intEnv(90_000, { min: 0 }),
  GATEWAY_WS_IDLE_TIMEOUT_SECONDS: intEnv(120, { min: 0 }),
  GATEWAY_WS_HANDSHAKE_TIMEOUT_MS: intEnv(10_000, { min: 100 }),
  GATEWAY_WS_REVALIDATE_INTERVAL_MS: intEnv(60_000, { min: 0 }),

  GATEWAY_SHUTDOWN_TIMEOUT_MS: intEnv(15_000, { min: 0 }),
})

/**
 * The schema of the environment of the control plane.
 *
 * The control plane is a separate process with its own environment: the
 * names of its variables live here as well, so that the check of the
 * documentation of the environment sees them.
 */
export const ControlEnvSchema = z.object({
  NODE_ENV: z.string().optional(),

  GATEWAY_CONTROL_HOST: z.string().default('127.0.0.1'),
  GATEWAY_CONTROL_PORT: intEnv(9090, { max: 65_535 }),

  /**
   * The map of the tokens of the control plane, as a JSON object of
   * `{token: {operator, scope}}`.
   */
  GATEWAY_CONTROL_TOKENS: z.string().optional(),
  /**
   * The file that holds the map of the tokens.
   *
   * The map of the tokens is a secret: it is usually in a file that only
   * the control plane reads, and not in the environment of a deployment.
   */
  GATEWAY_CONTROL_TOKENS_FILE: z.string().optional(),

  /**
   * The shared state the control plane acts on.
   *
   * It is the state of the sessions and of the route table of the
   * deployment, reached with the credentials of the control plane (§12.8).
   */
  GATEWAY_CONTROL_STATE_URL: z.string(),
  GATEWAY_CONTROL_STATE_TLS_CA: tlsCaEnv(),
  GATEWAY_CONTROL_STATE_TLS_CA_BASE64: tlsCaEnv(),

  /**
   * The prefix of the keys of the state.
   *
   * It is the prefix the gateway uses for its sessions: the control plane
   * revokes the sessions of the deployment and it writes the route table
   * of the deployment.
   */
  GATEWAY_CONTROL_KEY_PREFIX: z.string().default('gateway'),
  /**
   * The prefix of the keys of the decisions of access.
   *
   * It is the prefix the gateway uses for its cached decisions.
   */
  GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX: z.string().default('gateway'),

  /**
   * The routes a write may not remove and may not change.
   *
   * A protected route is a route the deployment cannot afford to lose.
   */
  GATEWAY_PROTECTED_ROUTES: listEnv(),

  // The defaults of the deployment. The control plane compiles the tables
  // it validates with the same defaults as the gateway, so the table it
  // accepts is the table the gateway runs.
  GATEWAY_MAX_BODY_BYTES: intEnv(10_485_760, { min: 0 }),
  GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS: intEnv(2_000, { min: 0 }),
  GATEWAY_REPLAY_MAX_BYTES: intEnv(65_536, { min: 0 }),
  GATEWAY_ACCESS_STALE_GRACE_MS: intEnv(0, { min: 0, max: 3_600_000 }),
  GATEWAY_TRUSTED_PROXIES: listEnv(),
})
