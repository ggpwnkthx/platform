import { type Catalog, labelColumn, type RelationReach, tableOf } from '@platform/core'
import type { Field } from './types.ts'

/**
 * How a record reaches the rows of a relation: through a column of its own, or through a
 * table of links. The same reach searches their names and tests their fields.
 */
export function reachOf(catalog: Catalog, field: Field): RelationReach | null {
  if (field.link) {
    const path = field.link.path
    return { ...path, label: labelOf(catalog, path.target_schema, path.target_table) }
  }
  if (field.relation) {
    const { target_schema, target_table } = field.relation
    return {
      kind: 'column',
      schema: target_schema,
      table: target_table,
      column: field.name,
      id: 'id',
      label: labelOf(catalog, target_schema, target_table),
    }
  }
  return null
}

/** How each relation of a collection is reached, by the name of the field. */
export const reachesOf = (catalog: Catalog, fields: Field[]): Record<string, RelationReach> =>
  Object.fromEntries(
    fields.flatMap((field) => {
      const reach = reachOf(catalog, field)
      return reach ? [[field.name, reach]] : []
    })
  )

/** The table the rows of a relation live in, and the table the links live in. */
export const targetOf = (reach: RelationReach): { schema: string; table: string } =>
  reach.kind === 'column'
    ? { schema: reach.schema, table: reach.table }
    : { schema: reach.target_schema, table: reach.target_table }

/** The name the rows of a collection are known by, where the reader may read them. */
const labelOf = (catalog: Catalog, schema: string, table: string): string | undefined => {
  if (!tableOf(catalog, schema, table)?.can_select) return undefined
  return labelColumn(catalog, schema, table) ?? undefined
}
