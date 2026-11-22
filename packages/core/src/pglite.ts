import type { PGlite } from '@electric-sql/pglite'
import type { Db, Result } from './db.ts'

const asWritten = [1082, 1083, 1114, 1184, 1266, 1700, 1115, 1182, 1185, 1231]
/** The parsers that make PGlite read values as the page's driver does. */
export const pgliteParsers: Record<number, (text: string) => unknown> = {
  ...Object.fromEntries(asWritten.map((oid) => [oid, (text: string) => text])),
  20: (text) => (Number.isSafeInteger(Number(text)) ? Number(text) : text),
}
const command = (text: string) => {
  const words = text
    .replace(/--[^\n]*\n/g, ' ')
    .trim()
    .toUpperCase()
    .split(/\s+/)
  return ['CREATE', 'ALTER', 'DROP'].includes(words[0] ?? '')
    ? words.slice(0, 2).join(' ')
    : (words[0] ?? '')
}

/** PGlite — PostgreSQL in the page, in the dev mode and in tests — as the platform's `Db`. */
export const fromPglite = (db: PGlite): Db => ({
  async query<Row>(text: string, params: unknown[] = []) {
    const result = await db.query<Row>(text, params, { parsers: pgliteParsers })
    return {
      rows: result.rows,
      fields: result.fields,
      command: command(text),
      rowCount: result.fields.length ? result.rows.length : (result.affectedRows ?? null),
    } satisfies Result<Row>
  },
  exec: (text) => db.exec(text),
})
