import { renderersKey, viewsKey } from '@platform/sql'

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

/**
 * The reserved keys of a field's own metadata: where it appears and how its values are drawn.
 * Each has an editor of its own, so neither is listed among the field's other keys.
 */
export const fieldKeys = [viewsKey, renderersKey] as const

/**
 * Is this key one the interface reads for itself — and edits in a form of its own — rather
 * than one it only keeps? The presentation is reserved on every item; the rest on a field.
 */
export function isReservedKey(scope: MetadataRow['scope'], key: string): boolean {
  if ((presentationKeys as readonly string[]).includes(key)) return true
  return scope === 'field' && (fieldKeys as readonly string[]).includes(key)
}
