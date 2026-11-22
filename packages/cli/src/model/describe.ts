import type pg from 'pg'
import type { MetadataTarget } from '@platform/vocabulary'

/** Told what an additive apply did, and what it found already in place. */
export type Report = { changed(what: string): void; same(): void }
export const silent: Report = { changed: () => undefined, same: () => undefined }

/**
 * Gives an item the metadata it does not have yet. A key that is already there is left
 * alone: its owner may have changed it since, and a manifest is applied again and again.
 */
export async function describeItem(
  q: pg.Client,
  target: MetadataTarget,
  metadata: Record<string, unknown>,
  report: Report = silent
) {
  const said: string[] = []
  for (const [key, value] of Object.entries(metadata)) {
    const written = await q.query(
      `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)
      ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
      DO NOTHING`,
      [target.scope, target.schema, target.table, target.column, key, JSON.stringify(value ?? null)]
    )
    if (written.rowCount) said.push(key)
    else report.same()
  }
  if (!said.length) return
  const item = [target.schema, target.table, target.column].filter(Boolean).join('.')
  report.changed(`describe ${target.scope} ${item}: ${said.join(', ')}`)
}
