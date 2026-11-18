/** How the deploy commands reach the outside world: processes, files and time. */
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The repository's root: the deployments, the migrations and the packages live there.
export const ROOT = resolve(import.meta.dir, '../../../..')

export type RunOptions = {
  env?: Record<string, string | undefined>
  quiet?: boolean
  input?: string
}
export type DeployRuntime = {
  run(argv: string[], options?: RunOptions): Promise<number>
  which(name: string): string | null
  env: Record<string, string | undefined>
  /** Where generated values are kept, so that later runs find the same ones. */
  envFile: string
  print(text: string): void
  sleep(ms: number): Promise<void>
  healthy(url: string): Promise<boolean>
  /** A bcrypt hash, the form Dex keeps a local password in. */
  hash(password: string): Promise<string>
}
export const runtime: DeployRuntime = {
  async run(argv, options = {}) {
    const child = Bun.spawn(argv, {
      cwd: ROOT,
      env: options.env ?? process.env,
      stdin: options.input === undefined ? 'inherit' : new Blob([options.input]),
      stdout: options.quiet ? 'ignore' : 'inherit',
      stderr: options.quiet ? 'ignore' : 'inherit',
    })
    return child.exited
  },
  which: Bun.which,
  env: process.env,
  envFile: join(ROOT, '.env'),
  print: console.log,
  sleep: async (ms) => {
    await Bun.sleep(ms)
  },
  healthy: async (url) =>
    fetch(url, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false
    ),
  hash: (password) => Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 }),
}
export function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const at = args.findIndex((a) => a === `--${name}` || a.startsWith(prefix))
  if (at < 0) return undefined
  const arg = args.splice(at, 1)[0]!
  const value = arg.startsWith(prefix) ? arg.slice(prefix.length) : args.splice(at, 1)[0]
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  if (args.some((a) => a === `--${name}` || a.startsWith(prefix)))
    throw new Error(`Repeated --${name}`)
  return value
}
export function seconds(value: string | undefined): number {
  const n = Number(value ?? 120)
  if (!Number.isInteger(n) || n < 1 || n > 1800) throw new Error('--timeout must be 1–1800 seconds')
  return n
}
export function noExtra(args: string[]) {
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(' ')}`)
}

/** The value a dotenv file gives a name; the last assignment wins, as it does for Compose. */
export function saved(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined
  let value: string | undefined
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m?.[1] === name) value = m[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
  return value || undefined
}
/** Appends a value to the saved file, which is private to its owner. */
export function save(name: string, value: string, r: DeployRuntime) {
  const text = existsSync(r.envFile) ? readFileSync(r.envFile, 'utf8') : ''
  appendFileSync(r.envFile, `${text && !text.endsWith('\n') ? '\n' : ''}${name}=${value}\n`, {
    mode: 0o600,
  })
}
/** A required value nobody supplied is generated once and saved, never printed. */
export function generate(name: string, r: DeployRuntime): string {
  const value = randomBytes(24).toString('base64url')
  save(name, value, r)
  r.print(`Generated ${name} and saved it in ${r.envFile}.`)
  return value
}
