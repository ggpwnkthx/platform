import { type Compilable, type Expression, type ExpressionBuilder, sql, type SqlBool } from 'kysely'
import type { Db } from '../db.ts'

export const operators = [
  'eq',
  'neq',
  'contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_null',
  'not_null',
] as const
export type Operator = (typeof operators)[number]
export const valueless: readonly Operator[] = ['is_null', 'not_null']
export interface Condition {
  op: Operator
  value: unknown
}
export type Filter = Record<string, Condition>

/** Runs what Kysely wrote on the caller's own connection. */
export const run = <Row = Record<string, unknown>>(db: Db, query: Compilable) => {
  const compiled = query.compile()
  return db.query<Row>(compiled.sql, [...compiled.parameters])
}

// biome-ignore lint/suspicious/noExplicitAny: the columns are the installation's
type Eb = ExpressionBuilder<any, any>
export const asText = (column: string) => sql<string>`cast(${sql.ref(column)} as text)`
/** `%` and `_` are what the reader typed, not wildcards. */
const escaped = (value: unknown) => String(value ?? '').replace(/([\\%_])/g, '\\$1')
/** A pattern that matches the text anywhere, at its start, or at its end. */
export const pattern = (value: unknown, where: 'any' | 'start' | 'end') =>
  where === 'start'
    ? `${escaped(value)}%`
    : where === 'end'
      ? `%${escaped(value)}`
      : `%${escaped(value)}%`
const comparisons = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const

function condition(eb: Eb, column: string, { op, value }: Condition): Expression<SqlBool> {
  switch (op) {
    case 'eq':
      return eb(column, 'is not distinct from', value)
    case 'neq':
      return eb(column, 'is distinct from', value)
    case 'contains':
      return eb(asText(column), 'ilike', pattern(value, 'any'))
    case 'starts_with':
      return eb(asText(column), 'ilike', pattern(value, 'start'))
    case 'ends_with':
      return eb(asText(column), 'ilike', pattern(value, 'end'))
    case 'in':
    case 'not_in': {
      const values = [value].flat()
      return values.length ? eb(column, op === 'in' ? 'in' : 'not in', values) : eb.lit(true)
    }
    case 'is_null':
      return eb(column, 'is', null)
    case 'not_null':
      return eb(column, 'is not', null)
    default:
      if (!(op in comparisons)) throw new Error(`Unknown filter operator: ${String(op)}`)
      return eb(column, comparisons[op], value)
  }
}
/** The filters, and a search of every readable column as text. */
export const predicate =
  (filter: Filter, search: string, searchable: readonly string[]) => (eb: Eb) =>
    eb.and([
      ...Object.entries(filter).map(([column, one]) => condition(eb, column, one)),
      ...(search.trim() && searchable.length
        ? [eb.or(searchable.map((c) => eb(asText(c), 'ilike', pattern(search.trim(), 'any'))))]
        : []),
    ])
