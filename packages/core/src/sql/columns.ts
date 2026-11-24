import { id, list, lit, pgName, sql, stmt } from './kit.ts'
import {
  columnSql,
  type FieldSpec,
  type OnDelete,
  onDeleteActions,
  systemFields,
} from './column.ts'
import {
  fieldsViewsStatement,
  fieldTarget,
  fieldViewsStatement,
  metadataStatement,
  renderersKey,
} from './metadata.ts'
export * from './column.ts'

export const relationStatement = (
  schema: string,
  table: string,
  field: string,
  related: string,
  onDelete: OnDelete = 'restrict',
  name?: string
) =>
  stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? pgName(`${table}_${field}_fkey`)
  )} FOREIGN KEY (${id(field)}) REFERENCES ${id(schema, related)} (id) ON DELETE ${sql.raw(onDeleteActions[onDelete] ?? 'RESTRICT')}`

/**
 * The index a foreign key needs: PostgreSQL makes no index for the key it does not make.
 * Without it, every row that points at this one is found by a scan of the whole table,
 * and the same is true of the parent that goes away.
 */
export const relationIndexStatement = (schema: string, table: string, field: string) =>
  stmt`CREATE INDEX ON ${id(schema, table)} (${id(field)})`

/**
 * The fields whose lookups a unique index already serves: the first field of a pair that
 * is unique together is found by that index, and needs no index of its own.
 */
export const coveredByUnique = (groups: readonly (readonly string[])[]) =>
  new Set(groups.filter((group) => group.length > 1).map((group) => group[0]!))

/**
 * The same, by the collection each field is in: a field named `article` in one collection
 * is not the field named `article` in another, and the unique index over the pair of one
 * says nothing about the other.
 */
export const coveredFields = (
  collections: readonly { name: string; unique: readonly (readonly string[])[] }[]
) =>
  new Set(
    collections.flatMap((collection) =>
      collection.unique
        .filter((group) => group.length > 1)
        .map((group) => `${collection.name}.${group[0]!}`)
    )
  )

/** Everything a new field is: the column, its index, its key, its note and its sayings. */
export function fieldStatements(
  schema: string,
  table: string,
  field: FieldSpec,
  withRelation = true,
  withIndex = true
): string[] {
  const target = fieldTarget(schema, table, field.name)
  const out = [stmt`ALTER TABLE ${id(schema, table)} ADD COLUMN ${columnSql(field)}`]
  if (field.indexed && !field.unique)
    out.push(stmt`CREATE INDEX ON ${id(schema, table)} (${id(field.name)})`)
  if (field.relation && withRelation) {
    out.push(relationStatement(schema, table, field.name, field.relation, field.onDelete))
    // The key is indexed, unless an index over the field is already made for it.
    if (withIndex && !field.indexed) out.push(relationIndexStatement(schema, table, field.name))
  }
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
  fields: readonly FieldSpec[],
  unique: readonly (readonly string[])[] = []
): string[] {
  const out = createCollectionStatements(schema, name)
  const covered = coveredByUnique(unique)
  // Relations come last: a collection may point at itself, or at a field made after it.
  for (const field of fields) out.push(...fieldStatements(schema, name, field, false))
  for (const field of fields)
    if (field.relation) {
      out.push(relationStatement(schema, name, field.name, field.relation, field.onDelete))
      // The key is indexed, unless a unique index over the pair already serves the lookup.
      if (!covered.has(field.name)) out.push(relationIndexStatement(schema, name, field.name))
    }
  // The pairs that are unique together: what makes a join table a link and not a copy.
  for (const group of unique)
    if (group.length > 1) out.push(uniqueIndexStatement(schema, name, [...group]))
  if (note.trim()) out.push(commentCollectionStatement(schema, name, note))
  return out
}
export const dropFieldStatement = (schema: string, table: string, field: string) =>
  stmt`ALTER TABLE ${id(schema, table)} DROP COLUMN ${id(field)}` /** The columns that are unique together: an index PostgreSQL holds, or a pair a join needs. */
export const uniqueIndexStatement = (schema: string, table: string, columns: string[]) =>
  stmt`CREATE UNIQUE INDEX ON ${id(schema, table)} (${list(columns.map((column) => id(column)))})`

export const dropCollectionStatement = (schema: string, table: string) =>
  stmt`DROP TABLE ${id(schema, table)}`
export const commentCollectionStatement = (schema: string, table: string, note: string) =>
  stmt`COMMENT ON TABLE ${id(schema, table)} IS ${lit(note.trim() || null)}`
