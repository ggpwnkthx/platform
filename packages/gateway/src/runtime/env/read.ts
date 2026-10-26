/**
 * The reading of the environment.
 *
 * The environment is validated as a whole and it becomes the settings the
 * gateway runs with. A value that cannot be understood stops the gateway:
 * the message names the variable, so the operator knows what to fix.
 */
import { randomBytes } from 'node:crypto'
import type { RateLimitFallbackMode } from '../../domains/rate-limiting'
import { isSharedStateUrl } from '../shared-state'
import { ControlEnvSchema, EnvSchema, pemOf } from './schema'
import type { ControlSettings, LogLevel, PostgresSettings, RuntimeSettings } from './settings'
import { DEVELOPMENT_ACCESS_URL, DEVELOPMENT_OIDC_ISSUER } from './settings'

/** The environment of the process. */
export type Env = Record<string, string | undefined>

/**
 * The level of the log.
 *
 * A value that is not a level falls back to `info`: the level of the log
 * must not be a reason to keep a deployment down.
 */
export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent']
  return levels.includes(normalized as LogLevel) ? (normalized as LogLevel) : fallback
}

/**
 * Reads the environment.
 *
 * A value that cannot be understood stops the gateway: the message names
 * the variable, so the operator knows what to fix.
 */
export function readEnv(env: Env = process.env): RuntimeSettings {
  const result = EnvSchema.safeParse(env)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'the environment'}: ${issue.message}`)
      .join('; ')
    throw new Error(`the environment is invalid: ${problems}`)
  }
  const parsed = result.data
  const production = parsed.NODE_ENV === 'production'

  if (production && !parsed.GATEWAY_SESSION_SECRET) {
    throw new Error(
      'GATEWAY_SESSION_SECRET must be set in a production environment: it signs the state cookie of the login flow and it derives the key of the identity signature, and it has to be the same on every replica'
    )
  }
  if (production && !parsed.GATEWAY_OIDC_ISSUER) {
    throw new Error(
      'GATEWAY_OIDC_ISSUER must be set in a production environment: it names the identity provider the callers authenticate against'
    )
  }
  if (production && !parsed.GATEWAY_OIDC_CLIENT_ID) {
    throw new Error(
      'GATEWAY_OIDC_CLIENT_ID must be set in a production environment: it names the client the gateway registers with the identity provider'
    )
  }
  if (production && !parsed.GATEWAY_OIDC_REDIRECT_URI) {
    throw new Error(
      'GATEWAY_OIDC_REDIRECT_URI must be set in a production environment: it is the url the identity provider sends the browser back to, and it has to be the url the gateway is reached under'
    )
  }
  if (
    production &&
    !parsed.GATEWAY_OIDC_CLIENT_SECRET &&
    !parsed.GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT
  ) {
    throw new Error(
      'GATEWAY_OIDC_CLIENT_SECRET must be set in a production environment, or GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT=true when the identity provider accepts a public client'
    )
  }
  if (production && !parsed.GATEWAY_ACCESS_URL) {
    throw new Error(
      'GATEWAY_ACCESS_URL must be set in a production environment: it names the access service that decides which caller may use a workspace'
    )
  }
  if (production && !parsed.GATEWAY_ACCESS_TOKEN && !parsed.GATEWAY_ACCESS_ALLOW_ANONYMOUS) {
    throw new Error(
      'GATEWAY_ACCESS_TOKEN must be set in a production environment, or GATEWAY_ACCESS_ALLOW_ANONYMOUS=true when the access service authenticates the gateway by other means'
    )
  }
  // The signature of the identity is asymmetric in a production
  // deployment: the gateway holds the private key and the upstreams hold
  // the public one, so an upstream that verifies an identity cannot mint
  // one. Without the key the signature is symmetric, the upstreams hold
  // the secret that signs it, and the trust boundary is the network
  // instead of the key.
  if (
    production &&
    !parsed.GATEWAY_IDENTITY_SIGNING_KEY &&
    !parsed.GATEWAY_IDENTITY_SIGNING_KEY_BASE64
  ) {
    throw new Error(
      'GATEWAY_IDENTITY_SIGNING_KEY must be set in a production environment: it is the private key that signs the identity of a request, and the upstreams are given the public one, so an upstream that verifies an identity cannot mint one. The script `bun run identity:key` generates a pair'
    )
  }
  if (
    production &&
    !parsed.GATEWAY_ALLOW_NO_RATE_LIMITS &&
    parsed.GATEWAY_RATE_LIMIT_MAX === 0 &&
    parsed.GATEWAY_RATE_LIMIT_GLOBAL_MAX === 0 &&
    parsed.GATEWAY_RATE_LIMIT_PRINCIPAL_MAX === 0 &&
    parsed.GATEWAY_RATE_LIMIT_TOTAL_MAX === 0
  ) {
    throw new Error(
      'at least one rate limit must be set in a production environment (GATEWAY_RATE_LIMIT_MAX, GATEWAY_RATE_LIMIT_GLOBAL_MAX, GATEWAY_RATE_LIMIT_PRINCIPAL_MAX or GATEWAY_RATE_LIMIT_TOTAL_MAX), or GATEWAY_ALLOW_NO_RATE_LIMITS=true when the deployment is protected by another layer'
    )
  }

  // The state the replicas share lives in the session server when that one
  // is a server whose state is shared: a deployment that shares its
  // sessions shares its limits and its cached decisions as well.
  const sharedStateUrl =
    parsed.GATEWAY_SHARED_STATE_URL ??
    (isSharedStateUrl(parsed.GATEWAY_SESSION_URL) ? parsed.GATEWAY_SESSION_URL : undefined)

  // The state of a deployment has to be shared. A session that lives in the
  // memory of a replica is unknown to the other replicas, so the callers
  // are logged out at random; a limit that lives in the memory of a replica
  // is the limit of that replica and not the limit of the deployment, so a
  // flood is bounded by the number of the replicas.
  //
  // A deployment that is a single node may keep the state in the process,
  // but it has to say so explicitly: a setting that looks active but is not
  // is a security hole.
  if (production && !parsed.GATEWAY_ALLOW_MEMORY_STATE) {
    if (!isSharedStateUrl(parsed.GATEWAY_SESSION_URL)) {
      throw new Error(
        'GATEWAY_SESSION_URL must name a Redis or a Postgres server in a production environment: the sessions of the callers have to be shared by the replicas, because a session that lives in the memory of one replica is unknown to the others, or GATEWAY_ALLOW_MEMORY_STATE=true when the deployment is a single node that accepts it'
      )
    }
    if (!isSharedStateUrl(sharedStateUrl)) {
      throw new Error(
        'GATEWAY_SHARED_STATE_URL must name a Redis or a Postgres server in a production environment: the rate limits and the cached decisions have to be shared by the replicas, or GATEWAY_ALLOW_MEMORY_STATE=true when the deployment is a single node that accepts it'
      )
    }
  }

  const scopes =
    parsed.GATEWAY_OIDC_SCOPES.length > 0
      ? parsed.GATEWAY_OIDC_SCOPES
      : ['openid', 'profile', 'email', 'groups']

  // The settings of the pool of the connections of a Postgres server.
  const postgresSettings: PostgresSettings = {
    poolMax: parsed.GATEWAY_POSTGRES_POOL_MAX,
    connectionTimeoutMs: parsed.GATEWAY_POSTGRES_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: parsed.GATEWAY_POSTGRES_STATEMENT_TIMEOUT_MS,
    synchronousCommit: parsed.GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT ?? 'off',
    // The schema is built by the gateway outside a production deployment:
    // a production deployment applies its own migrations, so a gateway
    // that is started with a read-only database account does not fail.
    autoMigrate: parsed.GATEWAY_POSTGRES_AUTO_MIGRATE ?? !production,
  }

  // The TLS of the connections to the upstreams. The certificate of the
  // gateway and its private key belong together: a certificate without a
  // key is a setting that looks active but is not, and the upstreams that
  // ask for a client certificate would refuse every request.
  const upstreamCert = pemOf(
    parsed.GATEWAY_UPSTREAM_TLS_CERT,
    parsed.GATEWAY_UPSTREAM_TLS_CERT_BASE64
  )
  const upstreamKey = pemOf(parsed.GATEWAY_UPSTREAM_TLS_KEY, parsed.GATEWAY_UPSTREAM_TLS_KEY_BASE64)
  if (Boolean(upstreamCert) !== Boolean(upstreamKey)) {
    throw new Error(
      'GATEWAY_UPSTREAM_TLS_CERT and GATEWAY_UPSTREAM_TLS_KEY must be set together: the certificate of the gateway is useless without its private key, and a private key without a certificate identifies nothing'
    )
  }

  return {
    production,
    configPath: parsed.GATEWAY_CONFIG,
    configSource: parsed.GATEWAY_CONFIG_SOURCE,
    network: {
      host: parsed.GATEWAY_HOST,
      port: parsed.GATEWAY_PORT,
      externalProto: parsed.GATEWAY_EXTERNAL_PROTO,
      trustedProxies: parsed.GATEWAY_TRUSTED_PROXIES,
      trustedProxiesConfigured: env.GATEWAY_TRUSTED_PROXIES !== undefined,
      trustedProxyHops: parsed.GATEWAY_TRUSTED_PROXY_HOPS,
    },
    oidc: {
      issuer: parsed.GATEWAY_OIDC_ISSUER ?? DEVELOPMENT_OIDC_ISSUER,
      clientId: parsed.GATEWAY_OIDC_CLIENT_ID ?? 'gateway',
      clientSecret: parsed.GATEWAY_OIDC_CLIENT_SECRET,
      redirectUri:
        parsed.GATEWAY_OIDC_REDIRECT_URI ?? `http://localhost:${parsed.GATEWAY_PORT}/auth/callback`,
      scopes,
      rolesClaim: parsed.GATEWAY_OIDC_ROLES_CLAIM,
      requiredTokenClaims: parsed.GATEWAY_OIDC_REQUIRED_TOKEN_CLAIMS,
      // The check is on unless the deployment turns it off: a setting that
      // looks active but is not is a security hole.
      rejectNonceTokens: parsed.GATEWAY_OIDC_REJECT_NONCE_TOKEN ?? true,
      // The bound is on by default: a token that outlives the bound keeps
      // a caller that was removed from the provider working for as long as
      // the provider gave the token. The default of the variable is a day.
      maxTokenAgeMs: parsed.GATEWAY_OIDC_MAX_TOKEN_AGE_MS,
      audience: parsed.GATEWAY_OIDC_AUDIENCE,
      // A provider that is not served over https is only allowed outside a
      // production environment: a deployment terminates TLS in front of it.
      allowInsecureIssuer: parsed.GATEWAY_OIDC_ALLOW_INSECURE ?? !production,
      allowPublicClient: parsed.GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT ?? false,
    },
    access: {
      baseUrl: parsed.GATEWAY_ACCESS_URL ?? DEVELOPMENT_ACCESS_URL,
      token: parsed.GATEWAY_ACCESS_TOKEN,
      timeoutMs: parsed.GATEWAY_ACCESS_TIMEOUT_MS,
      cacheTtlMs: parsed.GATEWAY_ACCESS_CACHE_TTL_MS,
      staleGraceMs: parsed.GATEWAY_ACCESS_STALE_GRACE_MS,
      allowAnonymous: parsed.GATEWAY_ACCESS_ALLOW_ANONYMOUS ?? false,
      breakerFailures: parsed.GATEWAY_ACCESS_BREAKER_FAILURES,
      breakerCooldownMs: parsed.GATEWAY_ACCESS_BREAKER_COOLDOWN_MS,
    },
    session: {
      url: parsed.GATEWAY_SESSION_URL,
      keyPrefix: parsed.GATEWAY_SESSION_KEY_PREFIX,
      ttlMs: parsed.GATEWAY_SESSION_TTL_MS,
      maxAgeMs: parsed.GATEWAY_SESSION_MAX_AGE_MS,
      touchIntervalMs: parsed.GATEWAY_SESSION_TOUCH_INTERVAL_MS,
      maxSessions: parsed.GATEWAY_SESSION_MAX_SESSIONS,
      tlsCa: parsed.GATEWAY_SESSION_TLS_CA ?? parsed.GATEWAY_SESSION_TLS_CA_BASE64,
      sentinelMaster: parsed.GATEWAY_REDIS_SENTINEL_MASTER,
      postgres: postgresSettings,
      // A secret that is generated per process is only valid on the replica
      // that generated it: the signatures of the identity are not verifiable
      // by the upstreams of the other replicas and every restart invalidates
      // the logins that are in flight.
      secret: parsed.GATEWAY_SESSION_SECRET ?? randomBytes(32).toString('hex'),
    },
    sharedState: {
      url: sharedStateUrl,
      keyPrefix: parsed.GATEWAY_SHARED_STATE_KEY_PREFIX,
      tlsCa:
        parsed.GATEWAY_SHARED_STATE_TLS_CA ??
        parsed.GATEWAY_SHARED_STATE_TLS_CA_BASE64 ??
        parsed.GATEWAY_SESSION_TLS_CA ??
        parsed.GATEWAY_SESSION_TLS_CA_BASE64,
      sentinelMaster: parsed.GATEWAY_REDIS_SENTINEL_MASTER,
      postgres: postgresSettings,
    },
    browser: {
      cookieSecure: parsed.GATEWAY_COOKIE_SECURE ?? production,
      allowedOrigins: parsed.GATEWAY_ALLOWED_ORIGINS,
      csrfStrict: parsed.GATEWAY_CSRF_STRICT ?? false,
    },
    identity: {
      // The key is a PEM, given directly or as base64: the secret stores
      // hand out the keys of a deployment in base64.
      signingKey: pemOf(
        parsed.GATEWAY_IDENTITY_SIGNING_KEY,
        parsed.GATEWAY_IDENTITY_SIGNING_KEY_BASE64
      ),
    },
    upstreamTls: {
      ca: pemOf(parsed.GATEWAY_UPSTREAM_TLS_CA, parsed.GATEWAY_UPSTREAM_TLS_CA_BASE64),
      cert: upstreamCert,
      key: upstreamKey,
    },
    limits: {
      maxBodyBytes: parsed.GATEWAY_MAX_BODY_BYTES,
      upstreamAttemptMs: parsed.GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS,
      replayMaxBytes: parsed.GATEWAY_REPLAY_MAX_BYTES,
      upstreamBreakerFailures: parsed.GATEWAY_UPSTREAM_BREAKER_FAILURES,
      upstreamBreakerCooldownMs: parsed.GATEWAY_UPSTREAM_BREAKER_COOLDOWN_MS,
      // What happens to a request while the state the replicas share cannot
      // be reached.
      fallback: parsed.GATEWAY_RATE_LIMIT_FALLBACK as RateLimitFallbackMode,
      route: { max: parsed.GATEWAY_RATE_LIMIT_MAX, windowMs: parsed.GATEWAY_RATE_LIMIT_WINDOW_MS },
      global: {
        max: parsed.GATEWAY_RATE_LIMIT_GLOBAL_MAX,
        windowMs: parsed.GATEWAY_RATE_LIMIT_GLOBAL_WINDOW_MS,
      },
      principal: {
        max: parsed.GATEWAY_RATE_LIMIT_PRINCIPAL_MAX,
        windowMs: parsed.GATEWAY_RATE_LIMIT_PRINCIPAL_WINDOW_MS,
      },
      total: {
        max: parsed.GATEWAY_RATE_LIMIT_TOTAL_MAX,
        windowMs: parsed.GATEWAY_RATE_LIMIT_TOTAL_WINDOW_MS,
      },
      login: {
        max: parsed.GATEWAY_LOGIN_RATE_LIMIT_MAX,
        windowMs: parsed.GATEWAY_LOGIN_RATE_LIMIT_WINDOW_MS,
      },
    },
    resources: {
      maxConcurrentRequests: parsed.GATEWAY_MAX_CONCURRENT_REQUESTS,
      maxPendingRequests: parsed.GATEWAY_MAX_PENDING_REQUESTS,
    },
    websockets: {
      maxConnections: parsed.GATEWAY_WS_MAX_CONNECTIONS,
      maxPayloadBytes: parsed.GATEWAY_WS_MAX_PAYLOAD_BYTES,
      maxBufferedBytes: parsed.GATEWAY_WS_MAX_BUFFERED_BYTES,
      maxBufferedMessages: parsed.GATEWAY_WS_MAX_BUFFERED_MESSAGES,
      backpressureLimitBytes: parsed.GATEWAY_WS_BACKPRESSURE_LIMIT_BYTES,
      pingIntervalMs: parsed.GATEWAY_WS_PING_INTERVAL_MS,
      pongTimeoutMs: parsed.GATEWAY_WS_PONG_TIMEOUT_MS,
      idleTimeoutSeconds: parsed.GATEWAY_WS_IDLE_TIMEOUT_SECONDS,
      handshakeTimeoutMs: parsed.GATEWAY_WS_HANDSHAKE_TIMEOUT_MS,
      revalidateIntervalMs: parsed.GATEWAY_WS_REVALIDATE_INTERVAL_MS,
    },
    observability: {
      logLevel: parseLogLevel(parsed.GATEWAY_LOG_LEVEL),
      metricsToken: parsed.GATEWAY_METRICS_TOKEN,
    },
    shutdownTimeoutMs: parsed.GATEWAY_SHUTDOWN_TIMEOUT_MS,
  }
}

/**
 * Reads the environment of the control plane.
 *
 * The environment is validated as a whole: a value that cannot be
 * understood stops the process. The control plane has no token map, or a
 * state that is not a server, and it stops: a control plane that nobody
 * controls is worse than no control plane at all.
 */
export function readControlEnv(env: Env = process.env): ControlSettings {
  const result = ControlEnvSchema.safeParse(env)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'the environment'}: ${issue.message}`)
      .join('; ')
    throw new Error(`the environment of the control plane is invalid: ${problems}`)
  }
  const parsed = result.data
  const production = parsed.NODE_ENV === 'production'

  if (!parsed.GATEWAY_CONTROL_TOKENS && !parsed.GATEWAY_CONTROL_TOKENS_FILE) {
    throw new Error(
      'GATEWAY_CONTROL_TOKENS or GATEWAY_CONTROL_TOKENS_FILE must be set: the control plane accepts no request without a token, and it stops when it has none'
    )
  }
  if (parsed.GATEWAY_CONTROL_TOKENS && parsed.GATEWAY_CONTROL_TOKENS_FILE) {
    throw new Error(
      'GATEWAY_CONTROL_TOKENS and GATEWAY_CONTROL_TOKENS_FILE must not be set at the same time: the map of the tokens is read once, and two sources of it are two maps'
    )
  }
  if (!isSharedStateUrl(parsed.GATEWAY_CONTROL_STATE_URL)) {
    throw new Error(
      'GATEWAY_CONTROL_STATE_URL must name a Redis or a Postgres server: the control plane acts on the shared state, and the state of the process of a control plane is not the state of the deployment'
    )
  }

  return {
    production,
    host: parsed.GATEWAY_CONTROL_HOST,
    port: parsed.GATEWAY_CONTROL_PORT,
    tokens: parsed.GATEWAY_CONTROL_TOKENS,
    tokensFile: parsed.GATEWAY_CONTROL_TOKENS_FILE,
    stateUrl: parsed.GATEWAY_CONTROL_STATE_URL,
    stateTlsCa: parsed.GATEWAY_CONTROL_STATE_TLS_CA ?? parsed.GATEWAY_CONTROL_STATE_TLS_CA_BASE64,
    keyPrefix: parsed.GATEWAY_CONTROL_KEY_PREFIX,
    sharedStateKeyPrefix: parsed.GATEWAY_CONTROL_SHARED_STATE_KEY_PREFIX,
    protectedRoutes: parsed.GATEWAY_PROTECTED_ROUTES,
    defaults: {
      defaultMaxBodyBytes: parsed.GATEWAY_MAX_BODY_BYTES,
      defaultUpstreamAttemptMs: parsed.GATEWAY_UPSTREAM_ATTEMPT_TIMEOUT_MS,
      defaultReplayMaxBytes: parsed.GATEWAY_REPLAY_MAX_BYTES,
      defaultAccessStaleGraceMs: parsed.GATEWAY_ACCESS_STALE_GRACE_MS,
    },
    trustedProxies: parsed.GATEWAY_TRUSTED_PROXIES,
    trustedProxiesConfigured: env.GATEWAY_TRUSTED_PROXIES !== undefined,
    postgres: {
      poolMax: 10,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 5_000,
      synchronousCommit: 'off',
      autoMigrate: false,
    },
  }
}
