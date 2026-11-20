/**
 * What a folder says of itself: `platform.json`.
 *
 * The file is the folder's table of contents, and every tool reads the same one. `apply`
 * names what a database is brought to — the manifest, and the SQL beside it — and
 * `extensions` names the module that holds the site's own field types and renderers:
 *
 *   {
 *     "apply": {
 *       "models": "apply/models.json",
 *       "migration": "apply/migration.sql",
 *       "demo": "apply/demo.sql"
 *     },
 *     "extensions": "extensions.tsx"
 *   }
 *
 * It says what the folder is, and never where it runs: the issuer, the relay and the
 * database's name are the deployment's, and the deployment says them in its environment.
 * It is optional: without one, the interface is built as it is published.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Example } from './example.ts'

/** The name of the file a folder's configuration is written in. */
export const CONFIG_FILE = 'platform.json'

/** The files a folder applies to a database, each relative to the folder. */
export interface ApplyFiles {
  /** The schema, as a manifest. */
  models: string
  /** What a manifest cannot say, written to be run again. */
  migration?: string
  /** The records and the history they would have, written once. */
  demo?: string
}

/** What a folder says of itself. */
export interface FolderConfig {
  /** The folder the configuration was found in. */
  dir: string
  /** What the folder applies to a database: an example has this. */
  apply?: ApplyFiles
  /** The module that holds the site's own field types and renderers, relative to the folder. */
  extensions?: string
}

const SAYS = ['apply', 'extensions']
const APPLIES = ['models', 'migration', 'demo']

/** The configuration in a folder, if it has one. Every file it names is there. */
export function findConfig(dir: string): FolderConfig | null {
  const file = join(dir, CONFIG_FILE)
  if (!existsSync(file)) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  const unknown = Object.keys(raw).find((key) => !SAYS.includes(key))
  if (unknown)
    throw new Error(
      `${file}: ${unknown} is not something a folder says of itself. It says: ${SAYS.join(', ')}.`
    )
  const named = (value: unknown, what: string): string => {
    if (typeof value !== 'string' || !value) throw new Error(`${file}: ${what} names a file.`)
    if (!existsSync(resolve(dir, value)))
      throw new Error(`${file}: there is no file at ${value} to be ${what}.`)
    return value
  }
  let apply: ApplyFiles | undefined
  if (raw.apply !== undefined) {
    if (typeof raw.apply !== 'object' || raw.apply === null || Array.isArray(raw.apply))
      throw new Error(`${file}: apply names files: ${APPLIES.join(', ')}.`)
    const files = raw.apply as Record<string, unknown>
    const stray = Object.keys(files).find((key) => !APPLIES.includes(key))
    if (stray)
      throw new Error(
        `${file}: ${stray} is not something a folder applies. It applies: ${APPLIES.join(', ')}.`
      )
    if (files.models === undefined)
      throw new Error(`${file}: apply needs models, the manifest that is the schema.`)
    apply = { models: named(files.models, 'the models') }
    if (files.migration !== undefined) apply.migration = named(files.migration, 'the migration')
    if (files.demo !== undefined) apply.demo = named(files.demo, 'the demonstration')
  }
  const extensions =
    raw.extensions === undefined ? undefined : named(raw.extensions, "the site's extensions")
  return { dir: resolve(dir), apply, extensions }
}

/** The module that holds the site's own field types and renderers, in full, if it has one. */
export function extensionsModule(config: FolderConfig | null): string | null {
  return config?.extensions ? resolve(config.dir, config.extensions) : null
}

/** The files a folder applies, in full. */
export function applyFiles(config: FolderConfig): ApplyFiles {
  if (!config.apply)
    throw new Error(`${join(config.dir, CONFIG_FILE)} names nothing to apply: it has no apply.`)
  const full = (path: string | undefined) =>
    path === undefined ? undefined : resolve(config.dir, path)
  return {
    models: full(config.apply.models)!,
    migration: full(config.apply.migration),
    demo: full(config.apply.demo),
  }
}

/** The example a folder is: the files its configuration names, read. */
export function readExample(config: FolderConfig): Example {
  const files = applyFiles(config)
  const text = (path: string | undefined) =>
    path === undefined ? undefined : readFileSync(path, 'utf8')
  let models: unknown
  try {
    models = JSON.parse(readFileSync(files.models, 'utf8'))
  } catch (error) {
    throw new Error(`${files.models} is not valid JSON: ${(error as Error).message}`)
  }
  return { models, migration: text(files.migration), demo: text(files.demo) }
}
