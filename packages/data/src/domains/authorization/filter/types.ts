/**
 * The grammar of the filters (spec §9.3).
 *
 * The module owns the operators of a predicate, the shape of a parsed
 * filter and the error of a filter that cannot be used. The parser, the
 * compiler and the evaluator of the filters live next to it, and they
 * share these types.
 */

import type { FieldDefinition, FieldType } from '../../schema'

/** The operators of a predicate. */
export const FILTER_OPERATORS = [
  '_eq',
  '_neq',
  '_in',
  '_nin',
  '_lt',
  '_lte',
  '_gt',
  '_gte',
  '_is_null',
] as const

/** The operator of a predicate. */
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

/** The maximum depth of a filter. */
export const MAX_FILTER_DEPTH = 5

/** The maximum number of leaf predicates of a filter. */
export const MAX_FILTER_LEAVES = 50

/** The maximum number of values of `_in` and `_nin`. */
export const MAX_FILTER_VALUES = 100

/** The names of the server substitutions. */
export const SUBSTITUTIONS = ['$principalId', '$tenantId', '$workspaceId'] as const

/** The values the substitutions are replaced with. */
export interface SubstitutionContext {
  readonly principalId: string
  readonly tenantId: string
  readonly workspaceId: string
}

/** A node of a parsed filter. */
export type FilterNode =
  | { readonly kind: 'all' }
  | { readonly kind: 'and'; readonly nodes: readonly FilterNode[] }
  | { readonly kind: 'or'; readonly nodes: readonly FilterNode[] }
  | {
      readonly kind: 'not'
      readonly node: FilterNode
    }
  | {
      readonly kind: 'cmp'
      readonly field: string
      readonly operator: FilterOperator
      /**
       * The type of the field, when the parser knows it.
       *
       * The type is the rule of the comparison: the statement compares
       * with the type of the column, and the evaluation in memory has to
       * compare with the same type. A comparison that does not know the
       * type compares a text that looks like a number as a number, and
       * the two evaluations do not agree.
       */
      readonly type?: FieldType
      readonly value?: unknown
      readonly values?: readonly unknown[]
    }

/** The names of the fields a filter uses. */
export function referencedFields(node: FilterNode): string[] {
  if (node.kind === 'all') return []
  if (node.kind === 'cmp') return [node.field]
  if (node.kind === 'not') return referencedFields(node.node)
  return node.nodes.flatMap((entry) => referencedFields(entry))
}

/** The problem of a filter that cannot be used. */
export class FilterError extends Error {
  override readonly name = 'FilterError'
  /** The field the problem is about, when there is one. */
  readonly field?: string
  /** The machine readable reason of the problem. */
  readonly code: string

  constructor(message: string, code = 'INVALID_FILTER', field?: string) {
    super(message)
    this.code = code
    this.field = field
  }
}

/** The fields a filter may use, with their types. */
export type FieldCatalogue = Readonly<Record<string, FieldDefinition>>

/** The options of the parser. */
export interface FilterParseOptions {
  /** The fields a filter may use. */
  readonly fields: FieldCatalogue
  /** True when the server substitutions are recognized. */
  readonly substitutions?: boolean
}
