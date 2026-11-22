import { type DataSource, ident, qualified } from '@platform/vocabulary'
import type { Filter } from './filter.ts'
import { predicate } from './predicate.ts'

/**
 * The records of a collection: read, searched, filtered, paged and written. Every value is
 * bound and every column quoted, so a query can never change the shape of the statement.
 * PostgreSQL decides what the reader may reach: a column they may not read is refused by the
 * database, not hidden by the page.
 */

export interface RecordQuery {
  schema: string
  table: string
  /** The columns to read; the readable ones when absent. */
  columns: string[]
  /** Every readable column: the search reads them all, not only those on screen. */
  searchable: string[]
  filter: Filter
  search: string
  /** Column names; a leading minus sorts descending. */
  sort: string[]
  limit: number
  offset: number
}

/** One page of rows, and the number of rows the predicate allows under row security. */
export async function records(db: DataSource, query: RecordQuery) {
  const target = qualified(query.schema, query.table)
  const where = predicate(query.filter, query.search, query.searchable)
  const order = query.sort.map(
    (name) => `${ident(name.replace(/^-/, ''))} ${name.startsWith('-') ? 'DESC' : 'ASC'} NULLS LAST`
  )
  const values = [...where.values, query.limit, query.offset]
  // fallow-ignore-next-line security-sink -- every column and table name is quoted with ident(); every value is bound
  const rows = await db.query(
    `SELECT ${query.columns.map(ident).join(', ')} FROM ${target} ${where.sql}
     ${order.length ? `ORDER BY ${order.join(', ')}` : ''}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )
  // fallow-ignore-next-line security-sink -- every column and table name is quoted with ident(); every value is bound
  const counted = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${target} ${where.sql}`,
    where.values
  )
  return { rows: rows.rows, total: counted.rows[0]?.total ?? 0 }
}

/** One row, by id, with the columns the reader may read. */
export async function record(
  db: DataSource,
  schema: string,
  table: string,
  columns: string[],
  id: string
) {
  // fallow-ignore-next-line security-sink -- every column and table name is quoted with ident(); every value is bound
  const result = await db.query(
    `SELECT ${columns.map(ident).join(', ')} FROM ${qualified(schema, table)} WHERE id = $1`,
    [id]
  )
  return result.rows[0] ?? null
}
