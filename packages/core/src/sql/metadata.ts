import { type RawBuilder, sql } from 'kysely'
import { InvalidName, lit, stmt } from './kit.ts'

export type MetadataScope = 'workspace' | 'collection' | 'field'
export interface MetadataTarget {
  scope: MetadataScope
  schema: string
  table: string | null
  column: string | null
}
export const workspaceTarget = (schema: string): MetadataTarget => ({
  scope: 'workspace',
  schema,
  table: null,
  column: null,
})
export const collectionTarget = (schema: string, table: string): MetadataTarget => ({
  scope: 'collection',
  schema,
  table,
  column: null,
})
export const fieldTarget = (schema: string, table: string, column: string): MetadataTarget => ({
  scope: 'field',
  schema,
  table,
  column,
})

export const viewsKey = 'views'
export const renderersKey = 'renderers'
export const viewModes = ['show', 'hide', 'readonly'] as const
export type ViewMode = (typeof viewModes)[number]
export const defaultViews = { list: 'show', record: 'show', filter: 'show' } as const

/** The row that holds one saying of one item: its place, its key, and what was said. */
export const metadataColumns = 'scope, schema_name, table_name, column_name, key, value'
/** The key of an item's saying: its place, and its key. */
export const metadataConflict =
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

/**
 * The same saying, written once: what an owner has since said of an item is theirs to keep.
 * The statement is given as text and parameters, so the caller may ask whether it wrote.
 */
export const metadataStatementOnce = (
  target: MetadataTarget,
  key: string,
  value: unknown
): { text: string; params: unknown[] } => ({
  text: `INSERT INTO platform.item_metadata (${metadataColumns})
VALUES ($1,$2,$3,$4,$5,$6::jsonb)
ON CONFLICT ${metadataConflict}
DO NOTHING`,
  params: [
    target.scope,
    target.schema,
    target.table,
    target.column,
    key,
    JSON.stringify(value ?? null),
  ],
})
export const metadataRemoval = (t: MetadataTarget, key: string) =>
  stmt`DELETE FROM platform.item_metadata
 WHERE scope = ${lit(t.scope)} AND schema_name = ${lit(t.schema)}
   AND table_name IS NOT DISTINCT FROM ${lit(t.table)}
   AND column_name IS NOT DISTINCT FROM ${lit(t.column)} AND key = ${lit(key)}`
/** A null value takes the key away; anything else is written. */
export const metadataStatements = (
  target: MetadataTarget,
  changes: readonly { key: string; value: unknown }[]
) =>
  changes.map((change) =>
    change.value === null
      ? metadataRemoval(target, change.key)
      : metadataStatement(target, change.key, change.value)
  )
/** Where a field appears. Every field carries its own saying, so nothing is inferred. */
export function fieldViewsStatement(target: MetadataTarget, views: Record<string, string> = {}) {
  for (const [name, mode] of Object.entries(views))
    if (!viewModes.includes(mode as ViewMode))
      throw new InvalidName(`${name}: a view is shown, hidden or shown and locked`)
  return metadataStatement(target, viewsKey, { ...defaultViews, ...views })
}
export const fieldsViewsStatement = (targets: readonly MetadataTarget[]) =>
  upsert(targets.map((target) => targetRow(target, viewsKey, defaultViews)))
