import { PGlite } from '@electric-sql/pglite'
import { type Db, ident } from '../src/index.ts'
import { fromPglite, pgliteParsers } from '../src/pglite.ts'

const text = (path: string) => Bun.file(new URL(`../../../${path}`, import.meta.url)).text()
export const admin = 'admin@example.com'

/** The newsroom example installed in a PostgreSQL of its own, in memory, as a deployment installs it. */
export async function world() {
  const pg = await PGlite.create({ parsers: pgliteParsers })
  const db = fromPglite(pg)
  for (const file of [
    'migrations/0001_platform.sql',
    'examples/newsroom/apply/schema.sql',
    'examples/newsroom/apply/demo.sql',
  ])
    await pg.exec(await text(file))
  /** PGlite holds one session: become a person the way the dev mode does. */
  const as = async (role: string): Promise<Db> => {
    await pg.query('RESET SESSION AUTHORIZATION')
    await pg.query(`SET SESSION AUTHORIZATION ${ident(role)}`)
    return db
  }
  // PGlite's RESET SESSION AUTHORIZATION does not give the session back to the user it
  // was opened by, so the one it was opened as is named here and set again.
  const opened = ((await pg.query(`SELECT session_user::text AS name`)).rows[0] as { name: string })
    .name
  const root = async (): Promise<Db> => {
    await pg.query(`SET SESSION AUTHORIZATION ${ident(opened)}`)
    return db
  }
  return { pg, db, as, root }
}
