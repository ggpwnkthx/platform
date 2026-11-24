import { useMemo } from 'react'
import {
  type Catalog,
  choicesOf,
  type MetadataRow,
  columnsOf,
  everyView,
  fieldMetadata,
  indexFields,
  inboundRelations,
  isJoinTable,
  joinSide,
  joinsOf,
  kindOf,
  type PresentationIndex,
  presentationOf,
  relationOf,
  systemFields,
  tableOf,
} from '@platform/core'
import { useSession } from '../session/context.ts'
import { useDb } from '../session/hooks.ts'
import type { Field } from './types.ts'
import { fieldTypeFor } from './registry.ts'

/** Every field of a collection, from the two things the reader was given: the catalog and the fields' own metadata. */
export function resolveFields(
  catalog: Catalog,
  schema: string,
  table: string,
  rows: readonly MetadataRow[] = [],
  presentations: PresentationIndex = {}
): Field[] {
  const said = indexFields(rows)
  const fields = columnsOf(catalog, schema, table).map((column) => {
    const field = {
      name: column.name,
      label: said[column.name]?.label ?? column.name,
      column,
      kind: kindOf(column.type),
      relation: relationOf(catalog, schema, table, column.name),
      link: undefined,
      virtual: false,
      choices: choicesOf(catalog, schema, table, column.name),
      system: systemFields.includes(column.name),
      computed: !!column.generated || !!column.identity,
      views: said[column.name]?.views ?? everyView,
      hasViews: !!said[column.name]?.views,
      renderers: said[column.name]?.renderers ?? {},
    }
    return { ...field, type: fieldTypeFor(field) }
  })
  // A collection's own fields come first; the ones every collection is made with follow.
  return [
    ...fields.filter((f) => !f.system),
    ...fields.filter((f) => f.system),
    ...relationsOf(
      catalog,
      schema,
      table,
      presentations,
      columnsOf(catalog, schema, table).map((column) => column.name)
    ),
  ]
}

/**
 * The relations of a collection that are not columns: the rows that point at it, and the
 * rows it is linked to through a join table. They have no column of their own — the
 * interface reads them as rows, and writes them as rows.
 */
function relationsOf(
  catalog: Catalog,
  schema: string,
  table: string,
  presentations: PresentationIndex,
  columns: string[]
): Field[] {
  const out: Field[] = []
  const names = new Set<string>(columns)
  const named = (name: string) => {
    let candidate = name
    let count = 1
    while (names.has(candidate)) {
      count += 1
      candidate = `${name}_${count}`
    }
    names.add(candidate)
    return candidate
  }
  const said = (other_schema: string, other_table: string) =>
    presentationOf(presentations, other_schema, other_table).displayName ?? other_table
  const virtual = (name: string, label: string, link: Field['link']) => {
    const field = {
      name,
      label,
      column: null,
      kind: 'uuid' as const,
      relation: undefined,
      link,
      virtual: true,
      choices: null,
      system: false,
      computed: false,
      // A relation of rows is shown in the form and the filters, and not in the grid:
      // a grid of counts would ask every row of every page for a count of its own.
      views: { ...everyView, list: 'hide' as const },
      hasViews: false,
      renderers: {},
    }
    return { ...field, type: fieldTypeFor(field) }
  }
  // The rows that point at this one: the children of a one-to-many relation. A join table
  // is not one of them: the links it holds are already a field of their own.
  for (const relation of inboundRelations(catalog, schema, table)) {
    if (isJoinTable(catalog, relation.schema, relation.table)) continue
    const name = named(relation.table)
    out.push(
      virtual(name, said(relation.schema, relation.table), {
        kind: 'children',
        path: {
          kind: 'rows',
          schema: relation.schema,
          table: relation.table,
          fk: relation.column,
          target: 'id',
          target_schema: relation.schema,
          target_table: relation.table,
          // The rows are the children's own, found by their own key.
          target_column: 'id',
        },
      })
    )
  }
  // The rows this one is linked to, through a join table.
  for (const join of joinsOf(catalog, schema, table)) {
    const side = joinSide(join, schema, table)
    if (!side) continue
    const other = side === 'left' ? join.right : join.left
    const back = side === 'left' ? join.left : join.right
    const name = named(other.target_table)
    out.push(
      virtual(name, said(other.target_schema, other.target_table), {
        kind: 'links',
        path: {
          kind: 'rows',
          schema: join.schema,
          table: join.table,
          fk: back.column,
          target: other.column,
          target_schema: other.target_schema,
          target_table: other.target_table,
          // The column of the other table the link's key points at: usually `id`.
          target_column: other.target_column,
          payload: join.payload,
        },
      })
    )
  }
  return out
}

/** The fields of a collection as this reader meets them, and the collection itself. */
export function useFields(schema: string, table: string) {
  const { catalog, presentations } = useSession()
  const said = useDb(['fields', schema, table], (db) => fieldMetadata(db, schema, table), !!table)
  const info = tableOf(catalog, schema, table)
  const fields = useMemo(
    () => resolveFields(catalog, schema, table, said.data, presentations),
    [catalog, schema, table, said.data, presentations]
  )
  return { info, fields, loading: said.isLoading }
}
