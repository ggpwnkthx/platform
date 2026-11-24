import {
  type Catalog,
  choicesOf,
  columnsOf,
  type Db,
  everyView,
  fieldMetadata,
  inboundRelations,
  indexFields,
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
  systemFields,
  tableOf,
} from '@platform/core'
import './basic.tsx'
import './relations.tsx'
import { fieldTypeFor } from './registry.ts'
import type { Field } from './types.ts'

/** A collection as the address names it: `workspace.collection`. */
export const placeOf = (resource: string) => {
  const [schema = '', ...table] = resource.split('.')
  return { schema, table: table.join('.') }
}

/**
 * The fields of a collection: its columns, as the catalog and their own metadata describe
 * them, and after them its relations read as rows — the rows a join table links it to, and
 * the rows of other collections that point at it.
 */
export function resolveFields(
  catalog: Catalog,
  schema: string,
  table: string,
  rows: readonly MetadataRow[] = [],
  presentations: PresentationIndex = {}
): Field[] {
  const said = indexFields(rows)
  const typed = (field: Omit<Field, 'type'>): Field => ({ ...field, type: fieldTypeFor(field) })
  const columns = columnsOf(catalog, schema, table).map((column) =>
    typed({
      name: column.name,
      label: said[column.name]?.label ?? column.name,
      column,
      kind: kindOf(column.type),
      relation: relationOf(catalog, schema, table, column.name),
      virtual: false,
      choices: choicesOf(catalog, schema, table, column.name),
      system: systemFields.includes(column.name),
      computed: !!column.generated || !!column.identity,
      views: said[column.name]?.views ?? everyView,
      renderers: said[column.name]?.renderers ?? {},
    })
  )
  // A relation does not take the name of a column, or of another relation.
  const names = new Set(columns.map((field) => field.name))
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

/** How a field reaches other rows, for the search and the conditions that cross a relation. */
export function reachesOf(catalog: Catalog, fields: Field[]): Record<string, RelationReach> {
  const label = (schema: string, table: string) =>
    tableOf(catalog, schema, table)?.can_select
      ? (labelColumn(catalog, schema, table) ?? undefined)
      : undefined
  const out: Record<string, RelationReach> = {}
  for (const field of fields) {
    const path = field.link?.path
    if (path)
      out[field.name] = {
        ...path,
        target_column: path.target_column ?? 'id',
        label: label(path.target_schema, path.target_table),
      }
    else if (field.relation)
      out[field.name] = {
        kind: 'column',
        schema: field.relation.target_schema,
        table: field.relation.target_table,
        column: field.name,
        target_column: field.relation.target_column,
        label: label(field.relation.target_schema, field.relation.target_table),
      }
  }
  return out
}

/** The fields of a collection, read once for each catalog: a change reads the catalog anew. */
const held = new WeakMap<Catalog, Map<string, Promise<Field[]>>>()
export function fieldsOf(
  db: Db,
  catalog: Catalog,
  presentations: PresentationIndex,
  resource: string
) {
  const byResource = held.get(catalog) ?? new Map<string, Promise<Field[]>>()
  held.set(catalog, byResource)
  const { schema, table } = placeOf(resource)
  const found =
    byResource.get(resource) ??
    fieldMetadata(db, schema, table).then((rows) =>
      resolveFields(catalog, schema, table, rows, presentations)
    )
  byResource.set(resource, found)
  return found
}
