/**
 * The model, written as the statements PostgreSQL runs.
 *
 * The operator's tools apply a manifest to a database; the interface makes a collection in
 * the browser. They must make the same model: the same field has to be the same column, and
 * the same constraint, or a model made in one and a manifest applied in the other disagree
 * about what exists. The column itself is the vocabulary's business, in `core.ts`; what is
 * written around it — the statement that adds it, the index, the relation, the comment and
 * the field's own saying of where it appears — is written here, once.
 *
 * This module has no dependencies and runs in the browser, in Bun and in Node.
 */

import {
  columnSql as columnDefinition,
  constraintName,
  defaultLiteral,
  ident,
  literal,
  qualified,
  storageType,
  systemFields,
  type TypeName,
} from './core.ts'
import { onDeleteAction, type OnDelete } from './dcl.ts'
import { InvalidName } from './errors.ts'
import {
  fieldRenderersStatement,
  fieldsViewsStatement,
  fieldTarget,
  fieldViewsStatement,
  metadataSetupStatement,
} from './metadata.ts'

/**
 * A field of a collection, as it is written: the shape a draft in the interface and a field
 * in a manifest both take once they have been read.
 */
export interface FieldSpec {
  /** The name of the column. */
  name: string
  /** The type of the field: one of the platform's own, or one the database holds. */
  type: TypeName
  /** The type's own modifiers: `Point, 4326` for a geometry. */
  modifiers?: string[]
  required?: boolean
  unique?: boolean
  /** Whether the field is indexed; a unique field is indexed already. */
  indexed?: boolean
  /** The default value, as its type would read it. */
  default?: unknown
  maxLength?: number
  choices?: string[]
  min?: number
  max?: number
  /** What the column is called, in a comment. */
  note?: string
  /** The collection a relation points at, in the same workspace. */
  relation?: string | null
  /** What happens to the rows that point at a row that is gone. */
  onDelete?: OnDelete
  /** Where the field appears, when the owner says otherwise. */
  views?: Record<string, string>
  /** How the field's values are drawn, when the owner says otherwise. */
  renderers?: Record<string, unknown>
}

/**
 * The column a field is stored as: the column definition, with the platform's own rules.
 * A relation is a foreign key, which is a uuid, and a string is a text: the two names the
 * platform's manifests and the interface's drafts use for them mean the same column.
 */
export function fieldColumnSql(field: FieldSpec): string {
  if (systemFields.includes(field.name))
    throw new InvalidName(`${field.name} is made with every collection`)
  const type = storageType(field.type)
  return columnDefinition({
    name: field.name,
    type,
    modifiers: field.modifiers,
    required: field.required,
    unique: field.unique,
    default: defaultLiteral(type, field.default, field.name),
    maxLength: field.maxLength,
    choices: field.choices,
    min: field.min,
    max: field.max,
  })
}

/** The statement that adds a field's column to a collection. */
export function addFieldStatement(schema: string, table: string, field: FieldSpec): string {
  return `ALTER TABLE ${qualified(schema, table)} ADD COLUMN ${fieldColumnSql(field)};`
}

/** The statement that indexes a field's column, when it is indexed and not unique. */
export function indexFieldStatement(
  schema: string,
  table: string,
  field: FieldSpec
): string | null {
  if (!field.indexed || field.unique) return null
  return `CREATE INDEX ON ${qualified(schema, table)} (${ident(field.name)});`
}

/**
 * The statement that points a field's column at another collection. The constraint carries
 * the name the platform gives it, so that the interface and the operator's tools name it
 * the same and agree on whether it is already there.
 */
export async function relationStatement(
  schema: string,
  table: string,
  field: string,
  related: string,
  onDelete: OnDelete = 'restrict'
): Promise<string> {
  const name = await constraintName(table, field)
  return `ALTER TABLE ${qualified(schema, table)} ADD CONSTRAINT ${ident(name)}
  FOREIGN KEY (${ident(field)}) REFERENCES ${qualified(schema, related)} (id) ON DELETE ${onDeleteAction(onDelete)};`
}

/** The statement that says what a field is called, in a comment. */
export function commentFieldStatement(
  schema: string,
  table: string,
  field: FieldSpec
): string | null {
  const note = field.note?.trim()
  if (!note) return null
  return `COMMENT ON COLUMN ${qualified(schema, table)}.${ident(field.name)} IS ${literal(note)};`
}

/**
 * Every statement that adds one field to a collection: the column itself, the index, the
 * relation, the comment, and the field's own saying of where it appears.
 */
export async function fieldStatements(
  schema: string,
  table: string,
  field: FieldSpec
): Promise<string[]> {
  const target = fieldTarget(schema, table, field.name)
  const out = [addFieldStatement(schema, table, field)]
  const index = indexFieldStatement(schema, table, field)
  if (index) out.push(index)
  if (field.relation)
    out.push(await relationStatement(schema, table, field.name, field.relation, field.onDelete))
  const comment = commentFieldStatement(schema, table, field)
  if (comment) out.push(comment)
  // Every field carries its own views: where it appears is said of the field itself.
  out.push(fieldViewsStatement(target, field.views))
  if (field.renderers && Object.keys(field.renderers).length)
    out.push(fieldRenderersStatement(target, field.renderers))
  return out
}

/** Every statement that makes a collection: the platform's table, then each field. */
export async function collectionStatements(
  schema: string,
  name: string,
  note: string,
  fields: readonly FieldSpec[]
): Promise<string[]> {
  const out = [`SELECT platform.create_collection(${literal(schema)}, ${literal(name)});`]
  // The fields say where they appear in the workspace's own metadata: a workspace made
  // before it kept its own is given its collection here, and one that has it is left as it is.
  out.push(metadataSetupStatement(schema))
  // Every field carries its own views: the ones the platform makes, and the ones the
  // reader adds below.
  out.push(fieldsViewsStatement(systemFields.map((column) => fieldTarget(schema, name, column))))
  for (const field of fields) out.push(...(await fieldStatements(schema, name, field)))
  const comment = commentCollectionStatement(schema, name, note)
  if (comment) out.push(comment)
  return out
}

/** The statement that removes a field. */
export function dropFieldStatement(schema: string, table: string, field: string): string {
  return `ALTER TABLE ${qualified(schema, table)} DROP COLUMN ${ident(field)};`
}

/** The statement that removes a collection. */
export function dropCollectionStatement(schema: string, table: string): string {
  return `DROP TABLE ${qualified(schema, table)};`
}

/** The statement that says what a collection is called, in a comment. */
export function commentCollectionStatement(schema: string, table: string, note: string): string {
  const text = note.trim()
  return `COMMENT ON TABLE ${qualified(schema, table)} IS ${text ? literal(text) : 'NULL'};`
}
