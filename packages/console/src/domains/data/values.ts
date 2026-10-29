/**
 * The values of the records, between the forms of the console and the
 * contract of Data.
 *
 * A form carries text; Data takes typed values. The console
 * converts what a form carries into the type that the metadata of the
 * field names, and it refuses only what cannot be converted: the rules of
 * a value — its length, its bounds, its enumeration — are the rules of
 * Data, and its refusal is the one the caller reads.
 */

import type { FieldMetadata, RecordValue } from './types'

/** The control a field is edited with. */
export type InputKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'timestamp'
  | 'json'
  | 'uuid'

/** The control of a field. */
export function inputKindOf(field: FieldMetadata): InputKind {
  switch (field.type) {
    case 'text':
      return 'textarea'
    case 'enum':
      return 'select'
    case 'boolean':
      return 'boolean'
    case 'integer':
      return 'integer'
    case 'decimal':
      return 'decimal'
    case 'timestamp':
      return 'timestamp'
    case 'json':
      return 'json'
    case 'uuid':
      return 'uuid'
    default:
      return 'text'
  }
}

/** The text a form shows for a value. */
export function formValueOf(field: FieldMetadata, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (field.type === 'json') return JSON.stringify(value, null, 2)
  if (field.type === 'timestamp' && typeof value === 'string') {
    const date = new Date(value)
    // The control of a moment is `datetime-local`, read as UTC.
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 19)
  }
  return String(value)
}

/** The text a table shows for a value. */
export function displayOf(value: unknown, limit = 80): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** A value that cannot be converted. */
export interface ValueProblem {
  readonly field: string
  readonly message: string
}

/** What a form becomes. */
export interface ReadValues {
  readonly values: Record<string, unknown>
  readonly problems: readonly ValueProblem[]
}

/** The marker of an empty control: the value is left out, or cleared. */
const EMPTY = Symbol('empty')

/** Converts the text of a control into the value of a field. */
function convert(field: FieldMetadata, text: string): unknown | ValueProblem | typeof EMPTY {
  const label = field.label ?? field.name
  if (text === '' && field.type !== 'string' && field.type !== 'text') return EMPTY
  switch (field.type) {
    case 'boolean':
      if (text === 'true') return true
      if (text === 'false') return false
      return { field: field.name, message: `${label} is neither yes nor no` }
    case 'integer': {
      const parsed = Number(text.trim())
      if (!Number.isSafeInteger(parsed)) {
        return { field: field.name, message: `${label} is not an integer` }
      }
      return parsed
    }
    case 'decimal': {
      const trimmed = text.trim()
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return { field: field.name, message: `${label} is not a decimal number` }
      }
      return trimmed
    }
    case 'timestamp': {
      const trimmed = text.trim()
      const zoned = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`
      const date = new Date(zoned)
      if (Number.isNaN(date.getTime())) {
        return { field: field.name, message: `${label} is not a moment` }
      }
      return date.toISOString()
    }
    case 'json': {
      try {
        const parsed = JSON.parse(text) as unknown
        if (typeof parsed !== 'object' || parsed === null) {
          return { field: field.name, message: `${label} is not a json object or array` }
        }
        return parsed
      } catch {
        return { field: field.name, message: `${label} is not json` }
      }
    }
    case 'uuid':
    case 'enum':
      return text.trim()
    default:
      return text
  }
}

/** Reports whether a converted value is a problem. */
function isProblem(value: unknown): value is ValueProblem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'field' in value &&
    'message' in value &&
    Object.keys(value).length === 2
  )
}

/** Reports whether two values are the same value. */
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/**
 * Reads the values of a form of a record.
 *
 * A creation carries the fields the caller filled in. An update carries
 * the fields that changed, and nothing else: an update that changes
 * nothing is not sent, because Data refuses an empty patch
 * and an update always increments the version of the record.
 */
export function readValues(options: {
  readonly fields: readonly FieldMetadata[]
  readonly writable: readonly string[]
  readonly form: Readonly<Record<string, string>>
  readonly original?: RecordValue
}): ReadValues {
  const values: Record<string, unknown> = {}
  const problems: ValueProblem[] = []
  for (const field of options.fields) {
    if (!options.writable.includes(field.name)) continue
    const text = options.form[field.name]
    if (text === undefined) continue
    const converted = convert(field, text)
    if (isProblem(converted)) {
      problems.push(converted)
      continue
    }
    let value: unknown
    if (converted === EMPTY) {
      // An empty control leaves the field out of a creation, and clears
      // a field of an update when the field may be cleared.
      if (!options.original) continue
      if (!field.nullable) continue
      value = null
    } else {
      value = converted
    }
    if (options.original && same(options.original[field.name], value)) continue
    values[field.name] = value
  }
  return { values, problems }
}
