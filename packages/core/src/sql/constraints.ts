import { id, InvalidName, list, pgName, sql, stmt } from './kit.ts'
import { type OnDelete, onDeleteActions } from './columns.ts'

/**
 * The constraints a collection holds, and the statements that make and take them away.
 *
 * PostgreSQL keeps them: a check, a unique key, a foreign key, and the emptiness a column
 * is held by. The platform names them the way PostgreSQL names its own, so a constraint
 * written here and one written by hand read the same in the catalog.
 */

/** The name PostgreSQL gives a unique key: the table, its fields, and `_key`. */
export const uniqueName = (table: string, columns: string[]) =>
  pgName(`${table}_${columns.join('_')}_key`)
/** The name PostgreSQL gives a check: the table, the field it is about, and `_check`. */
export const checkName = (table: string, column?: string) =>
  pgName(column ? `${table}_${column}_check` : `${table}_check`)
/** The name PostgreSQL gives a foreign key: the table, the field, and `_fkey`. */
export const foreignKeyName = (table: string, column: string) => pgName(`${table}_${column}_fkey`)
/** The name PostgreSQL gives an index: the table, its fields, and `_idx`. */
export const indexName = (table: string, columns: string[]) =>
  pgName(`${table}_${columns.join('_')}_idx`)

/** A unique key over one or more fields: the row is held once. */
export const uniqueConstraintStatement = (
  schema: string,
  table: string,
  columns: string[],
  name?: string
) => {
  if (!columns.length) throw new InvalidName('Choose at least one field.')
  return stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? uniqueName(table, columns)
  )} UNIQUE (${list(columns.map((column) => id(column)))})`
}

/**
 * A check: the expression PostgreSQL tests every row by. The expression is the owner's own
 * SQL, as a policy's is, and PostgreSQL is the judge of what it may hold.
 */
export const checkConstraintStatement = (
  schema: string,
  table: string,
  expression: string,
  name?: string,
  column?: string
) => {
  const body = expression.trim()
  if (!body) throw new InvalidName('Say what the check tests.')
  return stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? checkName(table, column)
  )} CHECK (${sql.raw(body)})`
}

/** A foreign key: the row this one points at, and what happens when that row goes. */
export const foreignKeyStatement = (
  schema: string,
  table: string,
  column: string,
  target: { schema: string; table: string },
  onDelete: OnDelete = 'restrict',
  name?: string
) =>
  stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? foreignKeyName(table, column)
  )} FOREIGN KEY (${id(column)}) REFERENCES ${id(target.schema, target.table)} (id) ON DELETE ${sql.raw(
    onDeleteActions[onDelete] ?? 'RESTRICT'
  )}`

/** A field that may not be empty. */
export const notNullStatement = (schema: string, table: string, column: string) =>
  stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} SET NOT NULL`

/** A field that may be empty again. The rows that are empty stay. */
export const dropNotNullStatement = (schema: string, table: string, column: string) =>
  stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} DROP NOT NULL`

/** A constraint taken away: the rows are left, and the rule with them. */
export const dropConstraintStatement = (schema: string, table: string, name: string) =>
  stmt`ALTER TABLE ${id(schema, table)} DROP CONSTRAINT ${id(name)}`

/** An index over one or more fields: the rows that hold them are found without a scan. */
export const indexStatement = (
  schema: string,
  table: string,
  columns: string[],
  unique = false,
  name?: string
) => {
  if (!columns.length) throw new InvalidName('Choose at least one field.')
  return stmt`CREATE ${sql.raw(unique ? 'UNIQUE ' : '')}INDEX ${id(
    name ?? indexName(table, columns)
  )} ON ${id(schema, table)} (${list(columns.map((column) => id(column)))})`
}

/** An index taken away. The rows are left; only the way to them is. */
export const dropIndexStatement = (schema: string, name: string) =>
  stmt`DROP INDEX ${id(schema, name)}`
