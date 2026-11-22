import type pg from 'pg'
import { z } from 'zod'
import { constraintName, qualified, relationStatement } from '@platform/vocabulary'

const onDelete = z.enum(['restrict', 'cascade', 'set_null'])
export const relationSchema = z.object({
  collection: z.string(),
  field: z.string(),
  related: z.string(),
  on_delete: onDelete.optional(),
  onDelete: onDelete.optional(),
})

/** The foreign key of a field, when the collection does not have it yet. */
export async function addRelation(
  q: pg.Client,
  schema: string,
  table: string,
  field: string,
  related: string,
  onDelete: 'restrict' | 'cascade' | 'set_null'
) {
  const name = await constraintName(table, field)
  const found = await q.query(
    `SELECT 1 FROM pg_constraint
    WHERE conrelid=to_regclass($1) AND conname=$2`,
    [qualified(schema, table), name]
  )
  if (found.rowCount) return false
  await q.query(await relationStatement(schema, table, field, related, onDelete))
  return true
}
