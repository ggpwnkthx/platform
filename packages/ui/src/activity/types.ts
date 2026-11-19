/** What PostgreSQL records about a revision of a row. */

export interface ActivityInfo {
  id: number
  at: string
  transaction_id: number
  actor: string
  schema_name: string
  table_name: string
  operation: string
  before_row: Record<string, unknown> | null
  after_row: Record<string, unknown> | null
}
