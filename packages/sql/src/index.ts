/**
 * The SQL the platform writes, written once.
 *
 * The operator's tools and the interface both build SQL — a manifest applied to a database,
 * a collection made in the browser — and they must build it the same way: the same name has
 * to mean the same column, and the same literal the same value, whichever wrote it. This
 * module has no dependencies and runs in the browser, in Bun and in Node.
 */

const encoder = new TextEncoder()

/** A name or a value PostgreSQL would not take as it stands. */
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

/** A schema and a table, as one qualified name. */
export const qualified = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`

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

/**
 * The item a metadata row names: a workspace, a collection, or a field of one. A field is a
 * column of a collection, so it names both.
 */
export interface MetadataTarget {
  scope: 'workspace' | 'collection' | 'field'
  schema: string
  table: string | null
  column: string | null
}

/** The workspace named by a schema. */
export const workspaceTarget = (schema: string): MetadataTarget => ({
  scope: 'workspace',
  schema,
  table: null,
  column: null,
})

/** The collection named by a schema and a table. */
export const collectionTarget = (schema: string, table: string): MetadataTarget => ({
  scope: 'collection',
  schema,
  table,
  column: null,
})

/** The field named by a schema, a table and a column. */
export const fieldTarget = (schema: string, table: string, column: string): MetadataTarget => ({
  scope: 'field',
  schema,
  table,
  column,
})

/**
 * The statement that sets one metadata key of an item, and the statement that removes it.
 * The interface writes an item's metadata through them, so the reader is shown the same
 * statement a psql session would run, and runs exactly that.
 */
export function metadataStatement(target: MetadataTarget, key: string, value: unknown): string {
  return `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES (${literal(target.scope)}, ${literal(target.schema)}, ${literal(target.table)}, ${literal(target.column)}, ${literal(key)}, ${literal(JSON.stringify(value ?? null))}::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;`
}

/** The statement that removes one metadata key of an item. */
export function metadataRemoval(target: MetadataTarget, key: string): string {
  return `DELETE FROM platform.item_metadata
 WHERE scope = ${literal(target.scope)} AND schema_name = ${literal(target.schema)}
   AND table_name IS NOT DISTINCT FROM ${literal(target.table)}
   AND column_name IS NOT DISTINCT FROM ${literal(target.column)}
   AND key = ${literal(key)};`
}
