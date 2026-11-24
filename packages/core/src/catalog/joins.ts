import { systemFields } from '../sql/columns.ts'
import type { ColumnInfo, IndexInfo, JoinInfo, RelationInfo } from './types.ts'

/**
 * The join tables among the relations: a table made of two foreign keys and nothing else,
 * with a unique index over both columns, is a link between two rows and not a copy of one.
 *
 * A link may carry payload: columns of its own, beside the two keys, holding what the link
 * is worth or when it began. The keys are what the pair is, and the unique index over them
 * is what makes the pair one link. A payload column is written by the database and not by
 * the link, so it must be nullable or hold a default of its own — otherwise a link written
 * without it would be refused, and the table is not a link this platform may write.
 */
export function joinsOf(
  relations: RelationInfo[],
  indexes: IndexInfo[],
  columns: ColumnInfo[]
): JoinInfo[] {
  const tables = new Map<string, RelationInfo[]>()
  for (const relation of relations) {
    const key = `${relation.schema}.${relation.table}`
    const held = tables.get(key)
    if (held) held.push(relation)
    else tables.set(key, [relation])
  }
  const joins: JoinInfo[] = []
  for (const [key, held] of tables) {
    if (held.length !== 2) continue
    const [left, right] = held as [RelationInfo, RelationInfo]
    // A join table is made of the two keys and the columns every collection is made with.
    const own = columns.filter(
      (column) =>
        column.schema === left.schema &&
        column.table === left.table &&
        !systemFields.includes(column.name)
    )
    // The two keys are columns of the table: a table whose keys are not its own is not one.
    const pair = new Set([left.column, right.column])
    if (!own.some((column) => column.name === left.column)) continue
    if (!own.some((column) => column.name === right.column)) continue
    // The payload: the columns of the link that are not its keys.
    const payload = own.filter((column) => !pair.has(column.name))
    if (payload.some((column) => column.required && !column.default)) continue
    const uniquePair = indexes.some(
      (index) =>
        index.unique &&
        index.schema === left.schema &&
        index.table === left.table &&
        index.columns.length === 2 &&
        pair.has(index.columns[0]!) &&
        pair.has(index.columns[1]!)
    )
    if (!uniquePair) continue
    const [schema = '', table = ''] = key.split('.')
    joins.push({
      schema,
      table,
      left: {
        column: left.column,
        target_schema: left.target_schema,
        target_table: left.target_table,
        target_column: left.target_column,
      },
      right: {
        column: right.column,
        target_schema: right.target_schema,
        target_table: right.target_table,
        target_column: right.target_column,
      },
      uniquePair,
      payload: payload.map((column) => column.name),
    })
  }
  return joins
}
