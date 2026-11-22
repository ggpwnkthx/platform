import { type DataSource, ident, qualified } from '@platform/vocabulary'
import { labelColumn, relationOf, tableOf } from '../catalog/catalog.ts'
import type { Catalog } from '../catalog/types.ts'

/** The options a relation offers: rows of the target, labelled by their first text column. */
export async function relationOptions(
  db: DataSource,
  schema: string,
  table: string,
  label: string | null,
  search: string
) {
  const shown = label ? `CAST(${ident(label)} AS TEXT)` : 'id::text'
  // fallow-ignore-next-line security-sink -- every column and table name is quoted with ident(); every value is bound
  const result = await db.query<{ id: string; label: string }>(
    `SELECT id::text AS id, ${shown} AS label FROM ${qualified(schema, table)}
      WHERE $1 = '' OR ${shown} ILIKE '%' || $1 || '%' OR id::text = $1
      ORDER BY 2 LIMIT 20`,
    [search.trim()]
  )
  return result.rows
}

/** The labels of the rows a relation column points at, read in one statement per target. */
export async function relationLabels(
  db: DataSource,
  catalog: Catalog,
  schema: string,
  table: string,
  rows: Record<string, unknown>[],
  columns: string[]
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {}
  for (const column of columns) {
    const relation = relationOf(catalog, schema, table, column)
    if (!relation) continue
    const ids = [
      ...new Set(rows.map((r) => r[column]).filter((v) => v !== null && v !== undefined)),
    ]
    if (!ids.length) continue
    const label = labelColumn(catalog, relation.target_schema, relation.target_table)
    const target = tableOf(catalog, relation.target_schema, relation.target_table)
    if (!label || !target?.can_select) continue
    try {
      // fallow-ignore-next-line security-sink -- every column and table name is quoted with ident(); every value is bound
      const found = await db.query<{ id: string; label: string }>(
        `SELECT id::text AS id, ${ident(label)}::text AS label FROM ${qualified(relation.target_schema, relation.target_table)} WHERE id::text = ANY($1)`,
        [ids.map(String)]
      )
      out[column] = Object.fromEntries(found.rows.map((r) => [r.id, r.label]))
    } catch {
      // A label the reader may not read stays an id.
    }
  }
  return out
}
