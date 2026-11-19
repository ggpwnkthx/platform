import {
  columnSql as columnDefinition,
  constraintName,
  defaultLiteral,
  ident,
  InvalidName,
  literal,
  qualified,
  systemFields,
  type ColumnType,
} from '@platform/sql'

/**
 * The model, written as the statements PostgreSQL runs. A builder in the interface produces
 * a draft; the draft becomes these statements, which are shown before they run and are run,
 * as the reader, exactly as shown. PostgreSQL decides whether the reader may.
 */

export type FieldType =
  | 'text'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'relation'

/** The column type a field of this type is stored as: a relation is a uuid. */
const columnType = (type: FieldType): ColumnType => (type === 'relation' ? 'uuid' : type)

export const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Text',
  integer: 'Whole number',
  bigint: 'Large whole number',
  decimal: 'Exact decimal',
  float: 'Floating point',
  boolean: 'Yes / no',
  date: 'Date',
  time: 'Time of day',
  timestamp: 'Moment (with time zone)',
  uuid: 'UUID',
  json: 'JSON document',
  relation: 'Relation to another collection',
}

export type OnDelete = 'restrict' | 'cascade' | 'set_null'

export interface FieldDraft {
  name: string
  type: FieldType
  required: boolean
  unique: boolean
  indexed: boolean
  /** A default value, as typed; empty for none. */
  default: string
  note: string
  maxLength?: number
  choices?: string[]
  min?: number
  max?: number
  /** The collection a relation points at, in the same workspace. */
  relation?: string
  onDelete?: OnDelete
}

export function emptyField(): FieldDraft {
  return {
    name: '',
    type: 'text',
    required: false,
    unique: false,
    indexed: false,
    default: '',
    note: '',
  }
}

/** The column definition: type, default, NOT NULL, UNIQUE and the CHECKs its options ask for. */
function columnSql(field: FieldDraft): string {
  if (systemFields.includes(field.name))
    throw new InvalidName(`${field.name} is made with every collection`)
  const type = columnType(field.type)
  return columnDefinition({
    name: field.name,
    type,
    required: field.required,
    unique: field.unique,
    default: defaultLiteral(type, field.default.trim(), field.name),
    maxLength: field.maxLength,
    choices: field.choices,
    min: field.min,
    max: field.max,
  })
}

const onDeleteSql: Record<OnDelete, string> = {
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  set_null: 'SET NULL',
}

/** The statements that add one field to a collection. */
export async function fieldStatements(
  schema: string,
  table: string,
  field: FieldDraft
): Promise<string[]> {
  const target = qualified(schema, table)
  const out = [`ALTER TABLE ${target} ADD COLUMN ${columnSql(field)};`]
  if (field.indexed && !field.unique) out.push(`CREATE INDEX ON ${target} (${ident(field.name)});`)
  if (field.type === 'relation') {
    if (!field.relation) throw new InvalidName(`${field.name}: choose the collection it points at`)
    out.push(
      `ALTER TABLE ${target} ADD CONSTRAINT ${ident(await constraintName(table, field.name))}
  FOREIGN KEY (${ident(field.name)}) REFERENCES ${qualified(schema, field.relation)} (id) ON DELETE ${onDeleteSql[field.onDelete ?? 'restrict']};`
    )
  }
  if (field.note.trim())
    out.push(`COMMENT ON COLUMN ${target}.${ident(field.name)} IS ${literal(field.note.trim())};`)
  return out
}

/** The statements that make a collection: the platform's table, then each field. */
export async function collectionStatements(
  schema: string,
  name: string,
  note: string,
  fields: FieldDraft[]
): Promise<string[]> {
  qualified(schema, name)
  const out = [`SELECT platform.create_collection(${literal(schema)}, ${literal(name)});`]
  for (const field of fields) out.push(...(await fieldStatements(schema, name, field)))
  if (note.trim())
    out.push(`COMMENT ON TABLE ${qualified(schema, name)} IS ${literal(note.trim())};`)
  return out
}

export function dropFieldStatement(schema: string, table: string, field: string): string {
  return `ALTER TABLE ${qualified(schema, table)} DROP COLUMN ${ident(field)};`
}

export function dropCollectionStatement(schema: string, table: string): string {
  return `DROP TABLE ${qualified(schema, table)};`
}

export function commentStatement(schema: string, table: string, note: string): string {
  return `COMMENT ON TABLE ${qualified(schema, table)} IS ${note.trim() ? literal(note.trim()) : 'NULL'};`
}
