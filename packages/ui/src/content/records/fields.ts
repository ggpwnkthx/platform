import { useMemo } from 'preact/hooks'
import type { Catalog } from '@platform/data'
import type { MetadataRow } from '@platform/vocabulary'
import { inFilter, inList } from '@platform/vocabulary'
import { resolveFields } from '../../fields/resolve.ts'

/**
 * The fields of the collection, each read once: what the database says of the column, what
 * the field says of itself, and the type that draws it. A field this reader may not reach
 * has no saying here: the database did not return its metadata.
 */
export function useRecordsFields({
  catalog,
  ws,
  table,
  described,
  showSystem,
}: {
  catalog: Catalog
  ws: string
  table: string
  /** What the database said of the fields themselves. */
  described: readonly MetadataRow[] | undefined
  /** Whether the reader wishes to see the platform's own fields. */
  showSystem: boolean
}) {
  const fields = useMemo(
    () => resolveFields(catalog, ws, table, described),
    [catalog, ws, table, described]
  )
  const readableFields = fields.filter((field) => field.column.can_select)
  // The record's own fields first, then the platform's: who changed it and when.
  const listed = readableFields.filter((field) => inList(field.views))
  const shown = [
    ...listed.filter((field) => !field.system),
    ...listed.filter((field) => field.system && (showSystem || field.name === 'updated_at')),
  ]
  // The fields the filter builder offers: those whose saying lets it.
  const filterable = readableFields.filter((field) => inFilter(field.views))
  return { fields, readableFields, shown, filterable }
}
