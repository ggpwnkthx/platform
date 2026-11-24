import { id, InvalidName, list, lit, sql } from './kit.ts'

/**
 * The column a field is: its type, its emptiness, its uniqueness and its defaults. The
 * rules PostgreSQL holds it by are part of the column itself, not a statement beside it.
 */

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
/** The letter PostgreSQL keeps a delete rule by: the same rules, as the catalog has them. */
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
export function columnSql(field: FieldSpec) {
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
