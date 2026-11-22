import { type DataSource, ident, qualified } from '@platform/vocabulary'

/**
 * Writes a row. No RETURNING: the right to insert or update a column is not a right to read
 * it back, so a write reports how many rows it touched and nothing else.
 */
export async function insertRecord(
  db: DataSource,
  schema: string,
  table: string,
  values: Record<string, unknown>
) {
  const entries = Object.entries(values)
  const sql = entries.length
    ? `INSERT INTO ${qualified(schema, table)} (${entries.map(([k]) => ident(k)).join(', ')})
       VALUES (${entries.map((_, i) => `$${i + 1}`).join(', ')})`
    : `INSERT INTO ${qualified(schema, table)} DEFAULT VALUES`
  return (
    (
      await db.query(
        sql,
        entries.map(([, v]) => v)
      )
    ).affected ?? 0
  )
}

/** Changes a row, only if it still carries the version the reader saw. */
export async function updateRecord(
  db: DataSource,
  schema: string,
  table: string,
  id: string,
  values: Record<string, unknown>,
  version?: number
) {
  const entries = Object.entries(values)
  if (!entries.length) return 0
  const params: unknown[] = entries.map(([, v]) => v)
  params.push(id)
  let sql = `UPDATE ${qualified(schema, table)} SET ${entries
    .map(([k], i) => `${ident(k)} = $${i + 1}`)
    .join(', ')} WHERE id = $${params.length}`
  if (version !== undefined) {
    params.push(version)
    sql += ` AND version = $${params.length}`
  }
  return (await db.query(sql, params)).affected ?? 0
}

export async function deleteRecord(
  db: DataSource,
  schema: string,
  table: string,
  id: string,
  version?: number
) {
  const params: unknown[] = [id]
  let sql = `DELETE FROM ${qualified(schema, table)} WHERE id = $1`
  if (version !== undefined) {
    params.push(version)
    sql += ' AND version = $2'
  }
  return (await db.query(sql, params)).affected ?? 0
}
