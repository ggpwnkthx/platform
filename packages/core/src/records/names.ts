import { labelColumn } from '../catalog/labels.ts'
import type { Catalog } from '../catalog/types.ts'
import type { Db } from '../db.ts'
import { k } from '../sql/kit.ts'
import { asText, run } from './query.ts'

/**
 * The names of the rows a picker holds: the rows another collection's rows point at, named
 * by the column they are known by, where the reader may read them.
 */

/**
 * The names of the rows a picker holds, where the reader may read them. The rows are
 * found by the column the key points at: usually their `id`, but a key made by hand may
 * point at another column, and the row is found by that one.
 */
export async function namesOf(
  db: Db,
  catalog: Catalog,
  schema: string,
  table: string,
  ids: string[],
  column = 'id'
): Promise<{ id: string; label: string }[]> {
  const wanted = [...new Set(ids.filter((one) => one !== ''))]
  if (!wanted.length) return []
  const label = labelColumn(catalog, schema, table)
  const found = await run<{ id: string; label: string }>(
    db,
    k
      .withSchema(schema)
      .selectFrom(table)
      .select([asText(column).as('id'), (label ? asText(label) : asText(column)).as('label')])
      .where(asText(column), 'in', wanted)
  ).catch(() => null) // a row policy or a column grant may refuse: the ids are shown instead
  const names = new Map((found?.rows ?? []).map((row) => [row.id, row.label]))
  return wanted.map((one) => ({ id: one, label: names.get(one) ?? one }))
}
