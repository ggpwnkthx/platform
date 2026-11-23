import { type Operator, valueless } from '@platform/core'
import type { Field } from './types.ts'

export const operatorWords: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  not_in: 'is none of',
  is_null: 'is empty',
  not_null: 'is not empty',
}
/** The value a condition carries, from what was typed: a list for `in`, the type's own reading otherwise. */
export function filterValue(field: Field | undefined, op: Operator, text: string): unknown {
  const parse = (one: string) => field?.type.parseFilter?.(one) ?? one
  if (valueless.includes(op)) return null
  return op === 'in' || op === 'not_in'
    ? text.split(',').map((one) => parse(one.trim()))
    : parse(text)
}
