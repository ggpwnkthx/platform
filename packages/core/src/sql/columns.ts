import { id, list, lit, pgName, sql, stmt } from './kit.ts'
import { columnSql, type ColumnSpec, type OnDelete, onDeleteActions } from './column.ts'
import { columnTarget, columnViewsStatement, metadataStatement, renderersKey } from './metadata.ts'
export * from './column.ts'

export const relationStatement = (
  schema: string,
  table: string,
  column: string,
  related: string,
  onDelete: OnDelete = 'restrict',
  name?: string
) =>
  stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? pgName(`${table}_${column}_fkey`)
  )} FOREIGN KEY (${id(column)}) REFERENCES ${id(schema, related)} (id) ON DELETE ${sql.raw(onDeleteActions[onDelete] ?? 'RESTRICT')}`

/**
 * The index a foreign key needs: PostgreSQL makes no index for the key it does not make.
 * Without it, every row that points at this one is found by a scan of the whole table,
 * and the same is true of the parent that goes away.
 */
export const relationIndexStatement = (schema: string, table: string, column: string) =>
  stmt`CREATE INDEX ON ${id(schema, table)} (${id(column)})`

/**
 * The columns whose lookups a unique index already serves: the first column of a pair that
 * is unique together is found by that index, and needs no index of its own.
 */
export const coveredByUnique = (groups: readonly (readonly string[])[]) =>
  new Set(groups.filter((group) => group.length > 1).map((group) => group[0]!))

/** Everything a new column is: the column, its index, its key, its note and its sayings. */
export function columnStatements(
  schema: string,
  table: string,
  column: ColumnSpec,
  withRelation = true,
  withIndex = true
): string[] {
  const target = columnTarget(schema, table, column.name)
  const out = [stmt`ALTER TABLE ${id(schema, table)} ADD COLUMN ${columnSql(column)}`]
  if (column.indexed && !column.unique)
    out.push(stmt`CREATE INDEX ON ${id(schema, table)} (${id(column.name)})`)
  if (column.relation && withRelation) {
    out.push(relationStatement(schema, table, column.name, column.relation, column.onDelete))
    // The key is indexed, unless an index over the column is already made for it.
    if (withIndex && !column.indexed) out.push(relationIndexStatement(schema, table, column.name))
  }
  if (column.note?.trim())
    out.push(
      stmt`COMMENT ON COLUMN ${id(schema, table, column.name)} IS ${lit(column.note.trim())}`
    )
  // A column that says nothing appears everywhere: only what narrows that is written.
  if (Object.keys(column.views ?? {}).length) out.push(columnViewsStatement(target, column.views))
  if (column.renderers && Object.keys(column.renderers).length)
    out.push(metadataStatement(target, renderersKey, column.renderers))
  return out
}
export const createTableStatements = (schema: string, name: string): string[] => [
  stmt`SELECT platform.create_table(${lit(schema)}, ${lit(name)})`,
]
export function tableStatements(
  schema: string,
  name: string,
  note: string,
  columns: readonly ColumnSpec[],
  unique: readonly (readonly string[])[] = []
): string[] {
  const out = createTableStatements(schema, name)
  const covered = coveredByUnique(unique)
  // Relations come last: a table may point at itself, or at a column made after it.
  for (const column of columns) out.push(...columnStatements(schema, name, column, false))
  for (const column of columns)
    if (column.relation) {
      out.push(relationStatement(schema, name, column.name, column.relation, column.onDelete))
      // The key is indexed, unless a unique index over the pair already serves the lookup.
      if (!covered.has(column.name)) out.push(relationIndexStatement(schema, name, column.name))
    }
  // The pairs that are unique together: what makes a join table a link and not a copy.
  for (const group of unique)
    if (group.length > 1) out.push(uniqueIndexStatement(schema, name, [...group]))
  if (note.trim()) out.push(commentTableStatement(schema, name, note))
  return out
}
export const dropColumnStatement = (schema: string, table: string, column: string) =>
  stmt`ALTER TABLE ${id(schema, table)} DROP COLUMN ${id(column)}` /** The columns that are unique together: an index PostgreSQL holds, or a pair a join needs. */
export const uniqueIndexStatement = (schema: string, table: string, columns: string[]) =>
  stmt`CREATE UNIQUE INDEX ON ${id(schema, table)} (${list(columns.map((column) => id(column)))})`

/** What PostgreSQL calls a relation in a statement about it, by the letter its catalog keeps. */
export const relationWord = (kind = 'r') =>
  sql.raw(kind === 'v' ? 'VIEW' : kind === 'm' ? 'MATERIALIZED VIEW' : 'TABLE')
export const dropTableStatement = (schema: string, table: string, kind = 'r') =>
  stmt`DROP ${relationWord(kind)} ${id(schema, table)}`
export const commentTableStatement = (schema: string, table: string, note: string, kind = 'r') =>
  stmt`COMMENT ON ${relationWord(kind)} ${id(schema, table)} IS ${lit(note.trim() || null)}`
