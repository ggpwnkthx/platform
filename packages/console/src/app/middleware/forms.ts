/**
 * The forms of the console, as a request carries them.
 */

import type { Context } from 'hono'

/** A form that was sent: its fields, by name. */
export interface SentForm {
  /** The first value of a field, or the empty string. */
  readonly get: (name: string) => string
  /** Every value of a field. */
  readonly all: (name: string) => string[]
  /** Whether the form carries a field. */
  readonly has: (name: string) => boolean
  /** The first value of every field. */
  readonly fields: Readonly<Record<string, string>>
}

/** Reads the form of a request. */
export async function formOf(c: Context): Promise<SentForm> {
  const data = await c.req.formData()
  const fields: Record<string, string> = {}
  for (const [name, value] of data.entries()) {
    if (typeof value === 'string' && !(name in fields)) fields[name] = value
  }
  return {
    get: (name) => {
      const value = data.get(name)
      return typeof value === 'string' ? value : ''
    },
    all: (name) => data.getAll(name).filter((value): value is string => typeof value === 'string'),
    has: (name) => data.has(name),
    fields,
  }
}

/** The values of a list of text: one per line or per comma, without the empty ones. */
export function listOf(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}
