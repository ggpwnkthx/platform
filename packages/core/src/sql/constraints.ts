import { id, InvalidName, list, pgName, sql, stmt } from './kit.ts'
import { type OnDelete, onDeleteActions } from './columns.ts'

/**
 * The constraints a table holds, and the statements that make and take them away.
 *
 * PostgreSQL keeps them: a check, a unique key, a foreign key, and the emptiness a column
 * is held by. The platform names them the way PostgreSQL names its own, so a constraint
 * written here and one written by hand read the same in the catalog.
 */

/** The name PostgreSQL gives a unique key: the table, its columns, and `_key`. */
export const uniqueName = (table: string, columns: string[]) =>
  pgName(`${table}_${columns.join('_')}_key`)
/** The name PostgreSQL gives a check: the table, the column it is about, and `_check`. */
export const checkName = (table: string, column?: string) =>
  pgName(column ? `${table}_${column}_check` : `${table}_check`)
/** The name PostgreSQL gives a foreign key: the table, the column, and `_fkey`. */
export const foreignKeyName = (table: string, column: string) => pgName(`${table}_${column}_fkey`)
/** The name PostgreSQL gives an index: the table, its columns, and `_idx`. */
export const indexName = (table: string, columns: string[]) =>
  pgName(`${table}_${columns.join('_')}_idx`)

/** A unique key over one or more columns: the row is held once. */
export const uniqueConstraintStatement = (
  schema: string,
  table: string,
  columns: string[],
  name?: string
) => {
  if (!columns.length) throw new InvalidName('Choose at least one column.')
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
  column?: string,
  notValid = false
) => {
  const body = expression.trim()
  if (!body) throw new InvalidName('Say what the check tests.')
  return stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? checkName(table, column)
  )} CHECK (${sql.raw(body)})${sql.raw(notValid ? ' NOT VALID' : '')}`
}

/** How a foreign key behaves beside what happens when the row it points at goes. */
export interface KeyOptions {
  onUpdate?: OnDelete
  /** Checked at the end of the transaction rather than at each statement. */
  deferrable?: boolean
  /** Held for new rows only; the rows already there are checked when it is validated. */
  notValid?: boolean
}
const keyWords = (options: KeyOptions) =>
  sql.raw(
    (options.onUpdate && options.onUpdate !== 'restrict'
      ? ` ON UPDATE ${onDeleteActions[options.onUpdate]}`
      : '') +
      (options.deferrable ? ' DEFERRABLE INITIALLY DEFERRED' : '') +
      (options.notValid ? ' NOT VALID' : '')
  )

/** A foreign key: the row this one points at, and what happens when that row goes. */
export const foreignKeyStatement = (
  schema: string,
  table: string,
  column: string,
  target: { schema: string; table: string },
  onDelete: OnDelete = 'restrict',
  name?: string,
  options: KeyOptions = {}
) =>
  stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name ?? foreignKeyName(table, column)
  )} FOREIGN KEY (${id(column)}) REFERENCES ${id(target.schema, target.table)} (id) ON DELETE ${sql.raw(
    onDeleteActions[onDelete] ?? 'RESTRICT'
  )}${keyWords(options)}`

/** The rows already there, checked against a key or a check that was added NOT VALID. */
export const validateConstraintStatement = (schema: string, table: string, name: string) =>
  stmt`ALTER TABLE ${id(schema, table)} VALIDATE CONSTRAINT ${id(name)}`

/**
 * An exclusion: no two rows may hold values the operators say collide, such as two bookings of
 * one room whose times overlap. The definition is the owner's own SQL, after EXCLUDE.
 */
export function exclusionStatement(
  schema: string,
  table: string,
  definition: string,
  name?: string
) {
  const body = definition.trim()
  if (!body)
    throw new InvalidName('Say what may not collide: USING gist (room WITH =, during WITH &&).')
  return stmt`ALTER TABLE ${id(schema, table)} ADD CONSTRAINT ${id(
    name?.trim() || pgName(`${table}_excl`)
  )} EXCLUDE ${sql.raw(body)}`
}

/** A column that may not be empty. */
export const notNullStatement = (schema: string, table: string, column: string) =>
  stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} SET NOT NULL`

/** A column that may be empty again. The rows that are empty stay. */
export const dropNotNullStatement = (schema: string, table: string, column: string) =>
  stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} DROP NOT NULL`

/** A constraint taken away: the rows are left, and the rule with them. */
export const dropConstraintStatement = (schema: string, table: string, name: string) =>
  stmt`ALTER TABLE ${id(schema, table)} DROP CONSTRAINT ${id(name)}`

/** An index over one or more columns: the rows that hold them are found without a scan. */
export const indexStatement = (
  schema: string,
  table: string,
  columns: string[],
  unique = false,
  name?: string
) => {
  if (!columns.length) throw new InvalidName('Choose at least one column.')
  return stmt`CREATE ${sql.raw(unique ? 'UNIQUE ' : '')}INDEX ${id(
    name ?? indexName(table, columns)
  )} ON ${id(schema, table)} (${list(columns.map((column) => id(column)))})`
}

/** An index taken away. The rows are left; only the way to them is. */
export const dropIndexStatement = (schema: string, name: string) =>
  stmt`DROP INDEX ${id(schema, name)}`

export const indexMethods = ['btree', 'hash', 'gin', 'gist', 'spgist', 'brin'] as const
/** An index as PostgreSQL allows one: over columns or expressions, of a method, partial, covering. */
export interface IndexDraft {
  columns?: string[]
  /** Expressions in SQL, one to an item, in place of columns: lower(email). */
  expressions?: string[]
  unique?: boolean
  method?: (typeof indexMethods)[number]
  /** The columns it carries beside its key, so a read is answered by the index alone. */
  include?: string[]
  /** Only the rows this SQL holds for are in it. */
  where?: string
  name?: string
}
export function indexDraftStatement(schema: string, table: string, draft: IndexDraft) {
  const columns = draft.columns ?? []
  const expressions = (draft.expressions ?? []).map((e) => e.trim()).filter(Boolean)
  if (!columns.length && !expressions.length) throw new InvalidName('Choose at least one column.')
  const method = draft.method ?? 'btree'
  if (!indexMethods.includes(method)) throw new InvalidName(`${method} is not an index method`)
  const keys = [...columns.map((c) => id(c)), ...expressions.map((e) => sql.raw(`(${e})`))]
  const include = draft.include ?? []
  const where = draft.where?.trim()
  const name = draft.name?.trim() || indexName(table, columns.length ? columns : ['expr'])
  return stmt`CREATE ${sql.raw(draft.unique ? 'UNIQUE ' : '')}INDEX ${id(name)} ON ${id(schema, table)}${sql.raw(
    method === 'btree' ? '' : ` USING ${method}`
  )} (${list(keys)})${include.length ? sql` INCLUDE (${list(include.map((c) => id(c)))})` : sql.raw('')}${sql.raw(
    where ? ` WHERE ${where}` : ''
  )}`
}
