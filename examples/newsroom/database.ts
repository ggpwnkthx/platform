import { PGlite } from '@electric-sql/pglite'
import type { RuntimeConfig } from '@platform/ui/config.ts'
import type { Credentials, Db, WithoutIssuer } from '@platform/ui/pg/connect.ts'
import { type Field, PgError, parseValue, type Result, serialize } from '@platform/ui/pg/wire.ts'
import migration1 from '../../migrations/0001_native.sql' with { type: 'text' }
import migration2 from '../../migrations/0002_harden_catalogs.sql' with { type: 'text' }
import migration3 from '../../migrations/0003_metadata.sql' with { type: 'text' }
import migration4 from '../../migrations/0004_field_metadata.sql' with { type: 'text' }
import seed from './seed.sql' with { type: 'text' }

/**
 * The dev mode's database: PostgreSQL 18, compiled to WebAssembly, running inside the
 * page. It is installed with the platform's own migrations and seeded with the example
 * workspaces, so every statement the interface writes runs against the real thing: grants,
 * row policies, triggers and revisions included.
 *
 * It is kept in the browser's IndexedDB, so it survives a reload. Signing in as somebody else
 * reloads the page: this PostgreSQL logs one person in per page, exactly as it would log in
 * one token. It never reaches a production build: the build swaps it in for the relay.
 */

/** Where the in-page database is kept, between reloads. */
const storageKey = 'platform-dev-v2'

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
  notice: 'PostgreSQL runs inside this page, seeded with the example workspaces. Choose who to be.',
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
  } catch {
    db = await PGlite.create(options)
  }
  // Booleans arrive as PostgreSQL wrote them ('t' or 'f'): the parsers above leave them as text.
  const installed = await db
    .query<{ found: string }>(`SELECT to_regclass('platform.installation') IS NOT NULL AS found`)
    .then((r) => r.rows[0]?.found === 't')
  if (!installed) {
    for (const sql of [migration1, migration2, migration3, migration4, seed]) await db.exec(sql)
  }
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
