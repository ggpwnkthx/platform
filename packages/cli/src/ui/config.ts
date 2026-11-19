/**
 * The interface's configuration: how the site is built, and which database it talks to.
 *
 * The file is `platform.json`, in the working directory or in the directory the caller
 * names. It is optional: without one, the interface is built as it is published — the real
 * one, with the relay and the issuer.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The name of the file a directory's configuration is written in. */
export const CONFIG_FILE = 'platform.json'

/** What a directory says about the interface it holds. */
export interface InterfaceConfig {
  /** The directory the configuration was found in. */
  dir: string
  /** How the site is built. */
  mode: 'development' | 'production'
  /** The module that is the database in development mode, relative to the directory. */
  database?: string
  /** Where the site is written, relative to the directory. */
  out?: string
}

/**
 * The configuration in a directory, if it has one.
 *
 * A development build names the module that is the database: the interface's own seam is
 * replaced by it, so that the pages and the bundle talk to the same PostgreSQL.
 */
export function findConfig(dir: string): InterfaceConfig | null {
  const file = join(dir, CONFIG_FILE)
  if (!existsSync(file)) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  const mode = String(raw.mode ?? 'production')
  if (!['development', 'production'].includes(mode))
    throw new Error(`${file}: mode must be "development" or "production".`)
  const database = raw.database === undefined ? undefined : String(raw.database)
  if (mode === 'development' && !database)
    throw new Error(`${file}: a development build needs the module that is the database.`)
  const out = raw.out === undefined ? undefined : String(raw.out)
  return { dir: resolve(dir), mode: mode as 'development' | 'production', database, out }
}

/** The module a development build uses as the database, in full. */
export function databaseModule(config: InterfaceConfig): string {
  if (!config.database)
    throw new Error('A development build needs the module that is the database.')
  return resolve(config.dir, config.database)
}
