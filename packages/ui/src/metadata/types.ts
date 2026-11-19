/** What an item's own metadata says about it. */

export interface MetadataEntry {
  key: string
  value: unknown
  version: number
  updated_at: string
  updated_by: string
}

/** One row of the item's metadata: what it says about the item it names. */
export interface MetadataRow {
  scope: 'workspace' | 'collection' | 'field'
  schema_name: string
  table_name: string | null
  /** The column, when the row names a field. */
  column_name: string | null
  key: string
  value: unknown
}

/**
 * The reserved metadata keys that make an item present itself: the name people read, the icon
 * they recognise and the colour that marks it. They are ordinary metadata rows, written and
 * read under the same rights as every other key.
 */
export const presentationKeys = ['display_name', 'icon', 'color'] as const
export type PresentationKey = (typeof presentationKeys)[number]
