import { PGlite } from '@electric-sql/pglite'
import {
  type Field,
  PgError,
  parseValue,
  type Result,
  serialize,
} from '@platform/pg-client/wire.ts'
import type { RuntimeConfig } from '@platform/ui/config.ts'
import type { Credentials, Db, WithoutIssuer } from '@platform/ui/pg/connect.ts'
import type pg from 'pg'
import { applyExample, type Example } from '../../packages/cli/src/example.ts'
import { MIGRATIONS } from '../../packages/cli/src/migrations.ts'
import demo from './demo.sql' with { type: 'text' }
import migration from './migration.sql' with { type: 'text' }
import models from './models.json'

/**
 * The newsroom's one module: what the example is, how it is installed in a PostgreSQL that
 * runs in this process, and the database a development build puts in the interface's seam.
 *
 * The first half is the installation, and the tests ask their questions of it. The second
 * half is the page's: `platform.json` names this module as the database, and the build
 * replaces the interface's own connection with `connect` and `withoutIssuer` below.
 *
 * The example is installed as a deployment installs it. The platform's own installation
 * scripts, the ones `migrate` runs and in their order, then the example's three files through
 * the operator's own tools: `models.json` for the schema, `migration.sql` for what a manifest
 * cannot say, `demo.sql` for the records and their history.
 */
export const example: Example = { models, migration, demo }

/**
 * The operator's tools speak to a pg client; this PostgreSQL answers the same statements.
 *
 * A statement with no values may be several, as a script is, and is run as one. Booleans and
 * integers are read as what they are, however the database itself was opened: the tools ask
 * whether a role is a member, and `'f'` is not no.
 */
export function client(db: PGlite): pg.Client {
  const parsers = {
    16: (value: string) => value === 't',
    21: Number,
    23: Number,
  }
  return {
    query: async (statement: string, values?: unknown[]) => {
      if (values === undefined) {
        const results = await db.exec(statement, { parsers })
        const last = results.at(-1)
        return { rows: last?.rows ?? [], rowCount: last?.rows.length || last?.affectedRows || 0 }
      }
      const result = await db.query(statement, values, { parsers })
      return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 }
    },
  } as unknown as pg.Client
}

/**
 * A short name for a set of texts: the same texts give the same name, and a change to any of
 * them gives another. It tells one installation from the next, and keeps nothing secret.
 */
export function fingerprintOf(texts: string[]): string {
  let high = 0xdeadbeef
  let low = 0x41c6ce57
  for (const text of texts) {
    // The length goes in first, so that where one text ends and the next begins is said.
    for (const code of [text.length, ...Array.from(text, (c) => c.charCodeAt(0))]) {
      high = Math.imul(high ^ code, 2654435761)
      low = Math.imul(low ^ code, 1597334677)
    }
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909)
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909)
  return (4294967296 * (2097151 & low) + (high >>> 0)).toString(36)
}

/**
 * What this installation is made from, as a name: the platform's scripts and the example's
 * three files. A database kept from an earlier build is known to be of another making by it.
 */
export const fingerprint = fingerprintOf([
  ...MIGRATIONS.map((script) => script.sql),
  JSON.stringify(models),
  migration,
  demo,
])

/** Installs the platform alone: every installation script, in order. */
export async function installPlatform(db: PGlite): Promise<void> {
  for (const script of MIGRATIONS) await db.exec(script.sql)
}

/** Installs the platform and the newsroom. The newsroom is all there, or none of it is. */
export async function install(db: PGlite): Promise<void> {
  await installPlatform(db)
  const q = client(db)
  await q.query('BEGIN')
  try {
    await applyExample(q, example)
    await q.query('COMMIT')
  } catch (error) {
    await q.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

// The dev mode's database: PostgreSQL 18, compiled to WebAssembly, running inside the page,
// installed as above. Every statement the interface writes runs against the real thing:
// grants, row policies, triggers and revisions included.
//
// It is kept in the browser's IndexedDB, so it survives a reload, until the files it was
// installed from change: then it is installed again, and what was written in the page is
// gone. Signing in as somebody else reloads the page: this PostgreSQL logs one person in per
// page, exactly as it would log in one token. It never reaches a production build: the build
// swaps it in for the relay.

/**
 * Where the in-page database is kept, between reloads. The name says what it was installed
 * from: a build whose installation scripts or example files have changed looks under another
 * name, finds nothing, and installs again. Nobody has to remember to say the files changed.
 */
const storagePrefix = 'platform-dev-'
const storageKey = `${storagePrefix}${fingerprint}`

/**
 * Forgets the databases of earlier builds: they would never be opened again. A browser that
 * cannot list its databases keeps them, and so does one that refuses: it is tidying, and
 * the page does not wait for it.
 */
async function forgetEarlier(): Promise<void> {
  try {
    for (const { name } of await indexedDB.databases())
      if (name?.includes(`/${storagePrefix}`) && !name.endsWith(`/${storageKey}`))
        indexedDB.deleteDatabase(name)
  } catch {
    // Kept, then.
  }
}

/**
 * Signing in without an issuer: the example people, who choose themselves in the page.
 *
 * The choice is kept in the page's own storage, so that a reload is the same person, and it
 * is the example that says so: the interface only asks who may sign in, and how.
 */
export const withoutIssuer: WithoutIssuer = {
  people: [
    {
      role: 'admin@example.com',
      note: 'Owns the newsroom workspace, administers roles',
      token: 'in-page',
    },
    { role: 'alice@example.com', note: 'Newsroom reader and writer', token: 'in-page' },
    {
      role: 'bob@example.com',
      note: 'Newsroom writer and member of sales, which owns crm',
      token: 'in-page',
    },
  ],
  notice:
    'PostgreSQL runs inside this page, with the example workspaces installed. Choose who to be.',
  starting: 'Starting PostgreSQL in the page',
  chosen: () => sessionStorage.getItem('platform.dev.as'),
  choose: (role) => sessionStorage.setItem('platform.dev.as', role),
  forget: () => sessionStorage.removeItem('platform.dev.as'),
}

let booted: { role: string; db: Promise<PGlite> } | null = null

async function asset(path: string): Promise<Response> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`The in-page database could not load ${path}`)
  return response
}

async function start(role: string): Promise<PGlite> {
  const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
    asset('/dev/pglite.wasm').then((r) => WebAssembly.compileStreaming(r)),
    asset('/dev/initdb.wasm').then((r) => WebAssembly.compileStreaming(r)),
    asset('/dev/pglite.data').then((r) => r.blob()),
  ])
  // Every value arrives as PostgreSQL wrote it, and is read by the same rules as the relay's.
  const parsers: Record<number, (text: string) => unknown> = {}
  for (const oid of [
    16, 20, 21, 23, 26, 114, 700, 701, 1082, 1083, 1114, 1184, 1266, 1700, 3802, 1000, 1003, 1005,
    1007, 1009, 1015, 1016, 1021, 1022, 1028, 1115, 1182, 1185, 1231, 2951,
  ])
    parsers[oid] = (text) => text
  const options = { pgliteWasmModule, initdbWasmModule, fsBundle, parsers }
  let db: PGlite
  try {
    db = await PGlite.create(`idb://${storageKey}`, options)
    void forgetEarlier()
  } catch {
    db = await PGlite.create(options)
  }
  // Booleans arrive as PostgreSQL wrote them ('t' or 'f'): the parsers above leave them as text.
  const installed = await db
    .query<{ found: string }>(`SELECT to_regclass('platform.installation') IS NOT NULL AS found`)
    .then((r) => r.rows[0]?.found === 't')
  if (!installed) await install(db)
  // From here on this page is one person, as a login is one token.
  await db.query(`SET SESSION AUTHORIZATION ${JSON.stringify(role)}`)
  return db
}

function commandOf(text: string): string {
  const words = text
    .replace(/--[^\n]*\n/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.toUpperCase())
  if (['CREATE', 'ALTER', 'DROP'].includes(words[0] ?? '')) return words.slice(0, 2).join(' ')
  return words[0] ?? ''
}

function asPgError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error))
  const found = error as Error & Record<string, unknown>
  if (typeof found.code !== 'string') return error
  const fields = new Map<string, string>([
    ['M', found.message],
    ['C', found.code],
    ['S', String(found.severity ?? 'ERROR')],
  ])
  for (const [key, name] of [
    ['D', 'detail'],
    ['H', 'hint'],
    ['P', 'position'],
    ['s', 'schema'],
    ['t', 'table'],
    ['c', 'column'],
    ['n', 'constraint'],
  ] as const)
    if (found[name] !== undefined && found[name] !== null) fields.set(key, String(found[name]))
  return new PgError(fields)
}

export async function connect(_config: RuntimeConfig, who: Credentials): Promise<Db> {
  if (booted && booted.role !== who.role) {
    // One person per page: becoming somebody else is a new page.
    withoutIssuer.choose(who.role)
    location.reload()
    await new Promise(() => undefined)
  }
  booted ??= { role: who.role, db: start(who.role) }
  const db = await booted.db
  return {
    async query<Row>(text: string, params: unknown[] = []): Promise<Result<Row>> {
      try {
        const result = await db.query<Record<string, unknown>>(text, params.map(serialize))
        const fields: Field[] = result.fields.map((f) => ({
          name: f.name,
          type: f.dataTypeID,
          table: 0,
          column: 0,
        }))
        const rows = result.rows.map((row) => {
          const out: Record<string, unknown> = {}
          for (const field of fields) {
            const value = row[field.name]
            out[field.name] =
              typeof value === 'string' ? parseValue(field.type, value) : (value ?? null)
          }
          return out
        })
        const command = commandOf(text)
        return {
          fields,
          rows: rows as Row[],
          command,
          affected: command === 'SELECT' ? rows.length : (result.affectedRows ?? null),
        }
      } catch (error) {
        throw asPgError(error)
      }
    },
    close() {
      // The in-page database outlives a request; the next one logs in as the same person.
    },
    isClosed: false,
  }
}
