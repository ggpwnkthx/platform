import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as say from '@clack/prompts'
import { ROOT, siteFiles } from '../site.ts'
import { settings, type Answers, type Target } from './pieces.ts'

export const ENV_FILE = join(ROOT, '.env')
export type { Answers, Target }

export const readEnv = (file = ENV_FILE): Answers =>
  existsSync(file)
    ? Object.fromEntries(
        [...readFileSync(file, 'utf8').matchAll(/^([A-Z_][A-Z0-9_]*)=(.*)$/gm)].map((m) => [
          m[1]!,
          m[2]!.replace(/^"(.*)"$/, '$1'),
        ])
      )
    : {}
const examples = () =>
  readdirSync(join(ROOT, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && siteFiles(join(ROOT, 'examples', entry.name)))
    .map((entry) => `examples/${entry.name}`)

/** The settings of a deployment: what is given, then the environment, then .env. A first run asks for the rest and writes it down. */
export async function ensureSettings(
  target: Target,
  given: Answers = {},
  env: Answers = process.env as Answers,
  file = ENV_FILE
): Promise<Answers> {
  const saved = readEnv(file)
  const first = !existsSync(file) && process.stdin.isTTY && process.stderr.isTTY
  const answers: Answers = { ...saved }
  for (const setting of settings.filter((s) => s.on.includes(target))) {
    let value = given[setting.name] ?? env[setting.name] ?? saved[setting.name]
    const fallback =
      typeof setting.fallback === 'function' ? setting.fallback(answers) : setting.fallback
    const valid = (text: string) => setting.check?.safeParse(text).error?.issues[0]?.message
    if (setting.ownSite && answers.PLATFORM_PUBLIC_URL) continue
    if (value === undefined && setting.secret)
      value = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')
    if (value === undefined && first && setting.question) {
      const hint = setting.name === 'PLATFORM_SITE' ? ` (${examples().join(', ')})` : ''
      const asked = await say.text({
        message: setting.question + hint,
        initialValue: fallback,
        validate: (text) => valid(text ?? ''),
      })
      if (say.isCancel(asked)) throw new Error('Cancelled')
      value = asked ?? ''
    }
    value ??= fallback
    if (value === undefined)
      throw new Error(`${setting.name} is required: ${setting.question ?? 'set it in .env'}`)
    const problem = valid(value)
    if (problem) throw new Error(`${setting.name}=${value}: ${problem}`)
    answers[setting.name] = value
  }
  // The file holds secrets: it is written for its owner alone, and kept out of git.
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

/** The addresses that follow from the pieces: each service answers on its own sub-domain. */
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
/** Where the local stack's PostgreSQL answers, for the database commands. */
export function localDatabase(): Answers {
  const a = {
    PLATFORM_DOMAIN: 'localhost',
    PLATFORM_DB_HOST: 'db',
    POSTGRES_PORT: '5432',
    ...readEnv(),
  }
  const loopback = a.PLATFORM_DOMAIN === 'localhost'
  return {
    DATABASE_HOST: loopback ? '127.0.0.1' : `${a.PLATFORM_DB_HOST}.${a.PLATFORM_DOMAIN}`,
    DATABASE_PORT: a.POSTGRES_PORT,
    DATABASE_NAME: 'platform',
    DATABASE_SSL: 'disable',
  }
}
