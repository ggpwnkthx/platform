import {
  type DataSource,
  type MetadataEntry,
  type MetadataRow,
  type MetadataTarget,
  literal,
  metadataConflict,
  metadataOf,
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

/**
 * A workspace that keeps no metadata the reader may reach has none to read: it was made
 * before workspaces kept their own and its owner has not given it its collection, or the
 * reader may not use the workspace at all. Either way the answer is nothing, as it is for a
 * row that row security withholds — not an error.
 */
async function none<T>(reading: Promise<T[]>): Promise<T[]> {
  try {
    return await reading
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    // No such table, no such schema, no right on either.
    if (code === '42P01' || code === '3F000' || code === '42501') return []
    throw error
  }
}

/** The metadata of one item, as its owner and its readers may see it. */
export async function metadata(db: DataSource, target: MetadataTarget) {
  return none(
    db
      .query<MetadataEntry>(
        `SELECT key, value, version::int AS version, updated_at::text AS updated_at, updated_by
           FROM ${metadataOf(target.schema)}
          WHERE scope = $1
            AND table_name IS NOT DISTINCT FROM $2::text
            AND column_name IS NOT DISTINCT FROM $3::text
          ORDER BY key`,
        [target.scope, target.table, target.column]
      )
      .then((result) => result.rows)
  )
}

/**
 * The metadata of every field of a collection, as one read. PostgreSQL returns the rows of the
 * fields the reader may reach and no others, so a field they may not read is not named here.
 */
export async function fieldMetadata(db: DataSource, schema: string, table: string) {
  return none(
    db
      .query<MetadataRow>(
        `SELECT scope, $1::text AS schema_name, table_name, column_name, key, value
           FROM ${metadataOf(schema)}
          WHERE scope = 'field' AND table_name = $2
          ORDER BY column_name, key`,
        [schema, table]
      )
      .then((result) => result.rows)
  )
}

/**
 * The presentation of every item the reader may reach: the name, the icon and the colour of
 * each workspace, collection and field. Every workspace keeps its own, so the question is
 * asked of each workspace that keeps metadata the reader may reach — the catalog says which —
 * in one statement. Row security decides which rows come back, so this is the reader's own
 * answer and no more.
 */
export async function presentations(
  db: DataSource,
  schemas: readonly string[]
): Promise<MetadataRow[]> {
  if (!schemas.length) return []
  const parts = schemas.map(
    (schema) =>
      `SELECT scope, ${literal(schema)}::text AS schema_name, table_name, column_name, key, value
         FROM ${metadataOf(schema)} WHERE key = ANY($1::text[])`
  )
  const result = await db.query<MetadataRow>(parts.join('\n UNION ALL\n'), [[...presentationKeys]])
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
    target.table,
    target.column,
    key,
    JSON.stringify(value === undefined ? null : value),
  ]
  const sql =
    version === undefined
      ? `INSERT INTO ${metadataOf(target.schema)} (scope, table_name, column_name, key, value)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT ${metadataConflict}
         DO UPDATE SET value = EXCLUDED.value`
      : `UPDATE ${metadataOf(target.schema)} SET value = $5::jsonb
          WHERE scope = $1
            AND table_name IS NOT DISTINCT FROM $2::text
            AND column_name IS NOT DISTINCT FROM $3::text
            AND key = $4 AND version = $6`
  if (version !== undefined) params.push(version)
  return (await db.query(sql, params)).affected ?? 0
}

export async function removeMetadata(db: DataSource, target: MetadataTarget, key: string) {
  const result = await db.query(
    `DELETE FROM ${metadataOf(target.schema)}
      WHERE scope = $1
        AND table_name IS NOT DISTINCT FROM $2::text
        AND column_name IS NOT DISTINCT FROM $3::text AND key = $4`,
    [target.scope, target.table, target.column, key]
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
