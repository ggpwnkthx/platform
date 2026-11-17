/**
 * Writing SQL text safely. Identifiers are quoted PostgreSQL names; values are always bound
 * as parameters, except in the statements a reader is shown to copy and run, which carry
 * literals so they read as written.
 */

const encoder = new TextEncoder()

export class InvalidName extends Error {
  constructor(message = 'Not a valid PostgreSQL name') {
    super(message)
    this.name = 'InvalidName'
  }
}

/** A quoted identifier. A name PostgreSQL would truncate or cannot hold is refused. */
export function ident(name: string): string {
  if (!name || name.includes('\0') || encoder.encode(name).length > 63) throw new InvalidName()
  return `"${name.replaceAll('"', '""')}"`
}

export const qualified = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`

/** A role in a statement: always quoted, because emails are role names here. */
export const role = (name: string) => ident(name)

/** A string literal, for statements that are shown before they run. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (text.includes('\0')) throw new InvalidName('A value cannot contain NUL')
  return `'${text.replaceAll("'", "''")}'`
}
