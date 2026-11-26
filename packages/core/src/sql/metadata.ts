import { type RawBuilder, sql } from 'kysely'
import { InvalidName, lit, stmt } from './kit.ts'

export type MetadataScope = 'schema' | 'table' | 'column'
export interface MetadataTarget {
  scope: MetadataScope
  schema: string
  table: string | null
  column: string | null
}
export const schemaTarget = (schema: string): MetadataTarget => ({
  scope: 'schema',
  schema,
  table: null,
  column: null,
})
export const tableTarget = (schema: string, table: string): MetadataTarget => ({
  scope: 'table',
  schema,
  table,
  column: null,
})
export const columnTarget = (schema: string, table: string, column: string): MetadataTarget => ({
  scope: 'column',
  schema,
  table,
  column,
})

export const viewsKey = 'views'
export const renderersKey = 'renderers'
export const viewModes = ['show', 'hide', 'readonly'] as const
export type ViewMode = (typeof viewModes)[number]
export const defaultViews = { list: 'show', row: 'show', filter: 'show' } as const

/** The row that holds one saying of one item: its place, its key, and what was said. */
export const metadataColumns = 'scope, schema_name, table_name, column_name, key, value'
/** The key of an item's saying: its place, and its key. */
const metadataConflict =
  "(scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)"

const targetRow = (t: MetadataTarget, key: string, value: unknown) =>
  sql`(${lit(t.scope)}, ${lit(t.schema)}, ${lit(t.table)}, ${lit(t.column)}, ${lit(key)}, ${lit(JSON.stringify(value ?? null))}::jsonb)`
const upsert = (rows: RawBuilder<unknown>[]) =>
  stmt`INSERT INTO platform.item_metadata (${sql.raw(metadataColumns)})
VALUES ${sql.join(rows, sql.raw(',\n       '))}
ON CONFLICT ${sql.raw(metadataConflict)}
DO UPDATE SET value = EXCLUDED.value`
export const metadataStatement = (target: MetadataTarget, key: string, value: unknown) =>
  upsert([targetRow(target, key, value)])

export const metadataRemoval = (t: MetadataTarget, key: string) =>
  stmt`DELETE FROM platform.item_metadata
 WHERE scope = ${lit(t.scope)} AND schema_name = ${lit(t.schema)}
   AND table_name IS NOT DISTINCT FROM ${lit(t.table)}
   AND column_name IS NOT DISTINCT FROM ${lit(t.column)} AND key = ${lit(key)}`
/** Where a column appears: what the owner says, over the default of appearing everywhere. */
export function columnViewsStatement(target: MetadataTarget, views: Record<string, string> = {}) {
  for (const [name, mode] of Object.entries(views))
    if (!viewModes.includes(mode as ViewMode))
      throw new InvalidName(`${name}: a view is shown, hidden or shown and locked`)
  return metadataStatement(target, viewsKey, { ...defaultViews, ...views })
}
