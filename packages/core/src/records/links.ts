import { columnsOf, labelColumn } from '../catalog/labels.ts'
import type { Catalog } from '../catalog/types.ts'
import { type Db, inTransaction } from '../db.ts'
import { id, k, list, sql } from '../sql/kit.ts'
import { asText, run } from './query.ts'
import type { RelationPath } from './query.ts'

/**
 * The links of a record: the rows it is linked to, through a join table or through the
 * table of children. The same path reads them, writes them, and filters by them.
 */

/** A row a record is linked to: its id, the name it is known by, and what the link carries. */
export interface LinkedRow {
  id: string
  label: string
  /** The columns of the link beside its two keys, when it carries any. */
  payload: Record<string, unknown> | null
}

/**
 * The rows a record is linked to, and how it is linked to them: the ids of the other side,
 * and the names they are known by. A relation is a join table, or the table of children.
 */
export async function linkedRows(
  db: Db,
  catalog: Catalog,
  path: RelationPath,
  baseId: string
): Promise<LinkedRow[]> {
  // The payload is read only where the reader may read it: a column they may not see is
  // not named in the statement, which PostgreSQL would refuse.
  const payload = (path.payload ?? []).filter((column) =>
    columnsOf(catalog, path.schema, path.table).some((one) => one.name === column && one.can_select)
  )
  const links = await run<Record<string, unknown>>(
    db,
    k
      .withSchema(path.schema)
      .selectFrom(path.table)
      .select([
        asText(path.target).as('id'),
        ...payload.map((column) => sql`${sql.ref(column)}`.as(column)),
      ])
      .where(path.fk, '=', baseId)
  )
  const ids = links.rows.map((row) => String(row.id))
  if (!ids.length) return []
  // The other row is found by the column the link's key points at: usually its `id`, but
  // a key made by hand may point at another column, and the row is found by that one.
  const key = path.target_column ?? 'id'
  const label = labelColumn(catalog, path.target_schema, path.target_table)
  const found = await run<{ id: string; label: string }>(
    db,
    k
      .withSchema(path.target_schema)
      .selectFrom(path.target_table)
      .select([asText(key).as('id'), (label ? asText(label) : asText(key)).as('label')])
      .where(asText(key), 'in', ids)
  ).catch(() => null) // a row policy or a column grant may refuse: the ids are shown instead
  const names = new Map((found?.rows ?? []).map((row) => [row.id, row.label]))
  return links.rows.map((row) => {
    const id = String(row.id)
    const carried: Record<string, unknown> = {}
    for (const column of payload) carried[column] = row[column]
    return { id, label: names.get(id) ?? id, payload: payload.length ? carried : null }
  })
}

/** How many rows a record is linked to. */
export async function countLinked(db: Db, path: RelationPath, baseId: string): Promise<number> {
  const counted = await run<{ total: number }>(
    db,
    k
      .withSchema(path.schema)
      .selectFrom(path.table)
      .select(sql<number>`count(*)::int`.as('total'))
      .where(path.fk, '=', baseId)
  )
  return counted.rows[0]?.total ?? 0
}

/**
 * The links of one record, held while they are written. Two editors of the same record
 * would otherwise overwrite each other's links: the second one writes the set it read,
 * and the first one's changes are gone.
 *
 * The lock is an advisory one, taken on the record's own name, because a row lock would
 * need a right on the table that a reader of the links does not always hold: the platform
 * grants its rights field by field, and a lock is asked for over the whole table.
 *
 * The lock is held until the transaction ends, so the links are written inside one: the
 * lock is what holds the read and the write against another writer, and outside a
 * transaction it is gone before the read begins.
 */
async function lockLinks(db: Db, path: RelationPath, baseId: string) {
  if (!inTransaction(db))
    throw new Error(
      'The links of a record are written inside a transaction: run this in transaction().'
    )
  const key = `${path.schema}.${path.table}.${baseId}`
  const statement = sql`SELECT pg_advisory_xact_lock(hashtextextended(${sql.val(key)}, 0))`
  const { sql: text, parameters } = statement.compile(k)
  await db.query(text, [...parameters])
}

/**
 * The links of a record, as they are now written: the ones added, and the ones taken away.
 * The pair is unique where the join says so, so a link written twice is one link.
 */
export async function setLinks(
  db: Db,
  path: RelationPath,
  baseId: string,
  ids: string[]
): Promise<{ added: number; removed: number }> {
  await lockLinks(db, path, baseId)
  const held = await run<{ id: string }>(
    db,
    k
      .withSchema(path.schema)
      .selectFrom(path.table)
      .select(asText(path.target).as('id'))
      .where(path.fk, '=', baseId)
  )
  const current = held.rows.map((row) => row.id)
  const wanted = [...new Set(ids.filter((one) => one !== ''))]
  const added = wanted.filter((one) => !current.includes(one))
  const removed = current.filter((one) => !wanted.includes(one))
  for (const one of added) {
    const statement = sql`INSERT INTO ${id(path.schema, path.table)} (${id(path.fk)}, ${id(
      path.target
    )}) VALUES (${sql.val(baseId)}, ${sql.val(one)}) ON CONFLICT DO NOTHING`
    const { sql: text, parameters } = statement.compile(k)
    await db.query(text, [...parameters])
  }
  for (const one of removed) {
    const statement = sql`DELETE FROM ${id(path.schema, path.table)} WHERE ${id(
      path.fk
    )} = ${sql.val(baseId)} AND ${id(path.target)} = ${sql.val(one)}`
    const { sql: text, parameters } = statement.compile(k)
    await db.query(text, [...parameters])
  }
  return { added: added.length, removed: removed.length }
}

/**
 * A new record and the links it starts with, written in one statement: the id of the new
 * row is used to write its links, and never leaves the statement. The links are rows of
 * the join table, and the pair is unique, so a link written twice is one link.
 */
export async function insertRecordWithLinks(
  db: Db,
  schema: string,
  table: string,
  values: object,
  links: { path: RelationPath; ids: string[] }[]
): Promise<number> {
  const columns = Object.keys(values)
  const plain = async () => {
    const into = k.withSchema(schema).insertInto(table)
    const query = Object.keys(values).length ? into.values(values) : into.defaultValues()
    return (await run(db, query)).rowCount ?? 0
  }
  if (!links.length) return plain()
  const insert = sql`INSERT INTO ${id(schema, table)} (${list(
    columns.map((column) => id(column))
  )}) VALUES (${list(
    columns.map((column) => sql.val((values as Record<string, unknown>)[column]))
  )}) RETURNING id`
  const ctes = [sql`new_row AS (${insert})`]
  let at = 0
  for (const link of links)
    for (const one of link.ids.filter((held) => held !== '')) {
      at += 1
      ctes.push(
        sql`${sql.id(`link_${at}`)} AS (INSERT INTO ${id(link.path.schema, link.path.table)} (${id(
          link.path.fk
        )}, ${id(link.path.target)}) SELECT new_row.id, ${sql.val(one)} FROM new_row ON CONFLICT DO NOTHING)`
      )
    }
  if (at === 0) return plain()
  const statement = sql`WITH ${sql.join(ctes, sql.raw(', '))} SELECT 1`
  const { sql: text, parameters } = statement.compile(k)
  await db.query(text, [...parameters])
  return 1
}
