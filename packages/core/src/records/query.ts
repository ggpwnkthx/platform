import { type Compilable, type Expression, type ExpressionBuilder, sql, type SqlBool } from 'kysely'
import type { Db } from '../db.ts'

/** The conditions a column may carry. */
export const columnOperators = [
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
/** The conditions a relation may carry: what a record is linked to. */
export const relationOperators = ['has_any', 'has_none', 'has_all'] as const
export const operators = [...columnOperators, ...relationOperators] as const
export type Operator = (typeof operators)[number]
export type ColumnOperator = (typeof columnOperators)[number]
export type RelationOperator = (typeof relationOperators)[number]
export const valueless: readonly Operator[] = ['is_null', 'not_null']
export const isRelationOperator = (op: Operator): op is RelationOperator =>
  (relationOperators as readonly Operator[]).includes(op)
export interface Condition {
  op: Operator
  value: unknown
  /**
   * When the condition is on the rows a relation reaches: the column of theirs that is
   * tested, and the condition on it. The rows are found by the reach of the field.
   */
  through?: { column: string; op: Operator; value: unknown }
}
export type Filter = Record<string, Condition>

/**
 * How a record reaches the rows of a relation: through a column of its own, or through a
 * table of links. The same reach reads their names, tests their fields, and counts them.
 */
export type RelationReach =
  | {
      kind: 'column'
      /** The table the other rows live in. */
      schema: string
      table: string
      /** The column of the record that points at them. */
      column: string
      /**
       * The column of theirs the key points at: usually `id`. A key made by hand may
       * point at another column, and the reach follows the key as it is written.
       */
      target_column?: string
      /** The column of theirs that is searched, when the search follows it. */
      label?: string
    }
  | {
      kind: 'rows'
      /** The table the links live in. */
      schema: string
      table: string
      /** The column of that table that points back at the record. */
      fk: string
      /** The column of that table that holds their id. */
      target: string
      /** The table the other row lives in. */
      target_schema: string
      target_table: string
      /**
       * The column of the other table the link's key points at: usually `id`. The link
       * holds the value of that column, and the other row is found by it.
       */
      target_column?: string
      /** The column of theirs that is searched, when the search follows it. */
      label?: string
    }

/**
 * How a record reaches the rows of a relation held in a table of links: a join table, or
 * the table of children. The same path reads the links, writes them, and filters by them.
 */
export interface RelationPath {
  kind: 'rows'
  /** The table the related rows live in. */
  schema: string
  table: string
  /** The column in that table that points back at the record. */
  fk: string
  /** The column that holds the other row's id. */
  target: string
  /** The table the other row lives in. */
  target_schema: string
  target_table: string
  /**
   * The column of the other table the link's key points at: usually `id`. The link holds
   * the value of that column, and the other row is found by it.
   */
  target_column?: string
  /**
   * The columns of the link that carry something of its own, beside the two keys: what
   * the link is worth, or when it began. They are read, never written here.
   */
  payload?: readonly string[]
}

/** Runs what Kysely wrote on the caller's own connection. */
export const run = <Row = Record<string, unknown>>(db: Db, query: Compilable) => {
  const compiled = query.compile()
  return db.query<Row>(compiled.sql, [...compiled.parameters])
}

// biome-ignore lint/suspicious/noExplicitAny: the columns are the installation's
export type Eb = ExpressionBuilder<any, any>
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

export function condition(eb: Eb, column: string, { op, value }: Condition): Expression<SqlBool> {
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
      return eb(column, comparisons[op as keyof typeof comparisons], value)
  }
}
