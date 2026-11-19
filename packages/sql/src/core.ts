/**
 * The names and the values the platform writes, written once.
 *
 * The operator's tools and the interface both build SQL — a manifest applied to a database,
 * a collection made in the browser — and they must build it the same way: the same name has
 * to mean the same column, and the same literal the same value, whichever wrote it. This
 * module has no dependencies and runs in the browser, in Bun and in Node.
 */

import { InvalidName } from './errors.ts'

const encoder = new TextEncoder()

/** A quoted identifier. A name PostgreSQL would truncate or cannot hold is refused. */
export function ident(name: string): string {
  if (!name || name.includes('\0') || encoder.encode(name).length > 63) throw new InvalidName()
  return `"${name.replaceAll('"', '""')}"`
}

/** A schema and a table, as one qualified name. */
export const qualified = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`

/** The statement that makes a workspace's schema, and the role that owns it. */
export function schemaStatement(name: string, owner: string | null): string {
  return `CREATE SCHEMA ${ident(name)}${owner ? ` AUTHORIZATION ${role(owner)}` : ''};`
}

/** A role in a statement: always quoted, because emails are role names here. */
export const role = (name: string) => ident(name)

/**
 * A string literal. Backslashes are escaped and the string is written as E'...', so that it
 * means the same whatever the session's standard_conforming_strings is set to.
 */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (text.includes('\0')) throw new InvalidName('A value cannot contain NUL')
  return `E'${text.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

/**
 * The name a relation's constraint carries. The interface and the operator's tools both
 * build it, so that a model made in one and a manifest applied in the other agree on what
 * already exists.
 */
export async function constraintName(table: string, field: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${table}\0${field}`)
  )
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `fk_${hex.slice(0, 24)}`
}

/** The columns every collection is made with, by platform.create_collection. */
export const systemFields = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]

/** The column types a field may have, and the PostgreSQL type each one is. */
export const columnTypes = {
  text: 'text',
  integer: 'integer',
  bigint: 'bigint',
  decimal: 'numeric',
  float: 'double precision',
  boolean: 'boolean',
  uuid: 'uuid',
  date: 'date',
  time: 'time',
  timestamp: 'timestamptz',
  json: 'jsonb',
} as const

export type ColumnType = keyof typeof columnTypes

/**
 * A type a field may have: one of the platform's own, or any type the database holds —
 * `geometry` and `geography` where PostGIS is installed, an enum or a domain of the
 * installation's own. A type outside the platform's list is named with the schema it lives
 * in, so that it means the same thing wherever the statement runs.
 */
export type TypeName = ColumnType | (string & {})

/**
 * The column type a field of this type is stored as. A relation is a foreign key, which is
 * a uuid, and a string is a text: the two names the platform's own manifests and the
 * interface's drafts use for them mean the same column.
 */
export function storageType(type: string): TypeName {
  if (type === 'relation' || type === 'm2o') return 'uuid'
  if (type === 'string') return 'text'
  return type
}

/** The platform's own type, or nothing: a type of any other name is the database's. */
const builtIn = (type: string): string | null =>
  Object.hasOwn(columnTypes, type) ? columnTypes[type as ColumnType] : null

/**
 * A type as a statement writes it. The platform's own types are written as PostgreSQL knows
 * them; any other type is written as a quoted name, qualified with the schema it lives in
 * when it is named that way.
 */
export function typeSql(type: string, modifiers: readonly string[] = []): string {
  const name = builtIn(type) ?? qualifiedType(type)
  if (!modifiers.length) return name
  return `${name}(${modifiers.map(modifierSql).join(', ')})`
}

/** A type name: a bare name, or a name qualified with the schema it lives in. */
function qualifiedType(type: string): string {
  const parts = type.split('.')
  if (parts.length > 2 || parts.some((part) => !part.trim()))
    throw new InvalidName(`${type} is not a type name`)
  return parts.map((part) => ident(part.trim())).join('.')
}

/**
 * A type modifier: a count as PostgreSQL counts it, or a name as PostgreSQL knows it.
 * `Point` and `4326` are the modifiers of a geometry.
 */
function modifierSql(modifier: string): string {
  const text = modifier.trim()
  if (/^\d+$/.test(text)) return text
  return ident(text)
}

/** A column, as the interface and the manifests describe it. */
export interface ColumnSpec {
  name: string
  type: TypeName
  /** The type's own modifiers: `Point, 4326` for a geometry. */
  modifiers?: string[]
  required?: boolean
  unique?: boolean
  /** A default, as its type would read it. */
  default?: string
  maxLength?: number
  choices?: string[]
  min?: number
  max?: number
}

/**
 * A default value as the column's type would read it. A number or a boolean is written as
 * it is; anything else is a literal.
 */
export function defaultLiteral(type: TypeName, value: unknown, name = ''): string {
  if (value === null || value === undefined || value === '') return ''
  if (['integer', 'bigint', 'decimal', 'float'].includes(type)) {
    if (typeof value === 'number') return String(value)
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(String(value)))
      throw new InvalidName(`${name}: the default is not a number`)
    return String(value)
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (!/^(true|false)$/i.test(String(value)))
      throw new InvalidName(`${name}: the default is true or false`)
    return String(value).toUpperCase()
  }
  return literal(value)
}

/**
 * The column definition: type, default, NOT NULL, UNIQUE and the CHECKs its options ask for.
 */
export function columnSql(spec: ColumnSpec): string {
  const name = ident(spec.name)
  let sql = `${name} ${typeSql(spec.type, spec.modifiers)}`
  if (spec.default) sql += ` DEFAULT ${spec.default}`
  if (spec.required) sql += ' NOT NULL'
  if (spec.unique) sql += ' UNIQUE'
  if (spec.maxLength !== undefined) sql += ` CHECK (char_length(${name}) <= ${spec.maxLength})`
  if (spec.choices?.length)
    sql += ` CHECK (${name} IN (${spec.choices.map((choice) => literal(choice)).join(', ')}))`
  if (spec.min !== undefined) sql += ` CHECK (${name} >= ${spec.min})`
  if (spec.max !== undefined) sql += ` CHECK (${name} <= ${spec.max})`
  return sql
}
