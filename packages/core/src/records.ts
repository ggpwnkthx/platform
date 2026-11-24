import type { Db } from './db.ts'
import { k, sql } from './sql/kit.ts'
import { run } from './records/query.ts'
import { predicate } from './records/conditions.ts'
import type { Filter, RelationReach } from './records/query.ts'

export {
  countLinked,
  insertRecordWithLinks,
  linkedRows,
  setLinks,
} from './records/links.ts'
export { namesOf } from './records/names.ts'

export interface RecordQuery {
  schema: string
  table: string
  columns: string[]
  searchable?: string[]
  filter?: Filter
  /** How each relation of the collection is reached, for the conditions that cross one. */
  reaches?: Record<string, RelationReach>
  search?: string
  /** Column names; a leading `-` sorts descending. */
  sort?: string[]
  limit: number
  offset?: number
}
/** A page of records and the count of rows the same predicate allows under row security. */
export async function records(db: Db, q: RecordQuery) {
  const where = predicate({
    filter: q.filter ?? {},
    search: q.search ?? '',
    searchable: q.searchable ?? [],
    base: { schema: q.schema, table: q.table },
    reaches: q.reaches ?? {},
  })
  let page = k.withSchema(q.schema).selectFrom(q.table).select(q.columns).where(where)
  for (const name of q.sort ?? [])
    page = page.orderBy(name.replace(/^-/, ''), (o) =>
      (name.startsWith('-') ? o.desc() : o.asc()).nullsLast()
    )
  const rows = await run(db, page.limit(q.limit).offset(q.offset ?? 0))
  const counted = await run<{ total: number }>(
    db,
    k
      .withSchema(q.schema)
      .selectFrom(q.table)
      .select(sql<number>`count(*)::int`.as('total'))
      .where(where)
  )
  return { rows: rows.rows, total: counted.rows[0]?.total ?? 0 }
}

export async function record(db: Db, schema: string, table: string, columns: string[], id: string) {
  const found = await run(
    db,
    k.withSchema(schema).selectFrom(table).select(columns).where('id', '=', id)
  )
  return found.rows[0] ?? null
}

// Writes carry no RETURNING: the right to write a column is not a right to read it back.
export async function insertRecord(db: Db, schema: string, table: string, values: object) {
  const into = k.withSchema(schema).insertInto(table)
  const query = Object.keys(values).length ? into.values(values) : into.defaultValues()
  return (await run(db, query)).rowCount ?? 0
}

/** An update made from a record the reader opened is guarded by the version they saw. */
export async function updateRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  values: object,
  version?: number | string
) {
  if (!Object.keys(values).length) return 0
  let query = k.withSchema(schema).updateTable(table).set(values).where('id', '=', id)
  if (version !== undefined) query = query.where('version', '=', version)
  return (await run(db, query)).rowCount ?? 0
}
export async function deleteRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  version?: number | string
) {
  let query = k.withSchema(schema).deleteFrom(table).where('id', '=', id)
  if (version !== undefined) query = query.where('version', '=', version)
  return (await run(db, query)).rowCount ?? 0
}
