import type { PGlite } from '@electric-sql/pglite'
import type pg from 'pg'

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
