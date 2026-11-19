/**
 * The interface's configuration: how the site is built, which database it talks to, and
 * what the site adds to it.
 *
 * The file is `platform.json`, in the working directory or in the directory the caller
 * names. It is optional: without one, the interface is built as it is published — the real
 * one, with the relay and the issuer.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The name of the file a directory's configuration is written in. */
export const CONFIG_FILE = 'platform.json'

/** The name of the file a directory's site says its name in. */
export const SITE_CONFIG_FILE = 'config.json'

/** What a directory says about the interface it holds. */
export interface InterfaceConfig {
  /** The directory the configuration was found in. */
  dir: string
  /** How the site is built. */
  mode: 'development' | 'production'
  /** The module that is the database in development mode, relative to the directory. */
  database?: string
  /** The module that holds the site's own field types and renderers, relative to the directory. */
  extensions?: string
  /** Where the site is written, relative to the directory. */
  out?: string
}

/**
 * The configuration in a directory, if it has one.
 *
 * A development build names the module that is the database: the interface's own seam is
 * replaced by it, so that the pages and the bundle talk to the same PostgreSQL. A build of
 * either mode may name the module that holds the site's own field types and renderers.
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
  const extensions = raw.extensions === undefined ? undefined : String(raw.extensions)
  if (extensions !== undefined && !existsSync(resolve(dir, extensions)))
    throw new Error(`${file}: there is no module at ${extensions} to be the site's extensions.`)
  const out = raw.out === undefined ? undefined : String(raw.out)
  return {
    dir: resolve(dir),
    mode: mode as 'development' | 'production',
    database,
    extensions,
    out,
  }
}

/** The module a development build uses as the database, in full. */
export function databaseModule(config: InterfaceConfig): string {
  if (!config.database)
    throw new Error('A development build needs the module that is the database.')
  return resolve(config.dir, config.database)
}

/** The module that holds the site's own field types and renderers, in full, if it has one. */
export function extensionsModule(config: InterfaceConfig | null): string | null {
  return config?.extensions ? resolve(config.dir, config.extensions) : null
}

/**
 * What a site says about itself: the issuer it signs in against, the relay it reaches
 * PostgreSQL through, and the database it is installed in.
 *
 * It is the file the page reads at runtime, and it belongs to the site rather than to the
 * interface: a deployment names its own issuer and relay, an example names the local stack
 * it works against, and the interface itself says nothing — it takes what it is given.
 */
export function findSiteConfig(dir: string): Record<string, unknown> | null {
  const file = join(dir, SITE_CONFIG_FILE)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
}
