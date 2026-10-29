import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPublishedSecret, readEnv, secretBytes } from './env'

/** The environment of a production deployment, with every secret. */
const PRODUCTION: Record<string, string> = {
  ACCESS_ENVIRONMENT: 'production',
  ACCESS_DATABASE_URL: 'postgres://access:access@localhost:5432/access',
  ACCESS_REDIS_URL: 'redis://localhost:6379/0',
  ACCESS_ISSUER: 'https://access.example.com',
  ACCESS_ADMIN_TOKEN: 'the-admin-token-of-the-production',
  ACCESS_DECISION_TOKEN: 'the-access-token-of-the-production',
  ACCESS_STATE_SECRET: '4f9a2c8e'.repeat(8),
  ACCESS_SECRET_ENCRYPTION_KEY: 'b31e7d09'.repeat(8),
  ACCESS_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
  ACCESS_SIGNING_KID: 'access-1',
}

describe('the environment of Access', () => {
  test('the defaults are the ones of the specification', () => {
    const settings = readEnv({ ACCESS_DATABASE_URL: 'postgres://localhost:5432/access' })
    expect(settings.environment).toBe('development')
    expect(settings.production).toBe(false)
    expect(settings.network.host).toBe('0.0.0.0')
    expect(settings.network.port).toBe(8081)
    expect(settings.public.issuer).toBe('http://localhost:8081')
    expect(settings.public.publicUrl).toBe('http://localhost:8081')
    expect(settings.timeouts.idpTimeoutMs).toBe(5_000)
    expect(settings.timeouts.decisionTimeoutMs).toBe(2_000)
    expect(settings.timeouts.clockSkewSeconds).toBe(60)
    expect(settings.observability.logLevel).toBe('info')
    expect(settings.store.allowMemoryState).toBe(false)
    expect(settings.store.url).toBeUndefined()
  })

  test('the public url of Access defaults to the issuer', () => {
    const settings = readEnv({
      ACCESS_DATABASE_URL: 'postgres://localhost:5432/access',
      ACCESS_ISSUER: 'https://access.example.com',
    })
    expect(settings.public.publicUrl).toBe('https://access.example.com')
    expect(
      readEnv({
        ACCESS_DATABASE_URL: 'postgres://localhost:5432/access',
        ACCESS_ISSUER: 'https://access.example.com',
        ACCESS_PUBLIC_URL: 'https://www.access.example.com',
      }).public.publicUrl
    ).toBe('https://www.access.example.com')
  })

  test('the database of a development machine is the embedded one', () => {
    const settings = readEnv({})
    expect(settings.database.driver).toBe('pglite')
    expect(settings.database.path).toBe('./.access/pglite')
    expect(settings.database.url).toBeUndefined()
  })

  test('the url of the database names the driver', () => {
    expect(
      readEnv({ ACCESS_DATABASE_URL: 'postgres://access:access@localhost:5432/access' }).database
        .driver
    ).toBe('postgres')
    expect(
      readEnv({ ACCESS_DATABASE_URL: 'postgres://access:access@localhost:5432/access' }).database
        .url
    ).toBe('postgres://access:access@localhost:5432/access')
    expect(readEnv({ ACCESS_DATABASE_URL: 'pglite://memory://' }).database.driver).toBe('pglite')
    expect(readEnv({ ACCESS_DATABASE_URL: 'pglite://memory://' }).database.path).toBe('memory://')
    expect(readEnv({ ACCESS_DATABASE_URL: 'pglite://' }).database.path).toBe('./.access/pglite')
    expect(() => readEnv({ ACCESS_DATABASE_URL: 'mysql://localhost' })).toThrow(
      /ACCESS_DATABASE_URL/
    )
  })

  test('a malformed value stops the service', () => {
    const database = { ACCESS_DATABASE_URL: 'postgres://localhost:5432/access' }
    expect(() => readEnv({ ...database, ACCESS_PORT: 'http' })).toThrow(/ACCESS_PORT/)
    expect(() => readEnv({ ...database, ACCESS_IDP_TIMEOUT_MS: '-1' })).toThrow(
      /ACCESS_IDP_TIMEOUT_MS/
    )
    expect(() => readEnv({ ...database, ACCESS_DECISION_TIMEOUT_MS: 'soon' })).toThrow(
      /ACCESS_DECISION_TIMEOUT_MS/
    )
    expect(() => readEnv({ ...database, ACCESS_ENVIRONMENT: 'staging' })).toThrow(
      /ACCESS_ENVIRONMENT/
    )
    expect(() => readEnv({ ...database, ACCESS_ISSUER: 'not-a-url' })).toThrow(/ACCESS_ISSUER/)
  })

  test('the level of the log falls back to info', () => {
    const database = { ACCESS_DATABASE_URL: 'postgres://localhost:5432/access' }
    expect(readEnv({ ...database, ACCESS_LOG_LEVEL: 'nonsense' }).observability.logLevel).toBe(
      'info'
    )
    expect(readEnv({ ...database, ACCESS_LOG_LEVEL: 'debug' }).observability.logLevel).toBe('debug')
  })

  test('a production deployment needs every secret', () => {
    let message = ''
    try {
      readEnv({ ACCESS_ENVIRONMENT: 'production' })
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain('ACCESS_DATABASE_URL')
    expect(message).toContain('ACCESS_ISSUER')
    expect(message).toContain('ACCESS_ADMIN_TOKEN')
    expect(message).toContain('ACCESS_STATE_SECRET')
    expect(message).toContain('ACCESS_SECRET_ENCRYPTION_KEY')
    expect(message).toContain('ACCESS_SIGNING_KEY')
    expect(message).toContain('ACCESS_SIGNING_KID')
    expect(message).toContain('ACCESS_REDIS_URL')
  })

  test('the shared token of the decisions is optional', () => {
    // The token of the deployment is not scoped to a tenant and it is
    // deprecated: a deployment that has moved its gateways to the
    // credentials of their tenant does not set it (spec §8.8).
    const settings = readEnv({ ...PRODUCTION, ACCESS_DECISION_TOKEN: undefined })
    expect(settings.production).toBe(true)
    expect(settings.access.token).toBeUndefined()
  })

  test('the previous token of the decisions without the token it replaced is refused', () => {
    // The deployment believes it removed the shared secret, and the
    // secret is still accepted: the service says so instead of starting.
    expect(() =>
      readEnv({
        ...PRODUCTION,
        ACCESS_DECISION_TOKEN: undefined,
        ACCESS_PREVIOUS_DECISION_TOKEN: 'old',
      })
    ).toThrow(/ACCESS_PREVIOUS_DECISION_TOKEN/)
  })

  test('a production deployment with only the credentials of its tenants starts', () => {
    // The deployment names its credentials and does not name the token
    // of the platform: the administration is guarded by the credentials
    // of the tenants (spec §4.4, §4.6).
    const settings = readEnv({
      ...PRODUCTION,
      ACCESS_ADMIN_TOKEN: undefined,
      ACCESS_ADMIN_TOKENS:
        '{"the-token-of-the-operator-of-acme":{"tenant":"acme","operator":"alice"}}',
    })
    expect(settings.production).toBe(true)
    expect(settings.admin.token).toBeUndefined()
    expect(settings.admin.credentials).toContain('the-token-of-the-operator-of-acme')
  })

  test('a production deployment with every secret starts', () => {
    const settings = readEnv(PRODUCTION)
    expect(settings.production).toBe(true)
    expect(settings.public.issuer).toBe('https://access.example.com')
    expect(settings.admin.token).toBe('the-admin-token-of-the-production')
    expect(settings.access.token).toBe('the-access-token-of-the-production')
    expect(settings.store.url).toBe('redis://localhost:6379/0')
    expect(settings.signing.kid).toBe('access-1')
  })

  test('a deployment of a single node may keep the state in the process', () => {
    const settings = readEnv({
      ...PRODUCTION,
      ACCESS_REDIS_URL: undefined,
      ACCESS_ALLOW_MEMORY_STATE: 'true',
    })
    expect(settings.store.allowMemoryState).toBe(true)
    expect(settings.store.url).toBeUndefined()
  })

  test('a production deployment without the shared store is refused', () => {
    expect(() => readEnv({ ...PRODUCTION, ACCESS_REDIS_URL: undefined })).toThrow(
      /ACCESS_REDIS_URL/
    )
  })

  test('a production deployment does not run on the embedded database', () => {
    expect(() => readEnv({ ...PRODUCTION, ACCESS_DATABASE_URL: 'pglite://memory://' })).toThrow(
      /ACCESS_DATABASE_URL/
    )
  })

  test('a secret that is too short is refused', () => {
    expect(() => readEnv({ ...PRODUCTION, ACCESS_STATE_SECRET: 'short' })).toThrow(
      /ACCESS_STATE_SECRET/
    )
    expect(() => readEnv({ ...PRODUCTION, ACCESS_SECRET_ENCRYPTION_KEY: 'short' })).toThrow(
      /ACCESS_SECRET_ENCRYPTION_KEY/
    )
  })

  test('a signing key that is not a private key is refused', () => {
    expect(() => readEnv({ ...PRODUCTION, ACCESS_SIGNING_KEY: 'the-key' })).toThrow(
      /ACCESS_SIGNING_KEY/
    )
  })

  test('a token that is too short is refused in a production deployment', () => {
    // The length of a secret is the first thing that is tried: a token
    // of one character protects the administration as well as a token of
    // thirty two characters (spec §4.1).
    //
    // The token of the administration and the token of the decisions act
    // for every tenant of the platform: they are thirty-two bytes at
    // least (spec §10.1, §8.8).
    expect(() => readEnv({ ...PRODUCTION, ACCESS_ADMIN_TOKEN: 'short' })).toThrow(
      /ACCESS_ADMIN_TOKEN must be at least 32 bytes/
    )
    expect(() => readEnv({ ...PRODUCTION, ACCESS_METRICS_TOKEN: 'short' })).toThrow(
      /ACCESS_METRICS_TOKEN must be at least 16 bytes/
    )
    expect(() =>
      readEnv({
        ...PRODUCTION,
        ACCESS_DECISION_TOKEN: 'short',
        ACCESS_PREVIOUS_DECISION_TOKEN: undefined,
      })
    ).toThrow(/ACCESS_DECISION_TOKEN must be at least 32 bytes/)
  })

  test('a token that the repository publishes is refused in a production deployment', () => {
    // The values of the examples of the repository are published: a
    // deployment that starts with one of them holds a credential that
    // everybody knows (spec §4.1).
    expect(() => readEnv({ ...PRODUCTION, ACCESS_ADMIN_TOKEN: 'dev-admin-token-0000000' })).toThrow(
      /ACCESS_ADMIN_TOKEN is the value of the example/
    )
    expect(() =>
      readEnv({ ...PRODUCTION, ACCESS_DECISION_TOKEN: 'example-access-token-0000000' })
    ).toThrow(/ACCESS_DECISION_TOKEN is the value of the example/)
  })

  test('a token that is not set is not a short token', () => {
    // The shared token of the decisions is optional: its absence is not
    // a length (spec §4.4, §8.8).
    const settings = readEnv({ ...PRODUCTION, ACCESS_METRICS_TOKEN: undefined })
    expect(settings.metrics.token).toBeUndefined()
  })

  test('the values of the example are refused in a production deployment', () => {
    // The example file is published, and so is every deployment that
    // kept one of its values (spec §4.1).
    expect(() =>
      readEnv({ ...PRODUCTION, ACCESS_ADMIN_TOKEN: 'the-admin-token-of-the-development' })
    ).toThrow(/ACCESS_ADMIN_TOKEN is the value of the example/)
  })

  test('a secret that is one repeated character is refused in a production deployment', () => {
    expect(() => readEnv({ ...PRODUCTION, ACCESS_STATE_SECRET: '0'.repeat(64) })).toThrow(
      /ACCESS_STATE_SECRET is the value of the example/
    )
    expect(() => readEnv({ ...PRODUCTION, ACCESS_SECRET_ENCRYPTION_KEY: '1'.repeat(64) })).toThrow(
      /ACCESS_SECRET_ENCRYPTION_KEY is the value of the example/
    )
  })

  test('a development machine may use the values of the example', () => {
    const settings = readEnv({
      ACCESS_ADMIN_TOKEN: 'the-admin-token-of-the-development',
      ACCESS_STATE_SECRET: '0'.repeat(64),
    })
    expect(settings.admin.token).toBe('the-admin-token-of-the-development')
  })

  test('the size of a secret is counted the way it is read', () => {
    expect(secretBytes('a'.repeat(64))).toBe(32)
    expect(secretBytes('a'.repeat(43) + '=')).toBe(32)
    expect(secretBytes('secret-passphrase-32-bytes-long!')).toBe(32)
    expect(secretBytes('secret-passphrase-31-bytes-long')).toBe(31)
  })
})

describe('the credentials of the access context', () => {
  test('the values of the examples are published', () => {
    // The list is the vocabulary of the published values of the service:
    // the test of the platform reads it and asks Access to refuse every
    // value of the repository that it holds.
    expect(isPublishedSecret('development-access-context-token-0001')).toBe(true)
    expect(isPublishedSecret('the-secret-of-the-deployment')).toBe(false)
  })

  test('a credential that the repository publishes is refused in production', () => {
    expect(() =>
      readEnv({
        ...PRODUCTION,
        ACCESS_CONTEXT_TOKENS: '{"development-access-context-token-0001":null}',
      })
    ).toThrow(/ACCESS_CONTEXT_TOKENS holds a credential that is the value of the example/)
  })

  test('a credential of the contract is at least thirty-two bytes in production', () => {
    expect(() =>
      readEnv({ ...PRODUCTION, ACCESS_CONTEXT_TOKENS: '{"a-short-credential":null}' })
    ).toThrow(/ACCESS_CONTEXT_TOKENS holds a credential of 18 bytes/)
  })

  test('a credential of every tenant has to be said out loud', () => {
    // The scope `null` reads the context of every tenant of the
    // platform: it is a choice of the deployment and never the default.
    expect(() =>
      readEnv({
        ...PRODUCTION,
        ACCESS_CONTEXT_TOKENS: '{"the-credential-of-the-platform-0001":null}',
      })
    ).toThrow(/ACCESS_CONTEXT_ALLOW_PLATFORM_TOKEN/)
    const settings = readEnv({
      ...PRODUCTION,
      ACCESS_CONTEXT_TOKENS: '{"the-credential-of-the-platform-0001":null}',
      ACCESS_CONTEXT_ALLOW_PLATFORM_TOKEN: 'true',
    })
    expect(settings.access.contextTokens).toContain('the-credential-of-the-platform-0001')
  })

  test('a credential that is scoped to its tenants is accepted', () => {
    const settings = readEnv({
      ...PRODUCTION,
      ACCESS_CONTEXT_TOKENS:
        '{"the-credential-of-the-tenant-000001":["6a1f5f0e-4f36-4a51-9b3d-2f6f0f6f2b11"]}',
    })
    expect(settings.access.contextTokens).toContain('the-credential-of-the-tenant-000001')
  })

  test('a development machine may use the values of the examples', () => {
    const settings = readEnv({
      ...PRODUCTION,
      ACCESS_ENVIRONMENT: 'development',
      ACCESS_CONTEXT_TOKENS: '{"development-access-context-token-0001":null}',
    })
    expect(settings.access.contextTokens).toContain('development-access-context-token-0001')
  })
})

describe('the values of the environment that are in a file', () => {
  test('a secret in a file is the value of the variable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'access-env-'))
    const file = join(directory, 'signing-key.pem')
    writeFileSync(file, '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n')
    const settings = readEnv({
      ...PRODUCTION,
      ACCESS_SIGNING_KEY: undefined,
      ACCESS_SIGNING_KEY_FILE: file,
    })
    expect(settings.signing.key).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----'
    )
  })

  test('a variable and its file at the same time is a configuration error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'access-env-'))
    const file = join(directory, 'admin-token')
    writeFileSync(file, 'the-admin-token-of-the-production\n')
    expect(() => readEnv({ ...PRODUCTION, ACCESS_ADMIN_TOKEN_FILE: file })).toThrow(
      /ACCESS_ADMIN_TOKEN and ACCESS_ADMIN_TOKEN_FILE are both set/
    )
  })

  test('a file that cannot be read is a configuration error', () => {
    expect(() =>
      readEnv({
        ...PRODUCTION,
        ACCESS_ADMIN_TOKEN: undefined,
        ACCESS_ADMIN_TOKEN_FILE: '/nope/not-here',
      })
    ).toThrow(/ACCESS_ADMIN_TOKEN_FILE names a file that cannot be read/)
  })
})
