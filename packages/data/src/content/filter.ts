/**
 * The predicates a record query may carry.
 *
 * A filter is a JSON object of column conditions. A plain value is an equality:
 * `{"status":"draft"}`. A condition may also be an object naming an operator and
 * its value: `{"views":{"op":"gte","value":10}}`.
 *
 * Every value is bound as a parameter and every column is quoted as an
 * identifier, so a filter can never change the shape of the statement. The
 * database still decides whether the caller may read the column at all: a
 * condition on a column the role may not read is refused by PostgreSQL.
 */

/** The operators a condition may name. */
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

/** Operators that take no value. */
export const valueless: readonly Operator[] = ['is_null', 'not_null']

/** One condition on a column. */
export interface Condition {
  op: Operator
  value: unknown
}

/** A filter as the query carries it: column name to condition. */
export type Filter = Record<string, Condition>

/** A filter written the short way: a plain value is an equality. */
export type RawFilter = Record<string, unknown>

function isOperator(value: string): value is Operator {
  return (operators as readonly string[]).includes(value)
}

/**
 * Reads a filter as the query carries it. A condition may be a plain value or
 * an object with `op` and `value`. An unknown operator is refused rather than
 * guessed at, because a filter that quietly means something else is a filter
 * that lies.
 */
export function parseFilter(raw: RawFilter): Filter {
  const filter: Filter = {}
  for (const [column, condition] of Object.entries(raw)) {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      const { op, value } = condition as { op?: unknown; value?: unknown }
      if (typeof op !== 'string' || !isOperator(op))
        throw new Error(`Unknown filter operator: ${String(op)}`)
      filter[column] = { op, value }
      continue
    }
    filter[column] = { op: 'eq', value: condition }
  }
  return filter
}

/** The value a LIKE pattern must not carry: the wildcards of the pattern itself. */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1')
}

/** The pattern a text operator matches, with the wildcards escaped. */
export function likePattern(op: Operator, value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const escaped = escapeLike(text)
  if (op === 'starts_with') return `${escaped}%`
  if (op === 'ends_with') return `%${escaped}`
  return `%${escaped}%`
}

/** The clause and the values one condition contributes. */
export interface Clause {
  sql: string
  values: unknown[]
}

/**
 * The clause for one condition on one column. The column is quoted by the
 * caller's identifier quoter; the value is always bound.
 */
export function conditionClause(quoted: string, condition: Condition): Clause {
  const op = condition.op
  const value = condition.value
  switch (op) {
    case 'eq':
      return { sql: `${quoted} IS NOT DISTINCT FROM $1`, values: [value] }
    case 'neq':
      return { sql: `${quoted} IS DISTINCT FROM $1`, values: [value] }
    case 'contains':
    case 'starts_with':
    case 'ends_with':
      return {
        sql: `CAST(${quoted} AS TEXT) ILIKE $1 ESCAPE '\\'`,
        values: [likePattern(op, value)],
      }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const sign = op === 'gt' || op === 'gte' ? '>' : '<'
      const equal = op === 'gte' || op === 'lte' ? '=' : ''
      return { sql: `${quoted} ${sign}${equal} $1`, values: [value] }
    }
    case 'in':
    case 'not_in': {
      const list = Array.isArray(value) ? value : [value]
      if (!list.length) return { sql: 'TRUE', values: [] }
      const placeholders = list.map((_, index) => `$${index + 1}`).join(', ')
      return {
        sql: `${quoted} ${op === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`,
        values: list,
      }
    }
    case 'is_null':
      return { sql: `${quoted} IS NULL`, values: [] }
    case 'not_null':
      return { sql: `${quoted} IS NOT NULL`, values: [] }
  }
}
