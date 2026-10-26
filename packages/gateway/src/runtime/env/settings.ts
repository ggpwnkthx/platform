/**
 * The settings of the gateway.
 *
 * The environment is read once, at the start of the process, and it is
 * validated as a whole: a value that cannot be understood stops the
 * gateway, because a setting that looks active but is not is a security
 * hole. The only exception is the level of the log, which falls back to
 * `info`: a typo in the level of a log must not keep a deployment down.
 *
 * The names of the variables never leave this module: the rest of the
 * gateway receives the settings it needs, not the environment.
 *
 * This file holds the shape of the settings: what the gateway reads, and
 * what it is made of. The names of the variables are in `schema.ts` and
 * the reading of them is in `read.ts`.
 */
import type { EnvironmentDefaults } from '../../domains/configuration'
import type { RateLimitFallbackMode } from '../../domains/rate-limiting'

/** The level of the log. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

/**
 * Where the route table of a deployment comes from.
 *
 * - `file`: the file of `GATEWAY_CONFIG`, watched by the gateway;
 * - `store`: the shared state, where the control plane writes the
 *   revisions of the table (§3.4 of the specification).
 */
export type ConfigSource = 'file' | 'store'

/** The settings of the identity provider. */
export interface OidcSettings {
  issuer: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  scopes: string[]
  rolesClaim: string
  /** The claims a bearer token has to carry. */
  requiredTokenClaims: string[]
  /**
   * Refuses a bearer token that carries a nonce.
   *
   * The browser flow always asks for a nonce, so an id token of this client
   * always carries one and an access token never does. A provider whose
   * access tokens carry a nonce anyway turns the check off.
   */
  rejectNonceTokens: boolean
  /**
   * The longest lifetime a bearer token may have, in milliseconds.
   *
   * The lifetime is the time between the moment the token was issued and
   * the moment it expires. Zero disables the bound. The bound is what turns
   * the removal of a caller from the identity provider into a delay that is
   * bounded by the deployment.
   */
  maxTokenAgeMs: number
  audience?: string
  /** Allows a provider that is not served over https. */
  allowInsecureIssuer: boolean
  /** Allows a client without a secret. */
  allowPublicClient: boolean
}

/** The settings of access. */
export interface AccessSettings {
  baseUrl: string
  token?: string
  timeoutMs: number
  cacheTtlMs: number
  /** The grace of an outage of the service, in milliseconds. */
  staleGraceMs: number
  allowAnonymous: boolean
  /**
   * The number of failures of the service before it is not called any
   * more, and how long it is not called.
   *
   * The breaker only refuses: it never lets a caller in, so it cannot be
   * a hole. Zero disables it.
   */
  breakerFailures: number
  breakerCooldownMs: number
}

/** The settings of the signature of the identity. */
export interface IdentitySettings {
  /**
   * The private key that signs the identity of a request, as a PEM.
   *
   * The key is an elliptic curve key on the curve P-256, and the signature
   * is an `ES256` one. The upstreams are given the **public** key: they
   * verify the identity of a request and they cannot mint one.
   *
   * A deployment that does not set it signs with a key that is generated
   * for the process: the format of the signature is the same, but no
   * upstream can verify the identity, and the key is neither shared by the
   * replicas nor kept across a restart. A production deployment has to set
   * it: the key belongs to the deployment and it is the same on every
   * replica.
   */
  signingKey?: string
}

/** The settings of the sessions. */
export interface SessionSettings {
  url: string
  keyPrefix: string
  ttlMs: number
  /** The maximum age of a session, counted from its creation. 0 is unlimited. */
  maxAgeMs: number
  touchIntervalMs: number
  maxSessions: number
  tlsCa?: string
  /**
   * The name of the master, when the server is behind sentinel.
   *
   * The hosts of the url are then the sentinels, and the master and the
   * replicas are discovered from them.
   */
  sentinelMaster?: string
  /** The secret that signs the state cookie and that derives the signature key. */
  secret: string
  /** The settings of the pool of the connections, when the server is a Postgres server. */
  postgres: PostgresSettings
}

/** The settings of the pool of the connections of a Postgres server. */
export interface PostgresSettings {
  /** The number of connections of the pool of a replica. */
  poolMax: number
  /** How long the client waits for a connection of the pool. */
  connectionTimeoutMs: number
  /** How long a statement of the gateway may run, in milliseconds. */
  statementTimeoutMs: number
  /**
   * Whether the server waits for the disk before it answers.
   *
   * The state of the shared state is a protection and not a ledger: a
   * counter that is lost when the server crashes costs a caller a few
   * requests of its budget, and a session that is lost costs a caller its
   * login. `off` is the same guarantee a Redis server gives without its
   * append only file, and it is the default for that reason. `on` waits
   * for the disk on every transaction.
   */
  synchronousCommit: 'on' | 'off'
  /**
   * Builds the schema of the shared state when the client connects.
   *
   * The statements are idempotent, so a deployment whose replicas start
   * at the same time does not race with itself. A deployment that applies
   * its own migrations says no here.
   */
  autoMigrate: boolean
}

/** The settings of the state the replicas share. */
export interface SharedStateSettings {
  url?: string
  keyPrefix: string
  tlsCa?: string
  /** The name of the master, when the server is behind sentinel. */
  sentinelMaster?: string
  /** The settings of the pool of the connections, when the server is a Postgres server. */
  postgres: PostgresSettings
}

/** The settings of the listener and of the network. */
export interface NetworkSettings {
  host: string
  port: number
  /** The protocol the clients use towards the gateway. */
  externalProto: 'http' | 'https'
  /** The extra ranges whose forwarding headers are trusted. */
  trustedProxies: string[]
  /**
   * True when the environment names the ranges of the trusted proxies.
   *
   * The ranges of the environment replace the ones of the configuration
   * file when it does: an operator that names the proxies of the
   * deployment in the environment is not surprised by the ranges of the
   * file.
   */
  trustedProxiesConfigured: boolean
  /**
   * The number of trusted proxies that are in front of the gateway.
   *
   * Every one of them appends the address it observed to the chain of
   * `x-forwarded-for`, so the chain holds one entry per proxy. The number
   * is what tells the entries the proxies wrote from the ones a client
   * injected, and the address of the caller is never one of the latter.
   */
  trustedProxyHops: number
}

/** The settings of the browser. */
/**
 * The TLS of the connections to the upstreams.
 *
 * The gateway presents the certificate of the deployment to the upstreams
 * that ask for one, and it verifies the certificate of the upstream with the
 * authority of the deployment.
 */
export interface UpstreamTlsSettings {
  /** The authority that signs the certificate of the upstream, in PEM. */
  ca?: string
  /** The certificate of the gateway, in PEM. */
  cert?: string
  /** The private key of the certificate of the gateway, in PEM. */
  key?: string
}

export interface BrowserSettings {
  /** The `Secure` attribute of the cookies. */
  cookieSecure: boolean
  /** The origins that are allowed in addition to the origin of the gateway. */
  allowedOrigins: string[]
  /** Refuse the navigations from another site as well. */
  csrfStrict: boolean
}

/** The settings of the limiters. */
export interface LimitSettings {
  maxBodyBytes: number
  /** The budget of one attempt to an upstream, when the route names several. */
  upstreamAttemptMs: number
  /** The size of a body that may be sent again to a second upstream. */
  replayMaxBytes: number
  /**
   * The number of consecutive failures before an upstream is skipped.
   *
   * The breaker is passive: it learns from the failures the gateway
   * observes and it never probes an upstream. An upstream that failed
   * recently is moved to the end of the list, so a request that may not be
   * sent twice still reaches an upstream that answered recently.
   *
   * Zero disables the breaker: the order of the list is always the order of
   * the file.
   */
  upstreamBreakerFailures: number
  /**
   * How long an upstream is skipped, in milliseconds.
   *
   * The upstream is tried again when the cooldown is over, even when it
   * failed in the meantime: the breaker never removes an upstream.
   */
  upstreamBreakerCooldownMs: number
  route: { max: number; windowMs: number }
  global: { max: number; windowMs: number }
  /**
   * The budget of an authenticated caller on one route.
   *
   * The other scopes are keyed by the address of the caller, so a caller
   * behind a proxy that serves many users shares one budget with all of
   * them. This scope is keyed by the subject of the caller, so one noisy
   * tenant cannot spend the budget of the others.
   */
  principal: { max: number; windowMs: number }
  /**
   * The budget of the whole deployment.
   *
   * The scopes that are keyed by an address cannot bound a flood that
   * spreads over many addresses. This scope can: every request of the
   * deployment is counted in the same window.
   */
  total: { max: number; windowMs: number }
  login: { max: number; windowMs: number }
  /**
   * What happens to a request when the state the replicas share cannot be
   * reached.
   *
   * The limiter of a scope that lives in the shared state cannot count the
   * request in the window of the deployment while the server is down.
   *
   * - `local`: the request is counted in the window of the **process**. The
   *   flood is bounded by the number of the replicas instead of being
   *   unbounded.
   * - `open`: every request is allowed. The behaviour of the releases
   *   before this one.
   * - `closed`: every request is refused.
   */
  fallback: RateLimitFallbackMode
}

/**
 * The settings of the resources of the process.
 */
export interface ResourceSettings {
  /**
   * The maximum number of requests that may be handled at the same time.
   *
   * A client that opens a request and never sends its body holds a
   * connection until the idle budget of the upload runs out. The cap is
   * the bound of that. A value of zero means "no limit".
   */
  maxConcurrentRequests: number
  /**
   * The maximum number of requests that may be inside the gateway at the
   * same time.
   *
   * The cap above bounds the exchanges with the upstreams. This one
   * bounds the whole pipeline, and it covers the phase that comes before
   * the exchange: the limits, the session and the decision of the access
   * service. A request that waits for a hanging access service holds the
   * resources of the process for the whole budget of the call, and the
   * cap of the exchanges never sees it.
   *
   * A request that does not fit is refused at once with `503
   * gateway_overloaded`: a refusal is faster than a wait.
   *
   * A value of zero means "no limit".
   */
  maxPendingRequests: number
}

/** The settings of the websockets. */
export interface WebSocketSettings {
  maxConnections: number
  maxPayloadBytes: number
  maxBufferedBytes: number
  maxBufferedMessages: number
  backpressureLimitBytes: number
  pingIntervalMs: number
  pongTimeoutMs: number
  idleTimeoutSeconds: number
  handshakeTimeoutMs: number
  /**
   * How often an open connection is revalidated, in milliseconds.
   *
   * A value of zero disables the revalidation: the connection is then
   * authorized when it is opened and never again.
   */
  revalidateIntervalMs: number
}

/** The settings of the observation. */
export interface ObservabilitySettings {
  logLevel: LogLevel
  /** The bearer token that guards the metrics endpoint. */
  metricsToken?: string
}

/** Everything the gateway needs to start. */
export interface RuntimeSettings {
  /** True when `NODE_ENV=production`. */
  production: boolean
  /** The file the route table is read from. */
  configPath: string
  /**
   * Where the route table comes from.
   *
   * `file` reads it from `GATEWAY_CONFIG` and watches the file; `store`
   * reads it from the shared state, where the control plane writes the
   * revisions of the table (§3.4 of the specification).
   */
  configSource: ConfigSource
  network: NetworkSettings
  oidc: OidcSettings
  access: AccessSettings
  session: SessionSettings
  sharedState: SharedStateSettings
  browser: BrowserSettings
  /** The settings of the signature of the identity. */
  identity: IdentitySettings
  /** The TLS of the connections to the upstreams. */
  upstreamTls: UpstreamTlsSettings
  limits: LimitSettings
  /** The bounds of the resources of the process. */
  resources: ResourceSettings
  websockets: WebSocketSettings
  observability: ObservabilitySettings
  /** The deadline of the drain on a termination signal. */
  shutdownTimeoutMs: number
}

/** The issuer of the development fixture. */
export const DEVELOPMENT_OIDC_ISSUER = 'http://localhost:5556/dex'

/** The address of the development fixture of access. */
export const DEVELOPMENT_ACCESS_URL = 'http://localhost:8090'

/** The settings of the control plane. */
export interface ControlSettings {
  /** True when `NODE_ENV=production`. */
  production: boolean
  /** The address the control plane listens on. It is internal. */
  host: string
  /** The port the control plane listens on. */
  port: number
  /** The map of the tokens, as it is written in the environment. */
  tokens?: string
  /** The file that holds the map of the tokens. */
  tokensFile?: string
  /** The shared state the control plane acts on. */
  stateUrl: string
  /** The authority that signs the certificate of the server. */
  stateTlsCa?: string
  /** The prefix of the keys of the state: the sessions and the route table. */
  keyPrefix: string
  /** The prefix of the keys of the decisions of access. */
  sharedStateKeyPrefix: string
  /** The routes a write may not remove and may not change. */
  protectedRoutes: string[]
  /** The defaults of the deployment, the ones of the file of the gateway. */
  defaults: EnvironmentDefaults
  /** The ranges whose forwarding headers are trusted. */
  trustedProxies: string[]
  /**
   * True when the environment names the ranges of the trusted proxies.
   *
   * The ranges of the environment replace the ones of the configuration
   * file when it does.
   */
  trustedProxiesConfigured: boolean
  /** The settings of the pool of the connections of a Postgres server. */
  postgres: PostgresSettings
}
