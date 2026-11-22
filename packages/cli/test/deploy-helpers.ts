import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeployRuntime } from '../src/deployment/index.ts'

/**
 * The world the deployment's own tests are written against: a runtime that does nothing but
 * record what it was asked to do, and the settings a deployment is given.
 */

type Call = { argv: string[]; options?: Parameters<DeployRuntime['run']>[1] }
export function fake(
  env: Record<string, string | undefined> = {},
  answers: Record<string, string> = {},
  interactive = false
) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'platform-env-')), '.env')
  const calls: Call[] = []
  const output: string[] = []
  const notes: string[] = []
  const urls: string[] = []
  const asked: string[] = []
  const hosts: string[] = []
  const r: DeployRuntime = {
    env,
    envFile,
    which: (name) => name,
    print: (text) => {
      output.push(text)
    },
    run: async (argv, options) => {
      calls.push({ argv, options })
      return 0
    },
    // One after the other, through whatever `run` is at the time: a test may replace it.
    together: async (_task, jobs, options) => {
      for (const job of jobs) {
        const code = await r.run(job.argv, options)
        if (code) return code
      }
      return 0
    },
    sleep: async () => undefined,
    healthy: async (url) => {
      urls.push(url)
      return true
    },
    hash: async (password) => `hash-of(${password})`,
    interactive,
    hosts: async (names: string[]) => {
      hosts.push(...names)
    },
    note: (text) => {
      notes.push(text)
    },
    ask: async (name, _question, fallback) => {
      asked.push(name)
      return answers[name] ?? fallback
    },
    choose: async (name, _question, _choices, fallback) => {
      asked.push(name)
      return answers[name] ?? fallback
    },
    confirm: async (name, _question, fallback = false) => {
      asked.push(name)
      return answers[name] === undefined ? fallback : /^y(es)?$/i.test(answers[name])
    },
    begin: (title) => {
      notes.push(title)
    },
    show: (title, lines) => {
      notes.push(`Configuration: ${title}\n${lines}`)
    },
    waiting: () => ({ done: () => undefined, fail: () => undefined }),
    done: () => undefined,
    result: (title, rows, next) => {
      output.push([title, ...rows.map(([name, value]) => `${name}: ${value}`), ...next].join('\n'))
    },
  }
  return { r, calls, output, notes, urls, envFile, asked, hosts }
}
export const settings = {
  image: 'registry.example.com/platform:2.0.0',
  publicUrl: 'https://platform.example.com',
  oidcIssuer: 'https://sso.example.com/dex',
  databaseHost: 'db.internal',
  databaseName: 'platform',
  databasePort: '5432',
}
export const kenv = {
  PLATFORM_DOMAIN: 'platform.example.com',
  PLATFORM_IDP_HOST: 'idp',
  PLATFORM_API_HOST: 'api',
  PLATFORM_DB_HOST: 'db',
  PLATFORM_IMAGE: settings.image,
  PUBLIC_URL: settings.publicUrl,
  OIDC_ISSUER: settings.oidcIssuer,
  DATABASE_HOST: settings.databaseHost,
  DATABASE_NAME: 'platform',
  DATABASE_PORT: '5432',
}
