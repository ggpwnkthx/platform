import type { PGlite } from '@electric-sql/pglite'
import { applyFolder, type Applied } from '../folder.ts'
import { MIGRATIONS } from '../migrations.ts'
import { client } from './client.ts'

/** Installs the platform alone: every installation script, in order. */
export async function installPlatform(db: PGlite): Promise<void> {
  for (const script of MIGRATIONS) await db.exec(script.sql)
}

/**
 * Installs the platform and what a folder applies. It is all there, or none of it is: the platform too,
 * because a database that is kept is asked only whether the platform is in it. A page that
 * is closed halfway leaves nothing, and the next one installs from the start.
 */
export async function install(db: PGlite, applied: Applied): Promise<void> {
  const q = client(db)
  await q.query('BEGIN')
  try {
    await installPlatform(db)
    await applyFolder(q, applied)
    await q.query('COMMIT')
  } catch (error) {
    await q.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
