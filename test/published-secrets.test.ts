import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CREDENTIAL_VARIABLES as ACCESS_CREDENTIALS,
  readEnv as readAccessEnv,
} from '../packages/access/src/runtime/env'
import {
  CREDENTIAL_VARIABLES as CONSOLE_CREDENTIALS,
  readConfig as readConsoleEnv,
} from '../packages/console/src/runtime/config'
import {
  CREDENTIAL_VARIABLES as DATA_CREDENTIALS,
  isPublishedSecret as isPublishedDataSecret,
  readEnv as readDataEnv,
} from '../packages/data/src/runtime/config'
import {
  CREDENTIAL_VARIABLES as GATEWAY_CREDENTIALS,
  readEnv as readGatewayEnv,
} from '../packages/gateway/src/runtime/env'
import { parseControlTokens } from '../packages/gateway/src/domains/control'

/**
 * The published credentials of the repository.
 *
 * The repository publishes the credentials of its examples: they are in
 * the files of the examples, in the minimum environment of the root and
 * in the fixtures of the development machine. A deployment that keeps one
 * of them holds a credential that everybody knows.
 *
 * The rule of the platform is that a service refuses a published value in
 * a production environment. This test is the proof of the rule: it reads
 * the published files of the repository and asks every service to refuse
 * every value it publishes. A value that is published and that no service
 * refuses is a value a deployment may start with, and the test fails.
 *
 * The variables that carry a credential are the vocabulary of each
 * service: a service that reads a new credential names it in its list,
 * and a published value of a variable that no service names is a value
 * nobody refuses.
 */

const root = resolve(import.meta.dir, '..')

/** The files of the repository that publish a credential. */
const PUBLISHED_FILES = [
  '.env.min',
  'packages/gateway/.env.example',
  'packages/access/.env.example',
  'packages/data/.env.example',
  'packages/console/.env.example',
]

/**
 * The name of a variable that looks like a credential.
 *
 * A number of milliseconds is not a credential, whatever the word
 * `token` carries in its name.
 */
function looksLikeCredential(name: string): boolean {
  if (name.endsWith('_MS')) return false
  // A switch is not a credential: it says whether the deployment allows
  // something, and it holds no secret.
  if (name.includes('ALLOW_')) return false
  return /(SECRET|TOKEN|PASSWORD|CREDENTIAL)/.test(name)
}

/** The credentials of the database of the deployment, not of a service. */
const DEPLOYMENT_CREDENTIALS = ['POSTGRES_PASSWORD', 'ACCESS_APP_PASSWORD']

/** A value that is a placeholder and not a credential. */
function isPlaceholder(value: string): boolean {
  if (value.length === 0) return true
  if (value.startsWith('REPLACE_WITH')) return true
  // A path is the name of a file, not the secret it holds.
  if (value.includes('/')) return true
  return false
}

/** The variables of a file of the repository, as they are published. */
function variablesOf(file: string): [string, string][] {
  const content = readFileSync(join(root, file), 'utf8')
  const variables: [string, string][] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const name = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    variables.push([name, value])
  }
  return variables
}

/** A secret of a deployment that is strong and that the repository does not publish. */
const STRONG = 'a-strong-secret-of-the-deployment-0001'

/** The environment of a production gateway. */
const GATEWAY: Record<string, string> = {
  NODE_ENV: 'production',
  GATEWAY_SESSION_SECRET: STRONG,
  GATEWAY_IDENTITY_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
  GATEWAY_OIDC_ISSUER: 'https://dex.example.com/dex',
  GATEWAY_OIDC_CLIENT_ID: 'gateway',
  GATEWAY_OIDC_CLIENT_SECRET: STRONG,
  GATEWAY_OIDC_REDIRECT_URI: 'https://gateway.example.com/auth/callback',
  GATEWAY_ACCESS_URL: 'https://access.example.com',
  GATEWAY_ACCESS_TOKEN: STRONG,
  GATEWAY_RATE_LIMIT_MAX: '600',
  GATEWAY_SESSION_URL: 'redis://cache:6379/0',
}

/** The environment of a production Access. */
const ACCESS: Record<string, string> = {
  ACCESS_ENVIRONMENT: 'production',
  ACCESS_DATABASE_URL: 'postgres://access:access@localhost:5432/access',
  ACCESS_REDIS_URL: 'redis://localhost:6379/0',
  ACCESS_ISSUER: 'https://access.example.com',
  ACCESS_ADMIN_TOKEN: STRONG,
  ACCESS_DECISION_TOKEN: STRONG,
  ACCESS_STATE_SECRET: '4f9a2c8e'.repeat(8),
  ACCESS_SECRET_ENCRYPTION_KEY: 'b31e7d09'.repeat(8),
  ACCESS_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
  ACCESS_SIGNING_KID: 'access-1',
}

/** The environment of a production console. */
const CONSOLE: Record<string, string> = {
  CONSOLE_ENVIRONMENT: 'production',
  CONSOLE_PUBLIC_URL: 'https://console.example.com',
  CONSOLE_ACCESS_URL: 'http://access.internal:8081/',
  CONSOLE_GATEWAY_URL: 'http://api.gateway.test:8080',
  CONSOLE_CLIENT_ID: 'platform',
  CONSOLE_CLIENT_SECRET: STRONG,
  CONSOLE_SESSION_SECRET: 'a-session-secret-that-is-long-enough-0001',
}

/** The environment of a production Data. */
function dataEnvironment(): Record<string, string> {
  return {
    DATA_ENVIRONMENT: 'production',
    DATA_PROCESS_ROLE: 'api',
    DATA_DATABASE_URL: 'postgres://data@localhost:5432/data',
    DATA_REGISTRY_DATABASE_URL: 'postgres://registry@localhost:5432/data',
    DATA_SCHEMA_BUNDLE_FILE: '/app/schema.json',
    DATA_POLICY_BUNDLE_FILE: '/app/policies.json',
    DATA_GATEWAY_BINDINGS_FILE: '/app/bindings.json',
    DATA_ACCESS_URL: 'https://access.example.com',
    DATA_ACCESS_CONTEXT_TOKEN_FILE: '/app/secrets/access-context.token',
    DATA_CURSOR_KEY_FILE: '/app/secrets/cursor.key',
  }
}

/** The service that reads a variable, from the name of the variable. */
type Service = 'gateway' | 'access' | 'data' | 'console'

/** The vocabulary of the credentials of every service. */
const CREDENTIALS: Record<Service, readonly string[]> = {
  gateway: GATEWAY_CREDENTIALS,
  access: ACCESS_CREDENTIALS,
  data: DATA_CREDENTIALS,
  console: CONSOLE_CREDENTIALS,
}

/** The service that reads a variable, from the name of the variable. */
function serviceOf(name: string): Service | null {
  if (name.startsWith('GATEWAY_')) return 'gateway'
  if (name.startsWith('ACCESS_')) return 'access'
  if (name.startsWith('DATA_')) return 'data'
  if (name.startsWith('CONSOLE_')) return 'console'
  return null
}

/** The environment of a production service, without the value under test. */
function environmentOf(service: Service): Record<string, string> {
  switch (service) {
    case 'gateway':
      return { ...GATEWAY }
    case 'access':
      return { ...ACCESS }
    case 'data':
      return dataEnvironment()
    case 'console':
      return { ...CONSOLE }
  }
}

/** The reader of the environment of a service. */
function readerOf(service: Service): (env: Record<string, string>) => unknown {
  switch (service) {
    case 'gateway':
      return (env) => readGatewayEnv(env)
    case 'access':
      return (env) => readAccessEnv(env)
    case 'data':
      return (env) => readDataEnv(env)
    case 'console':
      return (env) => readConsoleEnv(env)
  }
}

describe('the published credentials of the repository', () => {
  test('every service refuses the values that the repository publishes', () => {
    const problems: string[] = []
    for (const file of PUBLISHED_FILES) {
      for (const [name, value] of variablesOf(file)) {
        if (isPlaceholder(value)) continue
        // The credentials of the database of the deployment are the
        // business of the stack and of the provisioning of the roles,
        // not of a service.
        if (DEPLOYMENT_CREDENTIALS.includes(name)) continue
        const service = serviceOf(name)
        if (!service) {
          if (looksLikeCredential(name)) {
            problems.push(`${name} of ${file} carries a credential and no service names it`)
          }
          continue
        }
        if (!CREDENTIALS[service].includes(name)) {
          // A variable that looks like a credential and that the service
          // does not name is a credential nobody refuses.
          if (looksLikeCredential(name)) {
            problems.push(`${name} of ${file} carries a credential and ${service} does not name it`)
          }
          continue
        }
        // The passwords of the roles of the database are refused by the
        // provisioning of the roles: the service never reads them.
        if (name.endsWith('_PASSWORD') && service === 'data') {
          if (!isPublishedDataSecret(value)) {
            problems.push(`${name} of ${file} is published and the provisioning does not refuse it`)
          }
          continue
        }
        const environment = environmentOf(service)
        environment[name] = value
        let message = ''
        try {
          readerOf(service)(environment)
        } catch (error) {
          message = error instanceof Error ? error.message : String(error)
        }
        if (message.length === 0) {
          problems.push(`${name} of ${file} is published and ${service} starts with it`)
          continue
        }
        if (!message.includes(name)) {
          problems.push(`${name} of ${file} is refused for another reason: ${message}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  test('the passwords of the database of the deployment are refused by the stack', () => {
    const stack = readFileSync(
      join(root, 'deploy/compose/production/platform.compose.yaml'),
      'utf8'
    )
    // The stack of the deployment refuses the passwords that the
    // repository publishes: a role whose password everybody knows is a
    // role that everybody may read.
    expect(/"\$\{POSTGRES_PASSWORD\}" = "platform"/.test(stack)).toBe(true)
    expect(/"\$\{ACCESS_APP_PASSWORD\}" = "access_app"/.test(stack)).toBe(true)
  })

  test('the control plane refuses the token of the example in production', () => {
    const map = readFileSync(join(root, 'deploy/config/control-tokens.example.json'), 'utf8')
    const tokens = Object.keys(JSON.parse(map) as Record<string, unknown>)
    expect(tokens.length).toBeGreaterThan(0)
    expect(() => parseControlTokens(map, { production: true })).toThrow(
      /is the value of the example of the repository/
    )
    // A development machine may use the map of the example.
    expect(parseControlTokens(map).size).toBe(tokens.length)
  })

  test('the fixtures of the development machine are refused by Data', () => {
    const fixtures = join(root, 'deploy/fixtures/secrets')
    // The credential of the access context and the key of the cursors are
    // published: a deployment that mounts them holds a credential that
    // everybody knows.
    expect(
      isPublishedDataSecret(readFileSync(join(fixtures, 'access-context.token'), 'utf8').trim())
    ).toBe(true)
    expect(isPublishedDataSecret(readFileSync(join(fixtures, 'cursor.key'), 'utf8').trim())).toBe(
      true
    )
  })
})
