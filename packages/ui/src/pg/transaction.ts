import type { Db } from './connect.ts'

/** Runs statements as one transaction: all of them happen, or none. */
export async function transaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN')
  try {
    const result = await fn()
    await db.query('COMMIT')
    return result
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
