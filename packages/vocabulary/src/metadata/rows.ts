import type { MetadataScope } from './targets.ts'

/** One row of an item's metadata: what it says about the item it names. */
export interface MetadataRow {
  scope: MetadataScope
  schema_name: string
  table_name: string | null
  /** The column, when the row names a field. */
  column_name: string | null
  key: string
  value: unknown
}

/** One row of an item's metadata, with the bookkeeping the platform keeps of it. */
export interface MetadataEntry {
  key: string
  value: unknown
  version: number
  updated_at: string
  updated_by: string
}

/**
 * The reserved metadata keys that make an item present itself: the name people read, the icon
 * they recognise and the colour that marks it. They are ordinary metadata rows, written and
 * read under the same rights as every other key.
 */
