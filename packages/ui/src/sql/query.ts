import type { Db } from '../pg/connect.ts'

/** Runs the reader's own statement: one statement, as them. */
export async function run(db: Db, sql: string) {
  return db.query(sql)
}
