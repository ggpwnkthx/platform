import { labelColumn } from '../catalog/labels.ts'
import type { Catalog } from '../catalog/types.ts'
import type { Db } from '../db.ts'
import { id, k, list, sql } from '../sql/kit.ts'
import { asText, run } from './query.ts'
import type { RelationPath } from './query.ts'

/**
 * The links of a record: the rows it is linked to, through a join table or through the
 * table of children. The same path reads them, writes them, and filters by them.
 */

/** The names of the rows a picker holds, where the reader may read them. */
export async function namesOf(
  db: Db,
  catalog: Catalog,
  schema: string,
  table: string,
  ids: string[]
): Promise<{ id: string; label: string }[]> {
  const wanted = [...new Set(ids.filter((one) => one !== ''))]
  if (!wanted.length) return []
  const label = labelColumn(catalog, schema, table)
  const found = await run<{ id: string; label: string }>(
    db,
    k
      .withSchema(schema)
      .selectFrom(table)
      .select([asText('id').as('id'), (label ? asText(label) : asText('id')).as('label')])
      .where(asText('id'), 'in', wanted)
  ).catch(() => null) // a row policy or a column grant may refuse: the ids are shown instead
  const names = new Map((found?.rows ?? []).map((row) => [row.id, row.label]))
  return wanted.map((one) => ({ id: one, label: names.get(one) ?? one }))
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
): Promise<{ id: string; label: string }[]> {
  const links = await run<{ id: string }>(
    db,
    k
      .withSchema(path.schema)
      .selectFrom(path.table)
      .select(asText(path.target).as('id'))
      .where(path.fk, '=', baseId)
  )
  const ids = links.rows.map((row) => row.id)
  if (!ids.length) return []
  const label = labelColumn(catalog, path.target_schema, path.target_table)
  const found = await run<{ id: string; label: string }>(
    db,
    k
      .withSchema(path.target_schema)
      .selectFrom(path.target_table)
      .select([asText('id').as('id'), (label ? asText(label) : asText('id')).as('label')])
      .where(asText('id'), 'in', ids)
  ).catch(() => null) // a row policy or a column grant may refuse: the ids are shown instead
  const names = new Map((found?.rows ?? []).map((row) => [row.id, row.label]))
  return ids.map((one) => ({ id: one, label: names.get(one) ?? one }))
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
 * The links of a record, as they are now written: the ones added, and the ones taken away.
 * The pair is unique where the join says so, so a link written twice is one link.
 */
export async function setLinks(
  db: Db,
  path: RelationPath,
  baseId: string,
  ids: string[]
): Promise<{ added: number; removed: number }> {
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
