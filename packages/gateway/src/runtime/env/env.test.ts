import { describe, expect, test } from 'bun:test'
import { parseLogLevel, readEnv } from './index'

describe('the environment of the gateway', () => {
  test('the defaults are the ones of the specification', () => {
    const settings = readEnv({})
    expect(settings.configPath).toBe('./config/routes.json')
    expect(settings.network.host).toBe('0.0.0.0')
    expect(settings.network.port).toBe(8080)
    expect(settings.network.externalProto).toBe('http')
    expect(settings.session.url).toBe('memory://local')
    expect(settings.session.ttlMs).toBe(28_800_000)
    expect(settings.session.maxAgeMs).toBe(86_400_000)
    expect(settings.session.touchIntervalMs).toBe(60_000)
    expect(settings.session.maxSessions).toBe(5_000)
    expect(settings.limits.maxBodyBytes).toBe(10_485_760)
    expect(settings.limits.route.max).toBe(0)
    expect(settings.limits.global.max).toBe(0)
    expect(settings.limits.login.max).toBe(30)
    expect(settings.websockets.maxConnections).toBe(1_000)
    expect(settings.websockets.maxPayloadBytes).toBe(16_777_216)
    expect(settings.websockets.maxBufferedBytes).toBe(262_144)
    expect(settings.websockets.maxBufferedMessages).toBe(100)
    expect(settings.websockets.backpressureLimitBytes).toBe(1_048_576)
    expect(settings.websockets.pingIntervalMs).toBe(30_000)
    expect(settings.websockets.pongTimeoutMs).toBe(90_000)
    expect(settings.websockets.idleTimeoutSeconds).toBe(120)
    expect(settings.websockets.handshakeTimeoutMs).toBe(10_000)
    expect(settings.shutdownTimeoutMs).toBe(15_000)
    expect(settings.oidc.scopes).toEqual(['openid', 'profile', 'email', 'groups'])
    expect(settings.access.timeoutMs).toBe(3_000)
    expect(settings.access.cacheTtlMs).toBe(5_000)
  })

  test('a malformed value stops the gateway', () => {
    expect(() => readEnv({ GATEWAY_PORT: 'http' })).toThrow(/GATEWAY_PORT/)
    expect(() => readEnv({ GATEWAY_SESSION_TTL_MS: '-1' })).toThrow(/GATEWAY_SESSION_TTL_MS/)
    expect(() => readEnv({ GATEWAY_CSRF_STRICT: 'yes' })).toThrow(/GATEWAY_CSRF_STRICT/)
    expect(() => readEnv({ GATEWAY_EXTERNAL_PROTO: 'ftp' })).toThrow(/GATEWAY_EXTERNAL_PROTO/)
  })

  test('the level of the log falls back to info', () => {
    expect(readEnv({ GATEWAY_LOG_LEVEL: 'nonsense' }).observability.logLevel).toBe('info')
    expect(readEnv({ GATEWAY_LOG_LEVEL: 'debug' }).observability.logLevel).toBe('debug')
    expect(parseLogLevel(undefined)).toBe('info')
  })

  test('the lists of the environment are separated by commas', () => {
    const settings = readEnv({
      GATEWAY_TRUSTED_PROXIES: '10.0.0.0/8, 192.168.0.0/16',
      GATEWAY_ALLOWED_ORIGINS: 'https://app.example.com',
    })
    expect(settings.network.trustedProxies).toEqual(['10.0.0.0/8', '192.168.0.0/16'])
    expect(settings.browser.allowedOrigins).toEqual(['https://app.example.com'])
  })

  test('the state the replicas share defaults to the session store', () => {
    expect(readEnv({ GATEWAY_SESSION_URL: 'redis://cache:6379/0' }).sharedState.url).toBe(
      'redis://cache:6379/0'
    )
    expect(readEnv({ GATEWAY_SESSION_URL: 'memory://local' }).sharedState.url).toBeUndefined()
    expect(
      readEnv({
        GATEWAY_SESSION_URL: 'redis://cache:6379/0',
        GATEWAY_SHARED_STATE_URL: 'redis://other:6379/1',
      }).sharedState.url
    ).toBe('redis://other:6379/1')
  })

  test('a secret that is not set is generated per process', () => {
    const first = readEnv({}).session.secret
    const second = readEnv({}).session.secret
    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThanOrEqual(32)
  })

  test('the TLS of the upstreams is read from the environment', () => {
    const settings = readEnv({
      GATEWAY_UPSTREAM_TLS_CA: 'the-ca',
      GATEWAY_UPSTREAM_TLS_CERT: 'the-cert',
      GATEWAY_UPSTREAM_TLS_KEY: 'the-key',
    })
    expect(settings.upstreamTls.ca).toBe('the-ca')
    expect(settings.upstreamTls.cert).toBe('the-cert')
    expect(settings.upstreamTls.key).toBe('the-key')
  })

  test('the certificates of the upstreams may be given as base64', () => {
    const settings = readEnv({
      GATEWAY_UPSTREAM_TLS_CA_BASE64: Buffer.from('the-ca').toString('base64'),
      GATEWAY_UPSTREAM_TLS_CERT_BASE64: Buffer.from('the-cert').toString('base64'),
      GATEWAY_UPSTREAM_TLS_KEY_BASE64: Buffer.from('the-key').toString('base64'),
    })
    expect(settings.upstreamTls.ca).toBe('the-ca')
    expect(settings.upstreamTls.cert).toBe('the-cert')
    expect(settings.upstreamTls.key).toBe('the-key')
  })

  test('the certificate of the gateway and its key belong together', () => {
    expect(() => readEnv({ GATEWAY_UPSTREAM_TLS_CERT: 'the-cert' })).toThrow(
      /GATEWAY_UPSTREAM_TLS_CERT and GATEWAY_UPSTREAM_TLS_KEY/
    )
    expect(() => readEnv({ GATEWAY_UPSTREAM_TLS_KEY: 'the-key' })).toThrow(
      /GATEWAY_UPSTREAM_TLS_CERT and GATEWAY_UPSTREAM_TLS_KEY/
    )
  })
})

describe('the environment of a production deployment', () => {
  const production = {
    NODE_ENV: 'production',
    GATEWAY_SESSION_SECRET: 'secret',
    GATEWAY_IDENTITY_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    GATEWAY_OIDC_ISSUER: 'https://dex.example.com/dex',
    GATEWAY_OIDC_CLIENT_ID: 'gateway',
    GATEWAY_OIDC_CLIENT_SECRET: 'client-secret',
    GATEWAY_OIDC_REDIRECT_URI: 'https://gateway.example.com/auth/callback',
    GATEWAY_ACCESS_URL: 'https://access.example.com',
    GATEWAY_ACCESS_TOKEN: 'access-token',
    GATEWAY_RATE_LIMIT_MAX: '600',
    GATEWAY_SESSION_URL: 'redis://cache:6379/0',
  }

  test('a complete environment is accepted', () => {
    const settings = readEnv(production)
    expect(settings.production).toBe(true)
    expect(settings.browser.cookieSecure).toBe(true)
  })

  test('the check of the type of a bearer token is on by default', () => {
    const settings = readEnv({})
    expect(settings.oidc.rejectNonceTokens).toBe(true)
    expect(settings.oidc.requiredTokenClaims).toEqual([])
    // A provider whose access tokens carry a nonce turns the check off.
    const lenient = readEnv({ GATEWAY_OIDC_REJECT_NONCE_TOKEN: 'false' })
    expect(lenient.oidc.rejectNonceTokens).toBe(false)
  })

  test('the claims a bearer token has to carry are read from the environment', () => {
    const settings = readEnv({ GATEWAY_OIDC_REQUIRED_TOKEN_CLAIMS: 'scp, token_use' })
    expect(settings.oidc.requiredTokenClaims).toEqual(['scp', 'token_use'])
  })

  test('the key of the identity signature is read from the environment', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n'
    const settings = readEnv({ GATEWAY_IDENTITY_SIGNING_KEY: pem })
    expect(settings.identity.signingKey).toBe(pem)
    // The secret stores hand out the keys in base64.
    const encoded = readEnv({
      GATEWAY_IDENTITY_SIGNING_KEY_BASE64: Buffer.from(pem, 'utf8').toString('base64'),
    })
    expect(encoded.identity.signingKey).toBe(pem)
  })

  test('a production deployment needs the key of the identity signature', () => {
    expect(() => readEnv({ ...production, GATEWAY_IDENTITY_SIGNING_KEY: undefined })).toThrow(
      /GATEWAY_IDENTITY_SIGNING_KEY/
    )
    const settings = readEnv({
      ...production,
      GATEWAY_IDENTITY_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    })
    expect(settings.identity.signingKey).toContain('BEGIN PRIVATE KEY')
  })

  test('at least one rate limit is required', () => {
    expect(() => readEnv({ ...production, GATEWAY_RATE_LIMIT_MAX: '0' })).toThrow(
      /at least one rate limit/
    )
    // The deployment may say explicitly that another layer protects it.
    const settings = readEnv({
      ...production,
      GATEWAY_RATE_LIMIT_MAX: '0',
      GATEWAY_ALLOW_NO_RATE_LIMITS: 'true',
    })
    expect(settings.limits.route.max).toBe(0)
  })

  test.each([
    ['GATEWAY_SESSION_SECRET'],
    ['GATEWAY_OIDC_ISSUER'],
    ['GATEWAY_OIDC_CLIENT_ID'],
    ['GATEWAY_OIDC_REDIRECT_URI'],
    ['GATEWAY_OIDC_CLIENT_SECRET'],
    ['GATEWAY_ACCESS_URL'],
    ['GATEWAY_ACCESS_TOKEN'],
  ])('a production deployment needs %s', (name) => {
    expect(() => readEnv({ ...production, [name]: undefined })).toThrow(new RegExp(name))
  })

  test('the secret of the client is required, unless the provider accepts a public client', () => {
    const settings = readEnv({
      ...production,
      GATEWAY_OIDC_CLIENT_SECRET: undefined,
      GATEWAY_OIDC_ALLOW_PUBLIC_CLIENT: 'true',
    })
    expect(settings.oidc.allowPublicClient).toBe(true)
  })

  test('the access service is required', () => {
    const settings = readEnv({
      ...production,
      GATEWAY_ACCESS_TOKEN: undefined,
      GATEWAY_ACCESS_ALLOW_ANONYMOUS: 'true',
    })
    expect(settings.access.allowAnonymous).toBe(true)
  })

  test('a provider that is not served over https is refused', () => {
    expect(
      readEnv({ ...production, GATEWAY_OIDC_ALLOW_INSECURE: 'true' }).oidc.allowInsecureIssuer
    ).toBe(true)
    expect(readEnv(production).oidc.allowInsecureIssuer).toBe(false)
  })

  test('the state of the deployment has to be shared', () => {
    // The in-process store is not shared: the callers are logged out at
    // random when the deployment has more than one replica.
    expect(() => readEnv({ ...production, GATEWAY_SESSION_URL: 'memory://local' })).toThrow(
      /GATEWAY_SESSION_URL must name a Redis or a Postgres server/
    )
    // The limits and the decisions have to be shared as well.
    expect(() => readEnv({ ...production, GATEWAY_SHARED_STATE_URL: 'memory://local' })).toThrow(
      /GATEWAY_SHARED_STATE_URL must name a Redis or a Postgres server/
    )
  })

  test('the shared state may live in a Postgres server', () => {
    const settings = readEnv({
      ...production,
      GATEWAY_SESSION_URL: 'postgres://user:password@db:5432/gateway',
    })
    expect(settings.session.url).toBe('postgres://user:password@db:5432/gateway')
    // The state the replicas share follows the sessions when it is not
    // named on its own.
    expect(settings.sharedState.url).toBe('postgres://user:password@db:5432/gateway')
  })

  test('the pool of a Postgres server is bounded', () => {
    const settings = readEnv({
      ...production,
      GATEWAY_SESSION_URL: 'postgres://db:5432/gateway',
      GATEWAY_POSTGRES_POOL_MAX: '25',
    })
    expect(settings.session.postgres.poolMax).toBe(25)
    expect(settings.sharedState.postgres.poolMax).toBe(25)
  })

  test('a production deployment applies its own migrations', () => {
    // The schema is built by the gateway outside a production deployment:
    // a gateway that is started with a read-only database account must not
    // fail because of it.
    expect(
      readEnv({ ...production, GATEWAY_SESSION_URL: 'postgres://db:5432/gateway' }).session.postgres
        .autoMigrate
    ).toBe(false)
    expect(
      readEnv({
        GATEWAY_SESSION_URL: 'postgres://db:5432/gateway',
        GATEWAY_POSTGRES_AUTO_MIGRATE: 'true',
      }).session.postgres.autoMigrate
    ).toBe(true)
  })

  test('a single node deployment may keep the state in the process', () => {
    const settings = readEnv({
      ...production,
      GATEWAY_SESSION_URL: 'memory://local',
      GATEWAY_ALLOW_MEMORY_STATE: 'true',
    })
    expect(settings.session.url).toBe('memory://local')
    expect(settings.sharedState.url).toBeUndefined()
  })

  test('the shared state follows the sessions of a deployment', () => {
    const settings = readEnv({
      ...production,
      GATEWAY_SESSION_URL: 'redis://cache:6379/0',
      GATEWAY_SHARED_STATE_URL: 'redis://cache:6379/1',
    })
    expect(settings.sharedState.url).toBe('redis://cache:6379/1')
  })
})
