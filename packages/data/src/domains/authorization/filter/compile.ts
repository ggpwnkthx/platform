/**
 * The compiler of the filters (spec §9.3).
 *
 * The compiler turns the tree of a filter into the SQL of a statement.
 * Every identifier comes from the manifest of the deployment and every
 * value is a bound parameter, so a caller never chooses a fragment of
 * SQL.
 */

import type { FieldDefinition } from '../../schema'
import { resolveSubstitutions } from './parse'
import {
  type FieldCatalogue,
  FilterError,
  type FilterNode,
  type SubstitutionContext,
} from './types'

/** The SQL type a field is compared with. */
export function sqlTypeOf(definition: FieldDefinition): string {
  switch (definition.type) {
    case 'string':
    case 'text':
      return 'text'
    case 'boolean':
      return 'boolean'
    case 'integer':
      return 'bigint'
    case 'decimal':
      return 'numeric'
    case 'uuid':
      return 'uuid'
    case 'timestamp':
      return 'timestamptz'
    case 'json':
      return 'jsonb'
    case 'enum':
      return 'text'
    default:
      return 'text'
  }
}

/** The compiled form of a filter. */
export interface CompiledFilter {
  /** The SQL fragment, with numbered parameters. */
  readonly sql: string
  /** The parameters of the fragment, in the order of the placeholders. */
  readonly params: readonly unknown[]
}

/** The options of the compiler. */
export interface CompileFilterOptions {
  /** The fields the filter may use. */
  readonly fields: FieldCatalogue
  /** The alias of the table in the statement. */
  readonly alias?: string
  /** The parameters that are already bound, so the numbers continue. */
  readonly startIndex?: number
  /** The substitutions that are replaced before the compilation. */
  readonly substitutions?: SubstitutionContext
}

/** Quotes an identifier of the manifest. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Compiles a filter into a SQL fragment.
 *
 * Every value is a bound parameter and every identifier comes from the
 * manifest: a caller never chooses a SQL fragment.
 */
export function compileFilter(node: FilterNode, options: CompileFilterOptions): CompiledFilter {
  const params: unknown[] = []
  let index = options.startIndex ?? 1
  const alias = options.alias ? `${quoteIdentifier(options.alias)}.` : ''
  const resolved = options.substitutions ? resolveSubstitutions(node, options.substitutions) : node

  const placeholder = (value: unknown, type: string): string => {
    // A json value is bound as its text. The driver of the database
    // writes a list as the literal of a list of the database, and the
    // literal of a list is not a json value: a predicate of a json
    // field that holds a list would be refused by the server.
    params.push(type === 'jsonb' ? JSON.stringify(value) : value)
    const current = `$${index}`
    index += 1
    return type === 'text' ? current : `${current}::${type}`
  }

  const walk = (current: FilterNode): string => {
    if (current.kind === 'all') return 'true'
    if (current.kind === 'and') {
      return `(${current.nodes.map(walk).join(' and ')})`
    }
    if (current.kind === 'or') {
      return `(${current.nodes.map(walk).join(' or ')})`
    }
    if (current.kind === 'not') {
      // The negation of the database: the negation of an unknown is an
      // unknown, and the row is not matched.
      return `not (${walk(current.node)})`
    }
    const definition = options.fields[current.field]
    if (!definition) {
      throw new FilterError(
        `the field "${current.field}" is not known`,
        'UNKNOWN_FIELD',
        current.field
      )
    }
    const type = sqlTypeOf(definition)
    // The comparison of the text is the comparison of the bytes, and not
    // the comparison of the locale of the database: the evaluation in
    // memory compares the code units, and the two evaluations have to
    // agree whatever the collation of the deployment is.
    const column =
      type === 'text'
        ? `${alias}${quoteIdentifier(current.field)} collate "C"`
        : `${alias}${quoteIdentifier(current.field)}`
    switch (current.operator) {
      case '_eq':
        return `${column} = ${placeholder(current.value, type)}`
      case '_neq':
        return `${column} <> ${placeholder(current.value, type)}`
      case '_lt':
        return `${column} < ${placeholder(current.value, type)}`
      case '_lte':
        return `${column} <= ${placeholder(current.value, type)}`
      case '_gt':
        return `${column} > ${placeholder(current.value, type)}`
      case '_gte':
        return `${column} >= ${placeholder(current.value, type)}`
      case '_is_null':
        return current.value === true ? `${column} is null` : `${column} is not null`
      case '_in':
      case '_nin': {
        const values = (current.values ?? []).map((value) => placeholder(value, type))
        const list = values.join(', ')
        return current.operator === '_in'
          ? `${column} in (${list})`
          : `not (${column} in (${list}))`
      }
      default:
        throw new FilterError('the operator is not known', 'INVALID_OPERATOR', current.field)
    }
  }

  return { sql: walk(resolved), params }
}

/**
 * The canonical json of a value.
 *
 * The keys of an object are sorted: the json of the database does not
 * keep the order of the keys, and the comparison of two json values has
 * to be the comparison of their content.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${parts.join(',')}}`
}

/**
 * Reports whether a value of a row is the null of the database.
 *
 * A field that the row does not carry is the null of the column: the
 * two are the same absence in the two evaluations.
 */
export function isNull(value: unknown): boolean {
  return value === null || value === undefined
}
