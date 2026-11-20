import {
  type DataSource,
  type MetadataEntry,
  type MetadataRow,
  type MetadataTarget,
  metadataRemoval,
  metadataStatement,
  presentationKeys,
} from '@platform/vocabulary'

/**
 * The metadata of an item: what a workspace, a collection or a field is, as opposed to what it
 * holds.
 *
 * Every row is read and written as the reader, so PostgreSQL's own row security decides who
 * reaches it: a reader sees the metadata of the items they may reach — a workspace they may
 * use, a collection they hold a right on, a field they hold a right on — and only the owner
 * of an item may change it. Nothing here decides a right.
 */

/** The metadata of one item, as its owner and its readers may see it. */
export async function metadata(db: DataSource, target: MetadataTarget) {
  const result = await db.query<MetadataEntry>(
    `SELECT key, value, version::int AS version, updated_at::text AS updated_at, updated_by
       FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2
        AND table_name IS NOT DISTINCT FROM $3::text
        AND column_name IS NOT DISTINCT FROM $4::text
      ORDER BY key`,
    [target.scope, target.schema, target.table, target.column]
  )
  return result.rows
}

/**
 * The metadata of every field of a collection, as one read. PostgreSQL returns the rows of the
 * fields the reader may reach and no others, so a field they may not read is not named here.
 */
export async function fieldMetadata(db: DataSource, schema: string, table: string) {
  const result = await db.query<MetadataRow>(
    `SELECT scope, schema_name, table_name, column_name, key, value
       FROM platform.item_metadata
      WHERE scope = 'field' AND schema_name = $1 AND table_name = $2
      ORDER BY column_name, key`,
    [schema, table]
  )
  return result.rows
}

/**
 * The presentation of every item the reader may reach: the name, the icon and the colour of
 * each workspace, collection and field. Row security decides which of them come back, so this
 * is the reader's own answer and no more.
 */
export async function presentations(db: DataSource): Promise<MetadataRow[]> {
  const result = await db.query<MetadataRow>(
    `SELECT scope, schema_name, table_name, column_name, key, value
       FROM platform.item_metadata
      WHERE key = ANY($1::text[])`,
    [[...presentationKeys]]
  )
  return result.rows
}

/** Sets one key; with a version, only if the key still carries it. */
export async function setMetadata(
  db: DataSource,
  target: MetadataTarget,
  key: string,
  value: unknown,
  version?: number
) {
  const params: unknown[] = [
    target.scope,
    target.schema,
    target.table,
    target.column,
    key,
    JSON.stringify(value === undefined ? null : value),
  ]
  const sql =
    version === undefined
      ? `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
         DO UPDATE SET value = EXCLUDED.value`
      : `UPDATE platform.item_metadata SET value = $6::jsonb
          WHERE scope = $1 AND schema_name = $2
            AND table_name IS NOT DISTINCT FROM $3::text
            AND column_name IS NOT DISTINCT FROM $4::text
            AND key = $5 AND version = $7`
  if (version !== undefined) params.push(version)
  return (await db.query(sql, params)).affected ?? 0
}

export async function removeMetadata(db: DataSource, target: MetadataTarget, key: string) {
  const result = await db.query(
    `DELETE FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2
        AND table_name IS NOT DISTINCT FROM $3::text
        AND column_name IS NOT DISTINCT FROM $4::text AND key = $5`,
    [target.scope, target.schema, target.table, target.column, key]
  )
  return result.affected ?? 0
}

/** One change to an item's metadata: a value to set, or null to remove the key. */
export interface MetadataChange {
  key: string
  /** Any JSON value: text, a number, an object. Null removes the key. */
  value: unknown
}

/**
 * The statements that carry an item's metadata changes: what the reader is shown, and what
 * runs, as them, in one transaction.
 */
export function metadataStatements(
  target: MetadataTarget,
  changes: readonly MetadataChange[]
): string[] {
  return changes.map((change) =>
    change.value === null
      ? metadataRemoval(target, change.key)
      : metadataStatement(target, change.key, change.value)
  )
}
