import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import type { DeployRuntime } from './types.ts'

/** The value a dotenv file gives a name; the last assignment wins, as it does for Compose. */
export function saved(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined
  const value = parse(readFileSync(file, 'utf8'))[name]
  return value || undefined
}
/** Appends a value to the saved file, which is private to its owner. */
function save(name: string, value: string, r: DeployRuntime) {
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
