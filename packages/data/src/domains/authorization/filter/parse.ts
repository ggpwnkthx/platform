/**
 * The parser of the filters (spec §9.3).
 *
 * The parser reads the value of a filter and it returns the tree of the
 * filter. It validates the operators against the types of the fields, so
 * a statement never receives an operand of the wrong type, and it never
 * compiles a filter from a string the caller wrote.
 */

import { type FieldDefinition, isTimestamp } from '../../schema'
import {
  FILTER_OPERATORS,
  FilterError,
  type FilterNode,
  type FilterOperator,
  type FilterParseOptions,
  MAX_FILTER_DEPTH,
  MAX_FILTER_LEAVES,
  MAX_FILTER_VALUES,
  type SubstitutionContext,
  SUBSTITUTIONS,
} from './types'

/** Reports whether a value is an object and not an array. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The operators that compare an order. */
const ORDERING_OPERATORS: ReadonlySet<string> = new Set(['_lt', '_lte', '_gt', '_gte'])

/** The operators that take a list of values. */
const LIST_OPERATORS: ReadonlySet<string> = new Set(['_in', '_nin'])

/**
 * Validates the value of a predicate against the type of its field.
 *
 * The type is checked here and nowhere else: a statement never receives
 * an operand of the wrong type, so the comparison of the database is
 * never a conversion that hides a mistake of the caller.
 */
export function validateOperand(
  field: string,
  definition: FieldDefinition,
  operator: FilterOperator,
  value: unknown,
  options: { substitutions?: boolean } = {}
): void {
  if (operator === '_is_null') {
    if (typeof value !== 'boolean') {
      throw new FilterError(
        `the operator _is_null of "${field}" takes a boolean`,
        'INVALID_OPERATOR',
        field
      )
    }
    return
  }
  if (value === null) {
    throw new FilterError(
      `the operator ${operator} of "${field}" does not accept null`,
      'NULL_OPERAND',
      field
    )
  }
  // A server substitution is a typed value of the server: it is checked
  // when it is replaced, and not here.
  if (
    options.substitutions &&
    typeof value === 'string' &&
    (SUBSTITUTIONS as readonly string[]).includes(value)
  ) {
    return
  }
  if (ORDERING_OPERATORS.has(operator)) {
    if (
      !['string', 'text', 'integer', 'decimal', 'uuid', 'timestamp', 'enum'].includes(
        definition.type
      )
    ) {
      throw new FilterError(
        `the operator ${operator} is not defined for the type "${definition.type}"`,
        'INVALID_OPERATOR',
        field
      )
    }
  }
  switch (definition.type) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') {
        throw new FilterError(`the field "${field}" is a string`, 'TYPE_MISMATCH', field)
      }
      if (definition.maxLength !== undefined && [...value].length > definition.maxLength) {
        throw new FilterError(`the field "${field}" is too long`, 'MAX_LENGTH', field)
      }
      break
    case 'enum':
      if (typeof value !== 'string') {
        throw new FilterError(`the field "${field}" is a string`, 'TYPE_MISMATCH', field)
      }
      if (definition.enum && !definition.enum.includes(value)) {
        throw new FilterError(
          `the field "${field}" does not hold that value`,
          'INVALID_ENUM',
          field
        )
      }
      break
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new FilterError(`the field "${field}" is a boolean`, 'TYPE_MISMATCH', field)
      }
      break
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new FilterError(`the field "${field}" is an integer`, 'TYPE_MISMATCH', field)
      }
      break
    case 'decimal':
      if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) {
        throw new FilterError(
          `the field "${field}" is a decimal written as a string`,
          'TYPE_MISMATCH',
          field
        )
      }
      break
    case 'uuid':
      if (typeof value !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(value)) {
        throw new FilterError(`the field "${field}" is a uuid`, 'TYPE_MISMATCH', field)
      }
      break
    case 'timestamp':
      if (typeof value !== 'string' || !isTimestamp(value)) {
        throw new FilterError(
          `the field "${field}" is a timestamp with an explicit offset`,
          'TYPE_MISMATCH',
          field
        )
      }
      break
    case 'json':
      if (typeof value !== 'object') {
        throw new FilterError(`the field "${field}" is a json value`, 'TYPE_MISMATCH', field)
      }
      break
    default:
      break
  }
}

/**
 * Normalizes the operand of a predicate.
 *
 * The uuid of the database is written in lower case, and the cast of the
 * statement normalizes the operand: the evaluation in memory has to
 * normalize it too, or the two evaluations would disagree on the case
 * of a uuid.
 */
function normalizeOperand(
  definition: FieldDefinition,
  value: unknown,
  options: { substitutions?: boolean }
): unknown {
  if (definition.type !== 'uuid' || typeof value !== 'string') return value
  if (options.substitutions && (SUBSTITUTIONS as readonly string[]).includes(value)) {
    return value
  }
  return value.toLowerCase()
}

/**
 * Parses a filter.
 *
 * The parser is strict: an unknown operator, an unknown field, a wrong
 * type or a filter that is too deep is refused. A filter that is not
 * understood is never partially applied.
 */
export function parseFilter(value: unknown, options: FilterParseOptions): FilterNode {
  const state = { leaves: 0 }
  return parseNode(value, options, state, 1)
}

/** Parses one node of a filter. */
function parseNode(
  value: unknown,
  options: FilterParseOptions,
  state: { leaves: number },
  depth: number
): FilterNode {
  if (depth > MAX_FILTER_DEPTH) {
    throw new FilterError(`the filter is deeper than ${MAX_FILTER_DEPTH}`, 'FILTER_TOO_DEEP')
  }
  if (!isObject(value)) {
    throw new FilterError('the filter is not an object', 'INVALID_FILTER')
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    // An empty filter object means no additional predicate.
    return { kind: 'all' }
  }
  if (entries.length > 1) {
    throw new FilterError('a filter node holds one field or one operator', 'INVALID_FILTER')
  }
  const [key, raw] = entries[0]!

  if (key === '_and' || key === '_or') {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new FilterError(`the operator ${key} takes a non-empty list`, 'INVALID_FILTER')
    }
    const nodes = raw.map((entry) => parseNode(entry, options, state, depth + 1))
    return key === '_and' ? { kind: 'and', nodes } : { kind: 'or', nodes }
  }

  if (key === '_not') {
    // The negation of a predicate. It negates the whole subtree and not
    // only a comparison: the null of a comparison is unknown, and the
    // negation of an unknown is unknown. The evaluation in memory and
    // the statement of the database agree on that, or they do not agree
    // at all.
    if (!isObject(raw)) {
      throw new FilterError('the operator _not takes a filter', 'INVALID_FILTER')
    }
    const node = parseNode(raw, options, state, depth + 1)
    return { kind: 'not', node }
  }

  if ((FILTER_OPERATORS as readonly string[]).includes(key)) {
    throw new FilterError(`the operator ${key} needs a field`, 'INVALID_FILTER')
  }

  const definition = options.fields[key]
  if (!definition) {
    throw new FilterError(`the field "${key}" is not known`, 'UNKNOWN_FIELD', key)
  }
  if (!isObject(raw)) {
    throw new FilterError(`the predicate of "${key}" is not an object`, 'INVALID_FILTER', key)
  }
  const operatorEntries = Object.entries(raw)
  if (operatorEntries.length !== 1) {
    throw new FilterError(`the predicate of "${key}" holds one operator`, 'INVALID_FILTER', key)
  }
  const [operator, operand] = operatorEntries[0]!
  if (!(FILTER_OPERATORS as readonly string[]).includes(operator)) {
    throw new FilterError(`the operator "${operator}" is not known`, 'INVALID_OPERATOR', key)
  }
  state.leaves += 1
  if (state.leaves > MAX_FILTER_LEAVES) {
    throw new FilterError(
      `the filter holds more than ${MAX_FILTER_LEAVES} predicates`,
      'FILTER_TOO_LARGE'
    )
  }

  const typed = operator as FilterOperator
  if (LIST_OPERATORS.has(typed)) {
    if (!Array.isArray(operand) || operand.length === 0) {
      throw new FilterError(
        `the operator ${typed} of "${key}" takes a list of values`,
        'INVALID_OPERATOR',
        key
      )
    }
    if (operand.length > MAX_FILTER_VALUES) {
      throw new FilterError(
        `the operator ${typed} of "${key}" takes at most ${MAX_FILTER_VALUES} values`,
        'INVALID_OPERATOR',
        key
      )
    }
    for (const entry of operand) {
      validateOperand(key, definition, typed, entry, options)
    }
    return {
      kind: 'cmp',
      field: key,
      operator: typed,
      type: definition.type,
      values: operand.map((entry) => normalizeOperand(definition, entry, options)),
    }
  }

  validateOperand(key, definition, typed, operand, options)
  return {
    kind: 'cmp',
    field: key,
    operator: typed,
    type: definition.type,
    value: normalizeOperand(definition, operand, options),
  }
}

/**
 * Replaces the server substitutions of a filter.
 *
 * The substitutions are typed server values: they are not evaluated code
 * and they never come from a caller.
 */
export function resolveSubstitutions(node: FilterNode, context: SubstitutionContext): FilterNode {
  if (node.kind === 'all') return node
  if (node.kind === 'not') {
    return { kind: 'not', node: resolveSubstitutions(node.node, context) }
  }
  if (node.kind === 'cmp') {
    const substitute = (value: unknown): unknown => {
      if (value === '$principalId') return context.principalId
      if (value === '$tenantId') return context.tenantId
      if (value === '$workspaceId') return context.workspaceId
      return value
    }
    if (node.values) {
      return { ...node, values: node.values.map((entry) => substitute(entry)) }
    }
    return { ...node, value: substitute(node.value) }
  }
  return { kind: node.kind, nodes: node.nodes.map((entry) => resolveSubstitutions(entry, context)) }
}
