import { type Operator, valueless } from '@platform/data'
import { textOf, readsLong } from './text.ts'
import type { Field, Parsed } from './types.ts'

/**
 * A field between the form and the database: the text a form holds for a value, the value a
 * column receives from what was typed, and the value a condition carries. Each asks the
 * field's own type, and answers for it where the type says nothing.
 */

/** What the form holds for a value: text, as it would be typed. */
export function fieldText(field: Field, value: unknown): string {
  if (value === null || value === undefined) return ''
  return field.type.toText ? field.type.toText(value, field) : textOf(value)
}

/** The value a column receives from what was typed, or an error to show under the field. */
export function fieldValue(field: Field, text: string): Parsed {
  // Nothing typed is nothing stored — but a required text may still be the empty text.
  if (text === '') return { value: field.kind === 'text' && field.column.required ? '' : null }
  return field.type.fromText ? field.type.fromText(text, field) : { value: text.trim() }
}

/** Does the field take the whole width of the form? */
export function isWide(field: Field, text: string): boolean {
  return field.type.wide ? field.type.wide(field, text) : readsLong(field.name)
}

/** The value a new condition on the field starts with. */
export function filterStart(field: Field): string {
  return field.type.filter.initial?.(field) ?? ''
}

/** The value a condition carries, from what was typed in the filter builder. */
export function filterValue(field: Field, op: Operator, text: string): unknown {
  if (valueless.includes(op)) return null
  if (op === 'in' || op === 'not_in')
    return text
      .split(',')
      .map((one) => one.trim())
      .filter(Boolean)
  return field.type.filter.parse ? field.type.filter.parse(text, field) : text
}
