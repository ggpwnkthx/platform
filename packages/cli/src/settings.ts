import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The settings of a deployment. A deployment is named by a domain, and each service answers
 * on its own sub-domain of it, so the addresses follow from a few names and are never asked
 * for. What is given wins, then the environment, then `.env`; what is settled is written to
 * `.env`, for its owner alone, with a secret made for the one account that has a password.
 */
export const ROOT = resolve(import.meta.dirname, '../../..')
export const ENV_FILE = join(ROOT, '.env')
export type Target = 'local' | 'k8s'
export type Answers = Record<string, string>

const name = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const domain = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/
const port = /^([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/
interface Setting {
  on: Target[]
  fallback?: string | ((answers: Answers) => string)
  check?: RegExp
  secret?: boolean
}
const both: Target[] = ['local', 'k8s']
const settings: Record<string, Setting> = {
  PLATFORM_DOMAIN: { on: both, fallback: 'localhost', check: domain },
  PLATFORM_IDP_HOST: { on: both, fallback: 'idp', check: name },
  PLATFORM_API_HOST: { on: both, fallback: 'api', check: name },
  PLATFORM_DB_HOST: { on: both, fallback: 'db', check: name },
  PLATFORM_APP_HOST: { on: both, fallback: 'app', check: name },
  // The site: one published elsewhere, by its address, or a folder this deployment builds and serves.
  PLATFORM_PUBLIC_URL: { on: both, fallback: '', check: /^(https?:\/\/\S+)?$/ },
  PLATFORM_SITE: { on: ['local'], fallback: '' },
  PLATFORM_IMAGE: { on: ['k8s'] },
  DATABASE_PORT: { on: ['k8s'], fallback: '5432', check: port },
  EDGE_PORT: { on: ['local'], fallback: '8080', check: port },
  EDGE_TLS_PORT: { on: ['local'], fallback: '4433', check: port },
  POSTGRES_PORT: { on: ['local'], fallback: '5432', check: port },
  DEX_PORT: { on: ['local'], fallback: '5556', check: port },
  RELAY_PORT: { on: ['local'], fallback: '8081', check: port },
  PLATFORM_ADMIN: {
    on: ['local'],
    fallback: (a) => `admin@${a.PLATFORM_DOMAIN}`,
    check: /^[^@\s]+@[^@\s]+$/,
  },
  PLATFORM_ADMIN_PASSWORD: { on: ['local'], secret: true },
}

export const readEnv = (file = ENV_FILE): Answers =>
  existsSync(file)
    ? Object.fromEntries(
        [...readFileSync(file, 'utf8').matchAll(/^([A-Z_][A-Z0-9_]*)=(.*)$/gm)].map((m) => [
          m[1]!,
          m[2]!.replace(/^"(.*)"$/, '$1'),
        ])
      )
    : {}

export function settle(
  target: Target,
  given: Answers = {},
  env: Answers = process.env as Answers,
  file = ENV_FILE
): Answers {
  const saved = readEnv(file)
  const answers: Answers = { ...saved }
  for (const [key, setting] of Object.entries(settings)) {
    if (!setting.on.includes(target)) continue
    const fallback =
      typeof setting.fallback === 'function' ? setting.fallback(answers) : setting.fallback
    const secret = () =>
      Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')
    const value = given[key] ?? env[key] ?? saved[key] ?? (setting.secret ? secret() : fallback)
    if (value === undefined)
      throw new Error(`${key} is required: set it in ${file}, or in the environment.`)
    if (setting.check && !setting.check.test(value))
      throw new Error(`${key}=${value} is not what ${key} may be.`)
    answers[key] = value
  }
  // The file holds a secret: it is written for its owner alone, and kept out of git.
  if (JSON.stringify(answers) !== JSON.stringify(saved)) {
    writeFileSync(
      file,
      `${Object.entries(answers)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n`,
      { mode: 0o600 }
    )
    chmodSync(file, 0o600)
  }
  return answers
}

/** The addresses that follow from the names: each service answers on its own sub-domain. */
export function addresses(target: Target, a: Answers) {
  const host = (sub: string) => `${a[sub]}.${a.PLATFORM_DOMAIN}`
  const [http, ws, edge] =
    target === 'local' ? ['http', 'ws', `:${a.EDGE_PORT}`] : ['https', 'wss', '']
  return {
    issuer: `${http}://${host('PLATFORM_IDP_HOST')}${edge}`,
    relay: `${ws}://${host('PLATFORM_API_HOST')}${edge}`,
    site: a.PLATFORM_PUBLIC_URL || `${http}://${host('PLATFORM_APP_HOST')}${edge}`,
    database: host('PLATFORM_DB_HOST'),
    siteFolder: a.PLATFORM_PUBLIC_URL || !a.PLATFORM_SITE ? null : resolve(ROOT, a.PLATFORM_SITE),
  }
}

/** The `--name=value` arguments a command takes, and the rest it passes on. */
export function flags(args: string[], known: string[]) {
  const values: Answers = {}
  const rest: string[] = []
  for (const arg of args) {
    const [, key, value] = /^--([\w-]+)=(.*)$/.exec(arg) ?? []
    if (key && known.includes(key)) values[key] = value!
    else rest.push(arg)
  }
  return { values, rest }
}
/** Runs a command of the operator's own machine — Compose, kubectl, vite — and says how it ended. */
export async function sh(
  argv: string[],
  options: { env?: Answers; quiet?: boolean; input?: string; cwd?: string } = {}
) {
  const child = Bun.spawn(argv, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? 'inherit' : new Blob([options.input]),
    stdout: options.quiet ? 'ignore' : 'inherit',
    stderr: options.quiet ? 'ignore' : 'inherit',
  })
  return child.exited
}
