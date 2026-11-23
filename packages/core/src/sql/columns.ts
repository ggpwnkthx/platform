import { id, InvalidName, list, lit, sql, stmt } from './kit.ts'
import {
  fieldsViewsStatement,
  fieldTarget,
  fieldViewsStatement,
  metadataStatement,
  renderersKey,
} from './metadata.ts'

export const systemFields = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]
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
export const onDeleteActions = { restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' }
export type OnDelete = keyof typeof onDeleteActions

export interface FieldSpec {
  name: string
  type: string
  modifiers?: string[]
  required?: boolean
  unique?: boolean
  indexed?: boolean
  default?: unknown
  maxLength?: number
  choices?: string[]
  min?: number
  max?: number
  note?: string
  relation?: string | null
  onDelete?: OnDelete
  views?: Record<string, string>
  renderers?: Record<string, unknown>
}

/** A relation is stored as the uuid it points at; `string` is the manifests' word for text. */
const storageType = (type: string) =>
  type === 'relation' || type === 'm2o' ? 'uuid' : type === 'string' ? 'text' : type
/** One of the platform's own types, or any type the database holds, named with its schema. */
function typeSql(type: string, modifiers: readonly string[] = []) {
  const parts = type.split('.').map((part) => part.trim())
  if (parts.length > 2 || parts.some((part) => !part))
    throw new InvalidName(`${type} is not a type name`)
  const name =
    type in columnTypes ? sql.raw(columnTypes[type as keyof typeof columnTypes]) : id(...parts)
  if (!modifiers.length) return name
  const given = modifiers.map((m) => (/^\d+$/.test(m.trim()) ? sql.raw(m.trim()) : id(m.trim())))
  return sql`${name}(${list(given)})`
}
function defaultSql(type: string, value: unknown, name: string) {
  if (['integer', 'bigint', 'decimal', 'float'].includes(type)) {
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(String(value)))
      throw new InvalidName(`${name}: the default is not a number`)
    return sql.raw(String(value))
  }
  if (type === 'boolean') {
    if (!/^(true|false)$/i.test(String(value)))
      throw new InvalidName(`${name}: the default is true or false`)
    return sql.raw(String(value).toUpperCase())
  }
  return lit(value)
}
function columnSql(field: FieldSpec) {
  if (systemFields.includes(field.name))
    throw new InvalidName(`${field.name} is made with every collection`)
  const name = id(field.name)
  const type = storageType(field.type)
  const number = (value: number) => {
    if (!Number.isFinite(value)) throw new InvalidName(`${field.name}: not a number`)
    return sql.raw(String(value))
  }
  const parts = [sql`${name} ${typeSql(type, field.modifiers)}`]
  if (field.default !== undefined && field.default !== null && field.default !== '')
    parts.push(sql`DEFAULT ${defaultSql(type, field.default, field.name)}`)
  if (field.required) parts.push(sql.raw('NOT NULL'))
  if (field.unique) parts.push(sql.raw('UNIQUE'))
  if (field.maxLength !== undefined)
    parts.push(sql`CHECK (char_length(${name}) <= ${number(field.maxLength)})`)
  if (field.choices?.length)
    parts.push(sql`CHECK (${name} IN (${list(field.choices.map((choice) => lit(choice)))}))`)
  if (field.min !== undefined) parts.push(sql`CHECK (${name} >= ${number(field.min)})`)
  if (field.max !== undefined) parts.push(sql`CHECK (${name} <= ${number(field.max)})`)
  return sql.join(parts, sql.raw(' '))
}
/** A real foreign key to another collection of the same workspace, named by PostgreSQL. */
export const relationStatement = (
  schema: string,
  table: string,
  field: string,
  related: string,
  onDelete: OnDelete = 'restrict'
) =>
  stmt`ALTER TABLE ${id(schema, table)} ADD FOREIGN KEY (${id(field)}) REFERENCES ${id(schema, related)} (id) ON DELETE ${sql.raw(onDeleteActions[onDelete] ?? 'RESTRICT')}`

/** Everything a new field is: the column, its index, its key, its note and its sayings. */
export function fieldStatements(
  schema: string,
  table: string,
  field: FieldSpec,
  withRelation = true
): string[] {
  const target = fieldTarget(schema, table, field.name)
  const out = [stmt`ALTER TABLE ${id(schema, table)} ADD COLUMN ${columnSql(field)}`]
  if (field.indexed && !field.unique)
    out.push(stmt`CREATE INDEX ON ${id(schema, table)} (${id(field.name)})`)
  if (field.relation && withRelation)
    out.push(relationStatement(schema, table, field.name, field.relation, field.onDelete))
  if (field.note?.trim())
    out.push(stmt`COMMENT ON COLUMN ${id(schema, table, field.name)} IS ${lit(field.note.trim())}`)
  out.push(fieldViewsStatement(target, field.views))
  if (field.renderers && Object.keys(field.renderers).length)
    out.push(metadataStatement(target, renderersKey, field.renderers))
  return out
}
export const createCollectionStatements = (schema: string, name: string): string[] => [
  stmt`SELECT platform.create_collection(${lit(schema)}, ${lit(name)})`,
  fieldsViewsStatement(systemFields.map((column) => fieldTarget(schema, name, column))),
]
export function collectionStatements(
  schema: string,
  name: string,
  note: string,
  fields: readonly FieldSpec[]
): string[] {
  const out = createCollectionStatements(schema, name)
  // Relations come last: a collection may point at itself, or at a field made after it.
  for (const field of fields) out.push(...fieldStatements(schema, name, field, false))
  for (const field of fields)
    if (field.relation)
      out.push(relationStatement(schema, name, field.name, field.relation, field.onDelete))
  if (note.trim()) out.push(commentCollectionStatement(schema, name, note))
  return out
}
export const dropFieldStatement = (schema: string, table: string, field: string) =>
  stmt`ALTER TABLE ${id(schema, table)} DROP COLUMN ${id(field)}`
export const dropCollectionStatement = (schema: string, table: string) =>
  stmt`DROP TABLE ${id(schema, table)}`
export const commentCollectionStatement = (schema: string, table: string, note: string) =>
  stmt`COMMENT ON TABLE ${id(schema, table)} IS ${lit(note.trim() || null)}`
