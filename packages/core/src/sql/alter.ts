import type { MetadataRow } from '../metadata.ts'
import { metadataColumns } from './metadata.ts'
import { id, InvalidName, lit, sql, stmt } from './kit.ts'
import { systemColumns } from './column.ts'
import { relationWord } from './columns.ts'

/**
 * What changes a thing that is already there: its name, its owner, a column's type and its
 * default, and a schema that goes. PostgreSQL keeps every other name that points at the
 * thing — a constraint, a policy, a view — in step by itself; the platform's own metadata names
 * its item by name, so a rename carries it across in the same transaction.
 */

/** Names the platform holds a meaning for: a table's own six columns, and its schema. */
function fresh(name: unknown, what: string) {
  const text = String(name ?? '').trim()
  if (!text) throw new InvalidName(`Name the ${what}.`)
  return text
}
export const renameSchemaStatement = (from: string, to: string) =>
  stmt`ALTER SCHEMA ${id(from)} RENAME TO ${id(fresh(to, 'schema'))}`
export const renameTableStatement = (schema: string, from: string, to: string, kind = 'r') =>
  stmt`ALTER ${relationWord(kind)} ${id(schema, from)} RENAME TO ${id(fresh(to, 'table'))}`
export function renameColumnStatement(schema: string, table: string, from: string, to: string) {
  if (systemColumns.includes(from))
    throw new InvalidName(`${from} is made with every table, and keeps its name.`)
  if (systemColumns.includes(to.trim()))
    throw new InvalidName(`${to} is a name every table holds already.`)
  return stmt`ALTER TABLE ${id(schema, table)} RENAME COLUMN ${id(from)} TO ${id(fresh(to, 'column'))}`
}
export const renameConstraintStatement = (
  schema: string,
  table: string,
  from: string,
  to: string
) =>
  stmt`ALTER TABLE ${id(schema, table)} RENAME CONSTRAINT ${id(from)} TO ${id(fresh(to, 'constraint'))}`
export const renameIndexStatement = (schema: string, from: string, to: string) =>
  stmt`ALTER INDEX ${id(schema, from)} RENAME TO ${id(fresh(to, 'index'))}`
export const renamePolicyStatement = (schema: string, table: string, from: string, to: string) =>
  stmt`ALTER POLICY ${id(from)} ON ${id(schema, table)} RENAME TO ${id(fresh(to, 'policy'))}`
export const renameRoleStatement = (from: string, to: string) =>
  stmt`ALTER ROLE ${id(from)} RENAME TO ${id(fresh(to, 'role'))}`

/** Who owns a schema or a table. The owner administers it; a group is the owner to choose. */
export const schemaOwnerStatement = (schema: string, owner: string) =>
  stmt`ALTER SCHEMA ${id(schema)} OWNER TO ${id(fresh(owner, 'owner'))}`
export const tableOwnerStatement = (schema: string, table: string, owner: string, kind = 'r') =>
  stmt`ALTER ${relationWord(kind)} ${id(schema, table)} OWNER TO ${id(fresh(owner, 'owner'))}`

/** A schema that goes. PostgreSQL refuses while anything is left in it (RESTRICT). */
export const dropSchemaStatement = (schema: string) => stmt`DROP SCHEMA ${id(schema)}`

/**
 * A column's new type. Without a conversion PostgreSQL converts each value as an assignment
 * would; with one, the expression is the owner's own SQL, as a check's is.
 */
export function columnTypeStatement(
  schema: string,
  table: string,
  column: string,
  type: string,
  using?: string | null
) {
  if (systemColumns.includes(column))
    throw new InvalidName(`${column} is made with every table, and keeps its type.`)
  const conversion = using?.trim()
  return stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} TYPE ${sql.raw(fresh(type, 'type'))}${sql.raw(
    conversion ? ` USING (${conversion})` : ''
  )}`
}
/** A column's default, as SQL: what a new row holds when nothing is given. Empty takes it away. */
export function columnDefaultStatement(
  schema: string,
  table: string,
  column: string,
  expression?: string | null
) {
  if (systemColumns.includes(column))
    throw new InvalidName(`${column} is made with every table, and keeps its default.`)
  const body = expression?.trim()
  return body
    ? stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} SET DEFAULT ${sql.raw(body)}`
    : stmt`ALTER TABLE ${id(schema, table)} ALTER COLUMN ${id(column)} DROP DEFAULT`
}

/**
 * The metadata of a renamed item, carried across. Row security lets the owner of an item
 * write its rows, and an item that is gone or not made yet is owned by nobody: so the rows
 * are taken away under the old name, before the rename, and written again under the new one
 * after it. The values are the ones the reader was shown, written as literals.
 */
export type Place = { schema: string; table?: string | null; column?: string | null }
export function metadataMove(rows: readonly MetadataRow[], from: Place, to: Place) {
  if (!rows.length) return { before: [], after: [] }
  const where = [
    sql`schema_name = ${lit(from.schema)}`,
    ...(from.table ? [sql`table_name = ${lit(from.table)}`] : []),
    ...(from.column ? [sql`scope = 'column' AND column_name = ${lit(from.column)}`] : []),
  ]
  const moved = rows.map((row) => {
    const same = (a: string | null | undefined, b: string | null | undefined) => !b || a === b
    const ours =
      same(row.schema_name, from.schema) &&
      same(row.table_name, from.table) &&
      same(row.column_name, from.column)
    if (!ours) throw new InvalidName('A saying of another item cannot move with this one.')
    return sql`(${lit(row.scope)}, ${lit(to.schema)}, ${lit(from.table && row.table_name === from.table ? (to.table ?? row.table_name) : row.table_name)}, ${lit(
      from.column && row.column_name === from.column
        ? (to.column ?? row.column_name)
        : row.column_name
    )}, ${lit(row.key)}, ${lit(JSON.stringify(row.value ?? null))}::jsonb)`
  })
  return {
    before: [stmt`DELETE FROM platform.item_metadata WHERE ${sql.join(where, sql.raw(' AND '))}`],
    after: [
      stmt`INSERT INTO platform.item_metadata (${sql.raw(metadataColumns)})
VALUES ${sql.join(moved, sql.raw(',\n       '))}`,
    ],
  }
}
/** A rename, with the item's metadata taken away before it and written again after it. */
export function carried(rows: readonly MetadataRow[], from: Place, to: Place, rename: string) {
  const move = metadataMove(rows, from, to)
  return [...move.before, rename, ...move.after]
}
