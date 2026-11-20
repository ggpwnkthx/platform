import { type MetadataRow, presentationKeys } from '@platform/vocabulary'

/**
 * How a workspace or a collection presents itself: the name people read, the icon they
 * recognise and the colour that marks it.
 *
 * These are three reserved keys of the item's own metadata, stored in `platform.item_metadata`
 * beside every other key and read under the same rules: a reader sees the presentation of the
 * items they may reach, and only the owner of an item may change it. Nothing here is a
 * privilege of its own — the presentation is metadata, and PostgreSQL judges it as metadata.
 */

export { presentationKeys }
export type { PresentationKey } from '@platform/vocabulary'

export const displayNameKey = 'display_name'
export const iconKey = 'icon'
export const colorKey = 'color'

export interface Presentation {
  /** The name people read: "Newsroom" rather than `newsroom`. */
  displayName: string | null
  /** The name of one of the platform's icons. */
  icon: string | null
  /** The item's primary colour: a palette family or a colour of the owner's own. */
  color: string | null
}

export const noPresentation: Presentation = { displayName: null, icon: null, color: null }

/** Every presentation the reader may reach, by item: `schema` for a workspace, `schema.table` for a collection, `schema.table.column` for a field. */
export type PresentationIndex = Record<string, Presentation>

/** The key an item's presentation is filed under. */
export function itemKey(
  schema: string,
  table: string | null | undefined,
  column?: string | null
): string {
  if (column) return `${schema}.${table}.${column}`
  return table ? `${schema}.${table}` : schema
}

/** Reads a value as the presentation reads it: a name, an icon's name and a colour. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Every presentation the reader may reach, filed by item. */
export function indexPresentations(rows: readonly MetadataRow[]): PresentationIndex {
  const index: PresentationIndex = {}
  for (const row of rows) {
    const key = itemKey(row.schema_name, row.table_name, row.column_name)
    const presentation = index[key] ?? { ...noPresentation }
    if (row.key === displayNameKey) presentation.displayName = text(row.value)
    else if (row.key === iconKey) presentation.icon = text(row.value)
    else if (row.key === colorKey) presentation.color = text(row.value)
    index[key] = presentation
  }
  return index
}

/** The presentation of one item: what the reader may reach, or nothing at all. */
export function presentationOf(
  index: PresentationIndex,
  schema: string,
  table?: string | null,
  column?: string | null
): Presentation {
  return index[itemKey(schema, table, column)] ?? noPresentation
}
