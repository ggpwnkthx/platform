import { ident, qualified } from '@platform/sql'
import type { Db } from '../pg/connect.ts'
import { conditionClause, type Filter } from './filter.ts'

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

export interface Predicate {
  sql: string
  values: unknown[]
}

/**
 * The WHERE clause of a record query: the filter's conditions, then the search. Every value is
 * bound and every column quoted, so a query can never change the shape of the statement.
 */
export function predicate(
  filter: Filter,
  search: string,
  searchable: readonly string[]
): Predicate {
  const values: unknown[] = []
  const clauses: string[] = []
  for (const [column, condition] of Object.entries(filter)) {
    const clause = conditionClause(ident(column), condition)
    if (!clause.values.length && clause.sql === 'TRUE') continue
    const offset = values.length
    clauses.push(clause.sql.replace(/\$(\d+)/g, (_, i: string) => `$${offset + Number(i)}`))
    values.push(
      ...clause.values.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))
    )
  }
  if (search.trim() && searchable.length) {
    values.push(`%${search.trim().replace(/([\\%_])/g, '\\$1')}%`)
    const matched = searchable.map(
      (column) => `CAST(${ident(column)} AS TEXT) ILIKE $${values.length} ESCAPE '\\'`
    )
    clauses.push(`(${matched.join(' OR ')})`)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

/** One page of rows, and the number of rows the predicate allows under row security. */
export async function records(db: Db, query: RecordQuery) {
  const target = qualified(query.schema, query.table)
  const where = predicate(query.filter, query.search, query.searchable)
  const order = query.sort.map(
    (name) => `${ident(name.replace(/^-/, ''))} ${name.startsWith('-') ? 'DESC' : 'ASC'} NULLS LAST`
  )
  const values = [...where.values, query.limit, query.offset]
  const rows = await db.query(
    `SELECT ${query.columns.map(ident).join(', ')} FROM ${target} ${where.sql}
     ${order.length ? `ORDER BY ${order.join(', ')}` : ''}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )
  const counted = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${target} ${where.sql}`,
    where.values
  )
  return { rows: rows.rows, fields: rows.fields, total: counted.rows[0]?.total ?? 0 }
}

/** One row, by id, with the columns the reader may read. */
export async function record(db: Db, schema: string, table: string, columns: string[], id: string) {
  const result = await db.query(
    `SELECT ${columns.map(ident).join(', ')} FROM ${qualified(schema, table)} WHERE id = $1`,
    [id]
  )
  return result.rows[0] ?? null
}

/**
 * Writes a row. No RETURNING: the right to insert or update a column is not a right to read
 * it back, so a write reports how many rows it touched and nothing else.
 */
export async function insertRecord(
  db: Db,
  schema: string,
  table: string,
  values: Record<string, unknown>
) {
  const entries = Object.entries(values)
  const sql = entries.length
    ? `INSERT INTO ${qualified(schema, table)} (${entries.map(([k]) => ident(k)).join(', ')})
       VALUES (${entries.map((_, i) => `$${i + 1}`).join(', ')})`
    : `INSERT INTO ${qualified(schema, table)} DEFAULT VALUES`
  return (
    (
      await db.query(
        sql,
        entries.map(([, v]) => v)
      )
    ).affected ?? 0
  )
}

/** Changes a row, only if it still carries the version the reader saw. */
export async function updateRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  values: Record<string, unknown>,
  version?: number
) {
  const entries = Object.entries(values)
  if (!entries.length) return 0
  const params: unknown[] = entries.map(([, v]) => v)
  params.push(id)
  let sql = `UPDATE ${qualified(schema, table)} SET ${entries
    .map(([k], i) => `${ident(k)} = $${i + 1}`)
    .join(', ')} WHERE id = $${params.length}`
  if (version !== undefined) {
    params.push(version)
    sql += ` AND version = $${params.length}`
  }
  return (await db.query(sql, params)).affected ?? 0
}

export async function deleteRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  version?: number
) {
  const params: unknown[] = [id]
  let sql = `DELETE FROM ${qualified(schema, table)} WHERE id = $1`
  if (version !== undefined) {
    params.push(version)
    sql += ' AND version = $2'
  }
  return (await db.query(sql, params)).affected ?? 0
}

/** The options a relation offers: rows of the target, labelled by their first text column. */
export async function relationOptions(
  db: Db,
  schema: string,
  table: string,
  label: string | null,
  search: string
) {
  const shown = label ? `CAST(${ident(label)} AS TEXT)` : 'id::text'
  const result = await db.query<{ id: string; label: string }>(
    `SELECT id::text AS id, ${shown} AS label FROM ${qualified(schema, table)}
      WHERE $1 = '' OR ${shown} ILIKE '%' || $1 || '%' OR id::text = $1
      ORDER BY 2 LIMIT 20`,
    [search.trim()]
  )
  return result.rows
}
