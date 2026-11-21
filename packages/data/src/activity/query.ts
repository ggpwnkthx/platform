import type { DataSource } from '@platform/vocabulary'
import type { ActivityInfo } from './types.ts'

/**
 * The revisions the reader may read: a workspace's owners read its history, and in each row
 * the columns they may read in the collection itself. platform.revisions decides both.
 */
export interface ActivityQuery {
  schema: string
  table?: string
  /** A row's id: its revisions only. */
  row?: string
  before?: number
  limit?: number
}

export async function activity(db: DataSource, query: ActivityQuery): Promise<ActivityInfo[]> {
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
  // fallow-ignore-next-line security-sink -- every value is bound as a parameter
  const result = await db.query<ActivityInfo>(
    `SELECT id, at::text AS at, transaction_id, actor, schema_name, table_name, operation,
            before_row, after_row
       FROM platform.revisions WHERE ${where.join(' AND ')}
      ORDER BY id DESC LIMIT $${values.length}`,
    values
  )
  return result.rows
}
