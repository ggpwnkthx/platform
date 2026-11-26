import type { Catalog, JoinInfo, RelationInfo } from './types.ts'

/**
 * The relations of a table, read both ways: the row it points at, and the rows that
 * point at it. The catalog holds every foreign key the reader may see, so the second way
 * is the first read backwards — nothing else is asked of PostgreSQL.
 */

/** The relations that point at a table: the children of a one-to-many relation. */
export const inboundRelations = (catalog: Catalog, schema: string, table: string): RelationInfo[] =>
  catalog.relations.filter(
    (relation) => relation.target_schema === schema && relation.target_table === table
  )

/** The join tables a table has a side in. */
export const joinsOf = (catalog: Catalog, schema: string, table: string): JoinInfo[] =>
  catalog.joins.filter((join) => joinSide(join, schema, table) !== null)

/** Whether a table is a join: two keys, and nothing else. */
export const isJoinTable = (catalog: Catalog, schema: string, table: string): boolean =>
  catalog.joins.some((join) => join.schema === schema && join.table === table)

/** Which side of a join a table is on, if it is on one. */
export const joinSide = (
  join: JoinInfo,
  schema: string,
  table: string
): 'left' | 'right' | null => {
  if (join.left.target_schema === schema && join.left.target_table === table) return 'left'
  if (join.right.target_schema === schema && join.right.target_table === table) return 'right'
  return null
}

/** The other side of a join: the table it reaches, and the column that reaches it. */
export const otherSide = (
  join: JoinInfo,
  side: 'left' | 'right'
): { column: string; target_schema: string; target_table: string } =>
  side === 'left' ? join.right : join.left
