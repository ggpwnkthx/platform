import { PGlite } from '@electric-sql/pglite'
import { applyFolder, type Db, deploymentVariables, ident, transaction } from '../src/index.ts'
import { fromPglite, pgliteParsers } from '../src/pglite.ts'
import models from '../../../examples/newsroom/apply/models.ts'

const text = (path: string) => Bun.file(new URL(`../../../${path}`, import.meta.url)).text()
export const admin = deploymentVariables().admin

/** The newsroom example installed in a PostgreSQL of its own, in memory, as a deployment installs it. */
export async function world() {
  const pg = await PGlite.create({ parsers: pgliteParsers })
  const db = fromPglite(pg)
  await pg.exec(await text('migrations/0001_platform.sql'))
  const applied = {
    models,
    migration: await text('examples/newsroom/apply/migration.sql'),
    demo: await text('examples/newsroom/apply/demo.sql'),
  }
  const first = await transaction(db, () => applyFolder(db, applied))
  /** PGlite holds one session: become a person the way the dev mode does. */
  const as = async (role: string): Promise<Db> => {
    await pg.query('RESET SESSION AUTHORIZATION')
    await pg.query(`SET SESSION AUTHORIZATION ${ident(role)}`)
    return db
  }
  const root = async (): Promise<Db> => {
    await pg.query('RESET SESSION AUTHORIZATION')
    return db
  }
  return { pg, db, as, root, applied, first }
}
