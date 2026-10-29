/**
 * The environment of the console.
 *
 * The console reads its configuration from the variables of the process
 * that carry the prefix `CONSOLE_`, once, when it starts. A value that
 * is not understood stops the process: a console that guesses its
 * configuration is a console that talks to the wrong service.
 *
 * An empty value is an absent value: a composition that forwards a
 * variable it does not have forwards an empty string.
 */

/** The levels of the log. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** The configuration of the console. */
export interface ConsoleConfig {
  /** `development` serves the sources through Vite; `production` serves the build. */
  readonly environment: 'development' | 'production'
  readonly host: string
  readonly port: number
  /** The url the browser reaches the console at. */
  readonly publicUrl: URL
  /** Access, as the console reaches it. */
  readonly accessUrl: string
  /** The client of the console at Access. */
  readonly clientId: string
  readonly clientSecret: string
  /** The gateway: the console reads the data of a workspace through it. */
  readonly gatewayUrl: string
  /** Data, for its probes. Optional. */
  readonly dataUrl: string | null
  /** The credential of the administration of the platform. */
  readonly adminToken: string | null
  /** The credentials of the administration of the tenants, by slug. */
  readonly tenantAdminTokens: Readonly<Record<string, string>>
  /** The credential of the contract of the access context. */
  readonly accessContextToken: string | null
  /** The route of the console at Access. */
  readonly routeId: string
  /** The secret that signs the cookies of the console. */
  readonly sessionSecret: string
  /** How long a session survives without being used. */
  readonly sessionTtlMs: number
  /** How long a session may be used at all. */
  readonly sessionMaxAgeMs: number
  /** The budget of a probe of a service. */
  readonly probeTimeoutMs: number
  /** The budget of a call to a service. */
  readonly requestTimeoutMs: number
  readonly logLevel: LogLevel
  /** Whether the cookies of the console carry `Secure`. */
  readonly cookieSecure: boolean
}

/** A configuration that cannot be used. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`the configuration of the console is not usable: ${problems.join('; ')}`)
    this.problems = problems
  }
}

/** The environment the console reads. */
export type Environment = Readonly<Record<string, string | undefined>>

/** Reads a variable, an empty value being an absent one. */
function readValue(env: Environment, name: string): string | undefined {
  const raw = env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Reads a url and drops the slashes at its end. */
function urlOf(
  env: Environment,
  name: string,
  problems: string[],
  required: boolean
): string | null {
  const value = readValue(env, name)
  if (value === undefined) {
    if (required) problems.push(`${name} is required`)
    return null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      problems.push(`${name} is not an http url`)
      return null
    }
    return value.replace(/\/+$/, '')
  } catch {
    problems.push(`${name} is not a url`)
    return null
  }
}

/** Reads a positive integer. */
function integerOf(
  env: Environment,
  name: string,
  fallback: number,
  problems: string[],
  bounds: { min: number; max: number }
): number {
  const value = readValue(env, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    problems.push(`${name} is not an integer between ${bounds.min} and ${bounds.max}`)
    return fallback
  }
  return parsed
}

/**
 * The minimum length of a credential of the console.
 *
 * The credential of the console is the credential of the platform at
 * Access, and Access holds the rule of the strength of its own
 * credentials: the console holds the rule of the length, and it refuses
 * the values that the repository publishes.
 */
const MINIMUM_CREDENTIAL_LENGTH = 16

/**
 * The credentials that are published in the repository.
 *
 * They are the values of the example of the development machine and the
 * values of the deployment of the example: a console that starts with
 * one of them holds a credential that everybody knows. A development
 * machine may use the values of the example; a deployment may not.
 */
const PUBLISHED_CREDENTIALS: readonly string[] = [
  'dev-admin-token-0000000',
  'dev-tenant-token-of-the-development-01',
  'dev-context-token-00000001',
  'dev-access-token-0000000',
  'example-admin-token-0000000',
  'example-access-token-0000000',
]

/**
 * Reads a credential: long enough, and not a published one.
 *
 * The rule of the published value is the rule of the production
 * deployment: a development machine may use the values of the example,
 * and a deployment may not (spec §10.1).
 */
function credentialOf(
  env: Environment,
  name: string,
  problems: string[],
  production: boolean
): string | null {
  const value = readValue(env, name)
  if (value === undefined) return null
  if (value.length < MINIMUM_CREDENTIAL_LENGTH) {
    problems.push(`${name} is shorter than ${MINIMUM_CREDENTIAL_LENGTH} characters`)
    return null
  }
  if (production && PUBLISHED_CREDENTIALS.includes(value.trim())) {
    problems.push(
      `${name} is the value of the example of the repository: it is published, and a deployment does not start with it`
    )
    return null
  }
  return value
}

/** Reads the credentials of the tenants: a json object of slugs and tokens. */
function tenantTokensOf(
  env: Environment,
  problems: string[],
  production: boolean
): Record<string, string> {
  const name = 'CONSOLE_TENANT_ADMIN_TOKENS'
  const value = readValue(env, name)
  if (value === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    problems.push(`${name} is not json`)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    problems.push(`${name} is not an object of slugs and credentials`)
    return {}
  }
  const tokens: Record<string, string> = {}
  for (const [slug, token] of Object.entries(parsed)) {
    if (!/^[a-z0-9-]{2,63}$/.test(slug)) {
      problems.push(`${name} names "${slug}", which is not the slug of a tenant`)
      continue
    }
    if (typeof token !== 'string' || token.length < MINIMUM_CREDENTIAL_LENGTH) {
      problems.push(
        `${name} holds a credential of "${slug}" that is shorter than ${MINIMUM_CREDENTIAL_LENGTH} characters`
      )
      continue
    }
    if (production && PUBLISHED_CREDENTIALS.includes(token.trim())) {
      problems.push(
        `${name} holds a credential of "${slug}" that is the value of the example of the repository: it is published, and a deployment does not start with it`
      )
      continue
    }
    tokens[slug] = token
  }
  return tokens
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

/**
 * Reads the configuration of the console.
 *
 * Every problem is collected before the refusal: an operator who fixes
 * one variable and starts the process again to learn about the next one
 * is an operator who loses an afternoon.
 */
export function readConfig(env: Environment): ConsoleConfig {
  const problems: string[] = []

  const environment = readValue(env, 'CONSOLE_ENVIRONMENT') ?? 'production'
  if (environment !== 'development' && environment !== 'production') {
    problems.push('CONSOLE_ENVIRONMENT is neither development nor production')
  }
  const production = environment === 'production'

  const publicUrlText = urlOf(env, 'CONSOLE_PUBLIC_URL', problems, true)
  const accessUrl = urlOf(env, 'CONSOLE_ACCESS_URL', problems, true)
  const gatewayUrl = urlOf(env, 'CONSOLE_GATEWAY_URL', problems, true)
  const dataUrl = urlOf(env, 'CONSOLE_DATA_URL', problems, false)

  const clientId = readValue(env, 'CONSOLE_CLIENT_ID')
  if (!clientId) problems.push('CONSOLE_CLIENT_ID is required')
  const clientSecret = readValue(env, 'CONSOLE_CLIENT_SECRET')
  if (!clientSecret) problems.push('CONSOLE_CLIENT_SECRET is required')
  else if (production && PUBLISHED_CREDENTIALS.includes(clientSecret.trim())) {
    problems.push(
      'CONSOLE_CLIENT_SECRET is the value of the example of the repository: it is published, and a deployment does not start with it'
    )
  }

  const sessionSecret = readValue(env, 'CONSOLE_SESSION_SECRET')
  if (!sessionSecret) problems.push('CONSOLE_SESSION_SECRET is required')
  else if (sessionSecret.length < 32) {
    problems.push('CONSOLE_SESSION_SECRET is shorter than 32 characters')
  } else if (production && PUBLISHED_CREDENTIALS.includes(sessionSecret.trim())) {
    problems.push(
      'CONSOLE_SESSION_SECRET is the value of the example of the repository: it is published, and a deployment does not start with it'
    )
  }

  const routeId = readValue(env, 'CONSOLE_ROUTE_ID') ?? 'console'
  const logLevel = (readValue(env, 'CONSOLE_LOG_LEVEL') ?? 'info') as LogLevel
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push('CONSOLE_LOG_LEVEL is not one of debug, info, warn, error')
  }

  const hour = 60 * 60 * 1000
  const config = {
    environment: environment as ConsoleConfig['environment'],
    host: readValue(env, 'CONSOLE_HOST') ?? '0.0.0.0',
    port: integerOf(env, 'CONSOLE_PORT', 8083, problems, { min: 1, max: 65535 }),
    publicUrl: new URL(publicUrlText ?? 'http://localhost:8083'),
    accessUrl: accessUrl ?? '',
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
    gatewayUrl: gatewayUrl ?? '',
    dataUrl,
    adminToken: credentialOf(env, 'CONSOLE_ADMIN_TOKEN', problems, production),
    tenantAdminTokens: tenantTokensOf(env, problems, production),
    accessContextToken: credentialOf(env, 'CONSOLE_ACCESS_CONTEXT_TOKEN', problems, production),
    routeId,
    sessionSecret: sessionSecret ?? '',
    sessionTtlMs: integerOf(env, 'CONSOLE_SESSION_TTL_MS', 8 * hour, problems, {
      min: 60_000,
      max: 30 * 24 * hour,
    }),
    sessionMaxAgeMs: integerOf(env, 'CONSOLE_SESSION_MAX_AGE_MS', 24 * hour, problems, {
      min: 60_000,
      max: 90 * 24 * hour,
    }),
    probeTimeoutMs: integerOf(env, 'CONSOLE_PROBE_TIMEOUT_MS', 2000, problems, {
      min: 100,
      max: 60_000,
    }),
    requestTimeoutMs: integerOf(env, 'CONSOLE_REQUEST_TIMEOUT_MS', 10_000, problems, {
      min: 100,
      max: 120_000,
    }),
    logLevel,
    cookieSecure: false,
  }

  const secure = readValue(env, 'CONSOLE_COOKIE_SECURE')
  if (secure !== undefined && secure !== 'true' && secure !== 'false') {
    problems.push('CONSOLE_COOKIE_SECURE is neither true nor false')
  }
  config.cookieSecure =
    secure === undefined ? config.publicUrl.protocol === 'https:' : secure === 'true'

  // A production console that sends its cookies in the clear sends the
  // session of an operator in the clear.
  if (config.environment === 'production' && !config.cookieSecure) {
    if (config.publicUrl.protocol !== 'https:' && secure !== 'false') {
      problems.push(
        'CONSOLE_PUBLIC_URL is not https in production: set CONSOLE_COOKIE_SECURE=false to accept it'
      )
    }
  }

  if (problems.length > 0) throw new ConfigError(problems)
  return config
}
