import {
  type Catalog,
  choicesOf,
  columnsOf,
  type Db,
  everyView,
  columnMetadata,
  inboundRelations,
  indexColumns,
  isJoinTable,
  joinSide,
  joinsOf,
  kindOf,
  labelColumn,
  type MetadataRow,
  type PresentationIndex,
  presentationOf,
  type RelationPath,
  type RelationReach,
  relationOf,
  systemColumns,
  tableOf,
} from '@platform/core'
import './basic.tsx'
import './relations.tsx'
import { columnTypeFor } from './registry.ts'
import type { Column } from './types.ts'

/** A table as the address names it: `schema.table`. */
export const placeOf = (resource: string) => {
  const [schema = '', ...table] = resource.split('.')
  return { schema, table: table.join('.') }
}

/**
 * The columns of a table: its columns, as the catalog and their own metadata describe
 * them, and after them its relations read as rows — the rows a join table links it to, and
 * the rows of other tables that point at it.
 */
export function resolveColumns(
  catalog: Catalog,
  schema: string,
  table: string,
  rows: readonly MetadataRow[] = [],
  presentations: PresentationIndex = {}
): Column[] {
  const said = indexColumns(rows)
  const typed = (column: Omit<Column, 'type'>): Column => ({
    ...column,
    type: columnTypeFor(column),
  })
  const columns = columnsOf(catalog, schema, table).map((column) =>
    typed({
      name: column.name,
      label: said[column.name]?.label ?? column.name,
      column,
      kind: kindOf(column.type),
      relation: relationOf(catalog, schema, table, column.name),
      virtual: false,
      choices: choicesOf(catalog, schema, table, column.name),
      system: systemColumns.includes(column.name),
      computed: !!column.generated || !!column.identity,
      views: said[column.name]?.views ?? everyView,
      renderers: said[column.name]?.renderers ?? {},
    })
  )
  // A relation does not take the name of a column, or of another relation.
  const names = new Set(columns.map((column) => column.name))
  const named = (name: string) => {
    let candidate = name
    for (let count = 2; names.has(candidate); count++) candidate = `${name}_${count}`
    names.add(candidate)
    return candidate
  }
  const rowsOf = (kind: 'links' | 'children', path: RelationPath) =>
    typed({
      name: named(path.target_table),
      label:
        presentationOf(presentations, path.target_schema, path.target_table).displayName ??
        path.target_table,
      column: null,
      kind: 'uuid',
      link: { kind, path },
      virtual: true,
      choices: null,
      system: false,
      computed: false,
      views: { ...everyView, list: 'hide' },
      renderers: {},
    })
  const children = inboundRelations(catalog, schema, table)
    .filter((relation) => !isJoinTable(catalog, relation.schema, relation.table))
    .map((r) =>
      rowsOf('children', {
        kind: 'rows',
        schema: r.schema,
        table: r.table,
        fk: r.column,
        target: 'id',
        target_schema: r.schema,
        target_table: r.table,
        target_column: 'id',
      })
    )
  const links = joinsOf(catalog, schema, table).flatMap((join) => {
    const side = joinSide(join, schema, table)
    if (!side) return []
    const [back, other] = side === 'left' ? [join.left, join.right] : [join.right, join.left]
    return rowsOf('links', {
      kind: 'rows',
      schema: join.schema,
      table: join.table,
      fk: back.column,
      target: other.column,
      target_schema: other.target_schema,
      target_table: other.target_table,
      target_column: other.target_column,
      payload: join.payload,
    })
  })
  return [
    ...columns.filter((f) => !f.system),
    ...columns.filter((f) => f.system),
    ...children,
    ...links,
  ]
}

/** How a column reaches other rows, for the search and the conditions that cross a relation. */
export function reachesOf(catalog: Catalog, columns: Column[]): Record<string, RelationReach> {
  const label = (schema: string, table: string) =>
    tableOf(catalog, schema, table)?.can_select
      ? (labelColumn(catalog, schema, table) ?? undefined)
      : undefined
  const out: Record<string, RelationReach> = {}
  for (const one of columns) {
    const path = one.link?.path
    if (path)
      out[one.name] = {
        ...path,
        target_column: path.target_column ?? 'id',
        label: label(path.target_schema, path.target_table),
      }
    else if (one.relation)
      out[one.name] = {
        kind: 'column',
        schema: one.relation.target_schema,
        table: one.relation.target_table,
        column: one.name,
        target_column: one.relation.target_column,
        label: label(one.relation.target_schema, one.relation.target_table),
      }
  }
  return out
}

/** The columns of a table, read once for each catalog: a change reads the catalog anew. */
const held = new WeakMap<Catalog, Map<string, Promise<Column[]>>>()
export function columnsOfTable(
  db: Db,
  catalog: Catalog,
  presentations: PresentationIndex,
  resource: string
) {
  const byResource = held.get(catalog) ?? new Map<string, Promise<Column[]>>()
  held.set(catalog, byResource)
  const { schema, table } = placeOf(resource)
  const found =
    byResource.get(resource) ??
    columnMetadata(db, schema, table).then((rows) =>
      resolveColumns(catalog, schema, table, rows, presentations)
    )
  byResource.set(resource, found)
  return found
}
