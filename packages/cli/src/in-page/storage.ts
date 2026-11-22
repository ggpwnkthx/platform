import { PGlite } from '@electric-sql/pglite'
import type { Applied } from '../folder.ts'
import { install } from './install.ts'
import { sessionAuthorization } from './session.ts'

/** Where the in-page databases are kept, between reloads: every name begins with this. */
export const storagePrefix = 'platform-dev-'

/**
 * Forgets the databases of earlier builds: they would never be opened again. A browser that
 * cannot list its databases keeps them, and so does one that refuses: it is tidying, and
 * the page does not wait for it.
 */
async function forgetEarlier(storageKey: string): Promise<void> {
  try {
    for (const { name } of await indexedDB.databases())
      if (name?.includes(`/${storagePrefix}`) && !name.endsWith(`/${storageKey}`))
        indexedDB.deleteDatabase(name)
  } catch {
    // Kept, then.
  }
}

async function asset(path: string): Promise<Response> {
  // fallow-ignore-next-line security-sink -- the path is the page's own asset, not a request
  const response = await fetch(path)
  if (!response.ok) throw new Error(`The in-page database could not load ${path}`)
  return response
}

export async function start(applied: Applied, storageKey: string, role: string): Promise<PGlite> {
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
    void forgetEarlier(storageKey)
  } catch {
    db = await PGlite.create(options)
  }
  // Booleans arrive as PostgreSQL wrote them ('t' or 'f'): the parsers above leave them as text.
  const installed = await db
    .query<{ found: string }>(`SELECT to_regclass('platform.installation') IS NOT NULL AS found`)
    .then((r) => r.rows[0]?.found === 't')
  if (!installed) await install(db, applied)
  // From here on this page is one person, as a login is one token.
  await db.query(sessionAuthorization(role))
  return db
}
