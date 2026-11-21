import { InvalidName } from '../errors.ts'
import { literal } from '../core.ts'
import { defaultViews, renderersKey, viewModes, viewsKey, type ViewMode } from './keys.ts'
import type { MetadataTarget } from './targets.ts'

/**
 * The statement that gives a field its own views. Every field the platform makes carries
 * one, so that where it appears is said of the field itself and not left to be inferred.
 * A saying of the owner's own is laid over the default: the three the interface draws are
 * always there.
 */
export function fieldViewsStatement(
  target: MetadataTarget,
  views?: Record<string, string>
): string {
  for (const [name, mode] of Object.entries(views ?? {}))
    if (!viewModes.includes(mode as ViewMode))
      throw new InvalidName(`${name}: a view is shown, hidden or shown and locked`)
  return metadataStatement(target, viewsKey, { ...defaultViews, ...views })
}

/**
 * The statement that gives a field its own value renderers: how its values are drawn in each
 * situation, where the situation is a place the field is drawn — the records grid, the record
 * form, the filter builder — or a view of the owner's own.
 *
 * The renderer of a situation is either the name of a renderer or an object naming one and
 * the options it takes. A saying the platform cannot read is kept as it was written: the
 * platform draws a value it cannot name as it draws every value.
 */
export function fieldRenderersStatement(
  target: MetadataTarget,
  renderers?: Record<string, unknown>
): string {
  return metadataStatement(target, renderersKey, renderers ?? {})
}

/**
 * The statement that gives several fields their own views at once: the fields every
 * collection is made with, or the fields of a collection that have no saying yet.
 */
export function fieldsViewsStatement(targets: readonly MetadataTarget[]): string {
  if (!targets.length) return ''
  if (targets.length === 1) return fieldViewsStatement(targets[0]!)
  const rows = targets.map(
    (target) =>
      `  (${literal(target.scope)}, ${literal(target.schema)}, ${literal(target.table)}, ${literal(target.column)}, ${literal(viewsKey)}, ${literal(JSON.stringify(defaultViews))}::jsonb)`
  )
  return `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES
${rows.join(',\n')}
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;`
}

/**
 * The statement that sets one metadata key of an item, and the statement that removes it.
 * The interface writes an item's metadata through them, so the reader is shown the same
 * statement a psql session would run, and runs exactly that.
 */
export function metadataStatement(target: MetadataTarget, key: string, value: unknown): string {
  return `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES (${literal(target.scope)}, ${literal(target.schema)}, ${literal(target.table)}, ${literal(target.column)}, ${literal(key)}, ${literal(JSON.stringify(value ?? null))}::jsonb)
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value;`
}

/** The statement that removes one metadata key of an item. */
export function metadataRemoval(target: MetadataTarget, key: string): string {
  return `DELETE FROM platform.item_metadata
 WHERE scope = ${literal(target.scope)} AND schema_name = ${literal(target.schema)}
   AND table_name IS NOT DISTINCT FROM ${literal(target.table)}
   AND column_name IS NOT DISTINCT FROM ${literal(target.column)}
   AND key = ${literal(key)};`
}
