import type { Operator } from '@platform/data'

/**
 * How an operator reads in the interface.
 *
 * The operators themselves — what a condition may name, and the clause each one writes —
 * are the platform's own, and are written once in `@platform/data`. What is left here is the
 * wording the interface shows.
 */

/** How an operator reads in the interface. */
export const operatorLabels: Record<Operator, string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  not_in: 'is none of',
  is_null: 'is empty',
  not_null: 'is not empty',
}
