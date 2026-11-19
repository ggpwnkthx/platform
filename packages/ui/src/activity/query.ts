import type { Db } from '../pg/connect.ts'
import type { ActivityInfo } from './types.ts'

/** The revisions the reader may read: row security shows a workspace's owners its full history. */
export interface ActivityQuery {
  schema: string
  table?: string
  /** A row's id: its revisions only. */
  row?: string
  before?: number
  limit?: number
}

export async function activity(db: Db, query: ActivityQuery): Promise<ActivityInfo[]> {
  const values: unknown[] = [query.schema]
  const where = ['schema_name = $1']
  if (query.table) {
    values.push(query.table)
    where.push(`table_name = $${values.length}`)
  }
  if (query.row) {
    values.push(query.row)
    where.push(`(after_row->>'id' = $${values.length} OR before_row->>'id' = $${values.length})`)
  }
  if (query.before) {
    values.push(query.before)
    where.push(`id < $${values.length}`)
  }
  values.push(Math.min(query.limit ?? 100, 500))
  const result = await db.query<ActivityInfo>(
    `SELECT id, at::text AS at, transaction_id, actor, schema_name, table_name, operation,
            before_row, after_row
       FROM platform.activity WHERE ${where.join(' AND ')}
      ORDER BY id DESC LIMIT $${values.length}`,
    values
  )
  return result.rows
}
