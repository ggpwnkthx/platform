import { useMemo } from 'react'
import {
  type Catalog,
  choicesOf,
  type MetadataRow,
  columnsOf,
  everyView,
  fieldMetadata,
  indexFields,
  kindOf,
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
  rows: readonly MetadataRow[] = []
): Field[] {
  const said = indexFields(rows)
  const fields = columnsOf(catalog, schema, table).map((column) => {
    const field = {
      name: column.name,
      label: said[column.name]?.label ?? column.name,
      column,
      kind: kindOf(column.type),
      relation: relationOf(catalog, schema, table, column.name),
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
  return [...fields.filter((f) => !f.system), ...fields.filter((f) => f.system)]
}

/** The fields of a collection as this reader meets them, and the collection itself. */
export function useFields(schema: string, table: string) {
  const { catalog } = useSession()
  const said = useDb(['fields', schema, table], (db) => fieldMetadata(db, schema, table), !!table)
  const info = tableOf(catalog, schema, table)
  const fields = useMemo(
    () => resolveFields(catalog, schema, table, said.data),
    [catalog, schema, table, said.data]
  )
  return { info, fields, loading: said.isLoading }
}
