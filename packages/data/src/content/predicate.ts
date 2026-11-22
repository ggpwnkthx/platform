import { ident } from '@platform/vocabulary'
import { conditionClause, type Filter } from './filter.ts'

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
