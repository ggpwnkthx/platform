import { defaultViews, type ViewMode, viewModes, viewsKey } from '@platform/sql'
import type { MetadataRow } from './types.ts'

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

/** The reserved key of a field's own metadata that says where the field appears. */
export { viewsKey }

/** The situations the interface itself draws. */
export type Situation = 'list' | 'record' | 'filter'

/** A situation the interface draws, or one the owner of the collection named. */
export type AnySituation = Situation | (string & {})

/** What a field does in one situation: shown, hidden, or shown and locked. */
export type Mode = ViewMode

/**
 * Where a field appears, in each of the situations. The three the interface draws are always
 * there; any other name is a view of the owner's own.
 */
export interface FieldViews {
  /** The field's column in the records grid. */
  list: Mode
  /** The field in the record form: an input, a locked value, or nothing. */
  record: Mode
  /** The field in the filter builder. */
  filter: Mode
  /** The owner's own views: any other name a field says where it appears. */
  [view: string]: Mode | undefined
}

/** Without a saying of its own, a field appears everywhere. */
export const everyView: FieldViews = { ...defaultViews }

/** The situations the interface draws, in the order they are offered. */
export const situations: Situation[] = ['list', 'record', 'filter']

/** What each situation is called, in a sentence. */
export const situationLabels: Record<Situation, string> = {
  list: 'the list',
  record: 'the record',
  filter: 'the filters',
}

/** What a situation may be told, in words the interface shows. */
export const modeLabels: Record<Mode, string> = {
  show: 'Shown',
  hide: 'Hidden',
  readonly: 'Shown, locked',
}

/** The modes a view of the owner's own may be told: it may be locked as well as hidden. */
export const customModes: Mode[] = ['show', 'readonly', 'hide']

/** Every mode the platform knows, in the order the interface offers them. */
export const modes = viewModes

function modeOf(value: unknown): Mode | null {
  if (value === true) return 'show'
  if (value === false) return 'hide'
  if (value === 'show' || value === 'hide' || value === 'readonly') return value
  return null
}

/**
 * Reads a saying of where a field appears. A value that is not one is ignored, and the field
 * appears as it does without a saying: a field is never lost by a saying that cannot be read.
 * The owner's own views are kept as they were said.
 */
export function parseViews(value: unknown): FieldViews {
  const views: FieldViews = { ...everyView }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return views
  const given = value as Record<string, unknown>
  for (const situation of situations) {
    const mode = modeOf(given[situation])
    if (!mode) continue
    // Only the record form can be locked; a cell and a filter are read either way.
    views[situation] = situation === 'record' ? mode : mode === 'readonly' ? 'show' : mode
  }
  for (const [name, said] of Object.entries(given)) {
    if (situations.includes(name as Situation)) continue
    const mode = modeOf(said)
    if (mode) views[name] = mode
  }
  return views
}

/** The saying itself, as it is stored: the three the interface draws, and the owner's own. */
export function viewsValue(views: FieldViews): Record<string, string> {
  const value: Record<string, string> = {}
  for (const situation of situations) value[situation] = views[situation]
  for (const [name, mode] of Object.entries(views)) {
    if (situations.includes(name as Situation) || !mode) continue
    value[name] = mode
  }
  return value
}

/** The owner's own views: every name but the three the interface draws. */
export function customViews(views: FieldViews): Record<string, Mode> {
  const custom: Record<string, Mode> = {}
  for (const [name, mode] of Object.entries(views)) {
    if (situations.includes(name as Situation) || !mode) continue
    custom[name] = mode
  }
  return custom
}

/** Are two sayings the same? The order the views were said in does not matter. */
export function viewsEqual(one: FieldViews, other: FieldViews): boolean {
  const said = viewsValue(one)
  const also = viewsValue(other)
  const names = [...new Set([...Object.keys(said), ...Object.keys(also)])].sort()
  return names.every((name) => said[name] === also[name])
}

/** Is this a view of the owner's own, rather than one the interface draws? */
export const isCustomView = (name: string): boolean => !situations.includes(name as Situation)

/**
 * The name a view may carry: letters, digits, underscores and dashes, and it starts with a
 * letter. A name is a key of a metadata row, so it must be a name and nothing else.
 */
export function validViewName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name.trim())
}

/** Every field's saying, by the column it names. */
export type ViewsIndex = Record<string, FieldViews>

/** Files every field's saying by the column it names. */
export function indexViews(rows: readonly MetadataRow[]): ViewsIndex {
  const index: ViewsIndex = {}
  for (const row of rows) {
    if (row.key !== viewsKey || !row.column_name) continue
    index[row.column_name] = parseViews(row.value)
  }
  return index
}

/** The saying of one field: what it says, or what every field says without one. */
export function viewsOf(index: ViewsIndex, column: string): FieldViews {
  return index[column] ?? everyView
}

/** Is the field drawn in the records grid? */
export const inList = (views: FieldViews): boolean => views.list !== 'hide'

/** Is the field drawn in the record form? */
export const inRecord = (views: FieldViews): boolean => views.record !== 'hide'

/** Is the field offered in the filter builder? */
export const inFilter = (views: FieldViews): boolean => views.filter !== 'hide'

/** Is the field drawn in the record form, but not as an input? */
export const isLocked = (views: FieldViews): boolean => views.record === 'readonly'
