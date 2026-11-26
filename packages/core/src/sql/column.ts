import { id, InvalidName, list, lit, sql } from './kit.ts'

/**
 * The column a column is: its type, its emptiness, its uniqueness and its defaults. The
 * rules PostgreSQL holds it by are part of the column itself, not a statement beside it.
 */

export const systemColumns = [
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
  interval: 'interval',
  inet: 'inet',
  text_list: 'text[]',
  search: 'tsvector',
} as const
export const onDeleteActions = { restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' }
/** The letter PostgreSQL keeps a delete rule by: the same rules, as the catalog has them. */
export type OnDelete = keyof typeof onDeleteActions

export interface ColumnSpec {
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
  /** Computed by PostgreSQL from the row's other columns, in SQL: never written. */
  generated?: string
  /** Numbered by PostgreSQL, one more for each row: a whole number that is never written. */
  identity?: boolean
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
export function columnSql(column: ColumnSpec) {
  if (systemColumns.includes(column.name))
    throw new InvalidName(`${column.name} is made with every table`)
  const name = id(column.name)
  const type = storageType(column.type)
  const number = (value: number) => {
    if (!Number.isFinite(value)) throw new InvalidName(`${column.name}: not a number`)
    return sql.raw(String(value))
  }
  const parts = [sql`${name} ${typeSql(type, column.modifiers)}`]
  const generated = column.generated?.trim()
  if (generated) parts.push(sql`GENERATED ALWAYS AS (${sql.raw(generated)}) STORED`)
  else if (column.identity) {
    if (!['integer', 'bigint'].includes(type))
      throw new InvalidName(`${column.name}: only a whole number is numbered by PostgreSQL`)
    parts.push(sql.raw('GENERATED ALWAYS AS IDENTITY'))
  } else if (column.default !== undefined && column.default !== null && column.default !== '')
    parts.push(sql`DEFAULT ${defaultSql(type, column.default, column.name)}`)
  if (column.required) parts.push(sql.raw('NOT NULL'))
  if (column.unique) parts.push(sql.raw('UNIQUE'))
  if (column.maxLength !== undefined)
    parts.push(sql`CHECK (char_length(${name}) <= ${number(column.maxLength)})`)
  if (column.choices?.length)
    parts.push(sql`CHECK (${name} IN (${list(column.choices.map((choice) => lit(choice)))}))`)
  if (column.min !== undefined) parts.push(sql`CHECK (${name} >= ${number(column.min)})`)
  if (column.max !== undefined) parts.push(sql`CHECK (${name} <= ${number(column.max)})`)
  return sql.join(parts, sql.raw(' '))
}
/** A real foreign key to another table of the same schema, named by PostgreSQL. */
