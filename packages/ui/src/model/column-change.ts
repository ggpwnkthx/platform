import {
  carried,
  tableTarget,
  columnDefaultStatement,
  columnTypeStatement,
  dropNotNullStatement,
  columnTarget,
  columnViewsStatement,
  ident,
  lit,
  metadataRemoval,
  metadataStatement,
  notNullStatement,
  type PresentationIndex,
  presentationOf,
  renameColumnStatement,
  renderersKey,
  renderersValue,
  sql,
  stmt,
} from '@platform/core'
import type { Place } from '../data/kinds.ts'
import type { ColumnForm, Row } from './column-inputs.tsx'

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const said = (text?: string | null) => text?.trim() || null

/**
 * A change to a column that is there: its type and its default, which PostgreSQL holds; what
 * the owner says of it; and last its name, which carries its sayings, and the table's
 * own where the table is known by it.
 */
export function columnChange(
  form: ColumnForm,
  { schema, table }: Place,
  row: Row,
  presentations: PresentationIndex
) {
  const out: string[] = []
  const type = said(form.type_name)
  if (type && type !== row.type_name)
    out.push(columnTypeStatement(schema, table, row.name, type, form.using))
  if (!row.system && said(form.default) !== said(row.column!.default))
    out.push(columnDefaultStatement(schema, table, row.name, form.default))
  if (said(form.note) !== said(row.column!.comment))
    out.push(
      stmt`COMMENT ON COLUMN ${sql.raw(ident(schema, table, row.name))} IS ${lit(said(form.note))}`
    )
  if (!!form.required !== row.column!.required)
    out.push((form.required ? notNullStatement : dropNotNullStatement)(schema, table, row.name))
  // What the owner says of it, by key: a value to write, or null to take the key away.
  const sayings = new Map<string, unknown>()
  const name = said(form.display_name)
  if (name !== (row.label === row.name ? null : row.label)) sayings.set('display_name', name)
  if (!same(form.views, row.views)) sayings.set('views', form.views ?? {})
  const drawn = Object.fromEntries(
    Object.entries(form.renderers ?? {})
      .filter(([, choice]) => choice?.renderer)
      .map(([place, choice]) => [
        place,
        { renderer: choice.renderer, options: choice.options ?? {} },
      ])
  )
  if (!same(renderersValue(drawn), renderersValue(row.renderers)))
    sayings.set(renderersKey, Object.keys(drawn).length ? renderersValue(drawn) : null)
  // A rename comes before the sayings, which are then written under the new name; the ones
  // not changed move with it.
  const column = said(form.name) ?? row.name
  if (column !== row.name) {
    out.push(
      ...carried(
        row.said.filter((r) => !sayings.has(r.key)),
        { schema, table, column: row.name },
        { schema, table, column },
        renameColumnStatement(schema, table, row.name, column)
      )
    )
    if (presentationOf(presentations, schema, table).displayColumn === row.name)
      out.push(metadataStatement(tableTarget(schema, table), 'display_column', column))
  }
  const target = columnTarget(schema, table, column)
  for (const [key, value] of sayings)
    out.push(
      key === 'views'
        ? columnViewsStatement(target, value as Record<string, string>)
        : value === null
          ? metadataRemoval(target, key)
          : metadataStatement(target, key, value)
    )
  return out
}
