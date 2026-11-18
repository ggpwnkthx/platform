import { metadataRemoval, metadataStatement } from '@platform/sql'
import type { Db } from './connect.ts'
import type { MetadataEntry, MetadataRow } from './types.ts'
import { presentationKeys } from './types.ts'

/**
 * The metadata of an item: what a workspace or a collection is, as opposed to what it holds.
 *
 * Every row is read and written as the reader, so PostgreSQL's own row security decides who
 * reaches it: a reader sees the metadata of the items they may reach, and only the owner of
 * an item may change it. Nothing here decides a right.
 */

/** The metadata of one item, as its owner and its readers may see it. */
export async function metadata(db: Db, schema: string, table: string | null) {
  const result = await db.query<MetadataEntry>(
    `SELECT key, value, version::int AS version, updated_at::text AS updated_at, updated_by
       FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2 AND table_name IS NOT DISTINCT FROM $3::text
      ORDER BY key`,
    [table === null ? 'workspace' : 'collection', schema, table]
  )
  return result.rows
}

/**
 * The presentation of every item the reader may reach: the name, the icon and the colour of
 * each workspace and collection. Row security decides which of them come back, so this is the
 * reader's own answer and no more.
 */
export async function presentations(db: Db): Promise<MetadataRow[]> {
  const result = await db.query<MetadataRow>(
    `SELECT scope, schema_name, table_name, key, value
       FROM platform.item_metadata
      WHERE key = ANY($1::text[])`,
    [[...presentationKeys]]
  )
  return result.rows
}

/** Sets one key; with a version, only if the key still carries it. */
export async function setMetadata(
  db: Db,
  schema: string,
  table: string | null,
  key: string,
  value: unknown,
  version?: number
) {
  const params: unknown[] = [
    table === null ? 'workspace' : 'collection',
    schema,
    table,
    key,
    JSON.stringify(value === undefined ? null : value),
  ]
  const sql =
    version === undefined
      ? `INSERT INTO platform.item_metadata (scope, schema_name, table_name, key, value)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (scope, schema_name, coalesce(table_name, ''), key)
         DO UPDATE SET value = EXCLUDED.value`
      : `UPDATE platform.item_metadata SET value = $5::jsonb
          WHERE scope = $1 AND schema_name = $2 AND table_name IS NOT DISTINCT FROM $3::text
            AND key = $4 AND version = $6`
  if (version !== undefined) params.push(version)
  return (await db.query(sql, params)).affected ?? 0
}

export async function removeMetadata(db: Db, schema: string, table: string | null, key: string) {
  const result = await db.query(
    `DELETE FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2 AND table_name IS NOT DISTINCT FROM $3::text AND key = $4`,
    [table === null ? 'workspace' : 'collection', schema, table, key]
  )
  return result.affected ?? 0
}

/** One change to an item's metadata: a value to set, or null to remove the key. */
export interface MetadataChange {
  key: string
  value: string | null
}

/**
 * The statements that carry an item's metadata changes: what the reader is shown, and what
 * runs, as them, in one transaction.
 */
export function metadataStatements(
  schema: string,
  table: string | null,
  changes: readonly MetadataChange[]
): string[] {
  const scope = table === null ? 'workspace' : 'collection'
  return changes.map((change) =>
    change.value === null
      ? metadataRemoval(scope, schema, table, change.key)
      : metadataStatement(scope, schema, table, change.key, change.value)
  )
}
