import { display } from '../format.ts'

/** The small readings of a value that the field types and the renderers share. */

/** The text of a value, as the screen shows it. */
export const textOf = (value: unknown): string => display(value)

/** A whole number, as it is typed. */
export const wholeNumber = /^-?\d+$/

/** A number, as it is typed: digits, a fraction and an exponent. */
export const anyNumber = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/

/** The value as a number, when it is one. */
export function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && anyNumber.test(value.trim())) return Number(value)
  return null
}

/**
 * A number with its thousands marked, as it was written otherwise: a decimal keeps its
 * places, because a value is never rounded to be read.
 */
export function grouped(value: unknown): string {
  const text = textOf(value)
  const match = text.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) return text
  const [, sign = '', whole = '', rest] = match
  const marked = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${marked}${rest === undefined ? '' : `.${rest}`}`
}

/** Only a link the browser may follow: no scheme of its own, or one of the three. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed) return null
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  return trimmed
}

/** A template the owner wrote, with the value put in it. */
export function fill(template: string, value: string, encode = false): string {
  return template.replaceAll('{value}', encode ? encodeURIComponent(value) : value)
}

/** A colour for a listed value, by what the word means rather than where it falls in the list. */
export function choiceTone(value: string): number {
  if (/^(published|won|active|customer|done|approved|paid|open)$/i.test(value)) return 3
  if (/^(lost|inactive|former|retraction|rejected|cancelled|closed|blocked)/i.test(value)) return 4
  if (/^(draft|qualify|prospect|new|pending|minor)$/i.test(value)) return 0
  if (/^(review|propose|negotiate|material|partner|in_progress)$/i.test(value)) return 1
  return 2
}

/** A column default as a person reads it: 'draft'::text is draft. */
export const defaultText = (expression: string): string =>
  expression.match(/^'((?:[^']|'')*)'::/)?.[1]?.replaceAll("''", "'") ?? expression

/** A field whose name says it holds more than a line: notes, a body, a summary. */
export const readsLong = (name: string): boolean =>
  /(notes?|description|body|wording|content|summary|details|bio|text)$/.test(name)
