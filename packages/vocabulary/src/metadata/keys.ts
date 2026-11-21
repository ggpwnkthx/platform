import type { MetadataScope } from './targets.ts'

/**
 * The reserved metadata keys that make an item present itself: the name people read, the icon
 * they recognise and the colour that marks it. They are ordinary metadata rows, written and
 * read under the same rights as every other key.
 */
export const presentationKeys = ['display_name', 'icon', 'color'] as const
export type PresentationKey = (typeof presentationKeys)[number]

/** The reserved key of a field's own metadata that says where the field appears. */
export const viewsKey = 'views'

/**
 * Where a field appears, by default: everywhere the interface draws it. The owner of a
 * collection may say otherwise, and may name views of their own beside these three.
 */
export const defaultViews = { list: 'show', record: 'show', filter: 'show' } as const

/** The ways a field may be said to appear: shown, hidden, or shown and locked. */
export const viewModes = ['show', 'hide', 'readonly'] as const

/** The reserved key of a field's own metadata that says how its values are drawn. */
export const renderersKey = 'renderers'

export type ViewMode = (typeof viewModes)[number]

/**
 * The reserved keys of a field's own metadata: where it appears and how its values are drawn.
 * Each has an editor of its own, so neither is listed among the field's other keys.
 */
export const fieldKeys = [viewsKey, renderersKey] as const

/**
 * Is this key one the platform reads for itself — and edits in a form of its own — rather
 * than one it only keeps? The presentation is reserved on every item; the rest on a field.
 */
export function isReservedKey(scope: MetadataScope, key: string): boolean {
  if ((presentationKeys as readonly string[]).includes(key)) return true
  return scope === 'field' && (fieldKeys as readonly string[]).includes(key)
}

/**
 * Where a field appears.
 *
 * A field is not one thing drawn one way: it is a column in the records grid, an input in
 * the record form and a column in the filter builder. Keystone treats a field the same way —
 * it gives every field a view for each of those situations, and a field may have one, several
 * or none of them. A computed field has a cell and no form.
 *
 * The platform keeps the same shape, and keeps its own rule: PostgreSQL decides what a reader
 * may read and write, and this decides only where a field is drawn. A field says where it
 * appears in its own metadata, under the reserved key `views`, and PostgreSQL's own row
 * security decides who reads that saying and who changes it — the owner of the collection.
 *
 * The saying is not limited to the three situations the interface draws. The owner of a
 * collection may name views of their own — an export, a print sheet, a screen of their own
 * making — and say whether the field appears in them. The platform keeps what it is told and
 * hands it back; the drawing of a custom view is the deployment's business, but the saying
 * has a place to live, on the field itself, under the same rights as every other key.
 */
