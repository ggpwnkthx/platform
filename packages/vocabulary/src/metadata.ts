/**
 * What an item says about itself: the keys the platform reserves, the saying of where a
 * field appears and how its values are drawn, and the statements that write them.
 *
 * The interface and the operator's tools both read an item's metadata and both write it.
 * They must read it the same way and write it the same way: a field that says where it
 * appears means the same thing whoever reads it, and the value written under the key
 * `views` is the same value in the page and in a psql session.
 *
 * This module has no dependencies and runs in the browser, in Bun and in Node.
 */

import { InvalidName } from './errors.ts'
import { literal, qualified } from './core.ts'

/**
 * The item a metadata row names: a workspace, a collection, or a field of one. A field is a
 * column of a collection, so it names both.
 */
export interface MetadataTarget {
  scope: MetadataScope
  schema: string
  table: string | null
  column: string | null
}

/** What a metadata row names: a workspace, a collection, or a field of one. */
export type MetadataScope = 'workspace' | 'collection' | 'field'

/** The workspace named by a schema. */
export const workspaceTarget = (schema: string): MetadataTarget => ({
  scope: 'workspace',
  schema,
  table: null,
  column: null,
})

/** The collection named by a schema and a table. */
export const collectionTarget = (schema: string, table: string): MetadataTarget => ({
  scope: 'collection',
  schema,
  table,
  column: null,
})

/** The field named by a schema, a table and a column. */
export const fieldTarget = (schema: string, table: string, column: string): MetadataTarget => ({
  scope: 'field',
  schema,
  table,
  column,
})

/**
 * The collection a workspace keeps its metadata in: a table of this name in the workspace's
 * own schema, made by `platform.create_metadata`. Every workspace has its own, so what a
 * workspace says of itself lives in it and is read and written like any other collection.
 */
export const metadataTable = 'item_metadata'

/** The metadata collection of a workspace, as it is written in a statement. */
export const metadataOf = (schema: string): string => qualified(schema, metadataTable)

/** The rule the collection keeps of its own: an item carries a key once. */
export const metadataConflict = "(scope, coalesce(table_name, ''), coalesce(column_name, ''), key)"

/**
 * The statement that gives a workspace its metadata collection. It is safe to repeat: a
 * workspace that has one is left as it is. It runs as the reader, who is the workspace's
 * owner — nobody else may give a workspace its collection.
 */
export const metadataSetupStatement = (schema: string): string =>
  `SELECT platform.create_metadata(${literal(schema)});`

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

/**
 * What each situation may be told. Only the record form can be locked: a cell and a filter
 * are read either way.
 */
export const situationModes: Record<Situation, Mode[]> = {
  list: ['show', 'hide'],
  record: ['show', 'readonly', 'hide'],
  filter: ['show', 'hide'],
}

/** The modes a view of the owner's own may be told: it may be locked as well as hidden. */
export const customModes: Mode[] = ['show', 'readonly', 'hide']

/** Is this one of the situations the interface draws, rather than a view of the owner's own? */
const isSituation = (name: string): name is Situation => situations.includes(name as Situation)

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
    // A mode the situation cannot be told is the nearest it can: locked is still shown.
    views[situation] = situationModes[situation].includes(mode) ? mode : 'show'
  }
  for (const [name, said] of Object.entries(given)) {
    if (isSituation(name)) continue
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
    if (isSituation(name) || !mode) continue
    value[name] = mode
  }
  return value
}

/** The owner's own views: every name but the three the interface draws. */
export function customViews(views: FieldViews): Record<string, Mode> {
  const custom: Record<string, Mode> = {}
  for (const [name, mode] of Object.entries(views)) {
    if (isSituation(name) || !mode) continue
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
export const isCustomView = (name: string): boolean => !isSituation(name)

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

/**
 * How a field's values are drawn.
 *
 * A value is not one thing drawn one way. The same field is a cell in the records grid, a
 * value in the record form and a value in the filter builder, and each of those may want a
 * different drawing: a uuid is eight characters in a cell and thirty-six in a record, a
 * JSON document is a clipped line in a cell and a document in a record, a number is a column
 * of digits in a cell and a number with separators in a record.
 *
 * A field says how its values are drawn in its own metadata, under the reserved key
 * `renderers`, one entry per situation — the same shape as the saying of where it appears.
 * The saying narrows nothing and grants nothing: PostgreSQL still decides who may read the
 * value and who may write it. A saying that cannot be read is ignored, and a field is never
 * lost by one: a value is drawn as the platform draws it.
 */

/** One situation's drawing: the name of a renderer, and the options it is given. */
export interface RendererChoice {
  /** The name of a renderer: one the platform holds, or one the installation added. */
  renderer: string
  /** The options the renderer takes, as the owner wrote them. */
  options: Record<string, unknown>
}

/** How a field's values are drawn, in each of the situations. */
export interface FieldRenderers {
  /** The field's column in the records grid. */
  list?: RendererChoice
  /** The field's value in the record form. */
  record?: RendererChoice
  /** The field's value in the filter builder. */
  filter?: RendererChoice
  /** The owner's own views: any other name a field says where its values are drawn. */
  [situation: string]: RendererChoice | undefined
}

/** Without a saying of its own, a field's values are drawn as the platform draws them. */
export const noRenderers: FieldRenderers = {}

/** The name of a renderer may carry: letters, digits, underscores and dashes. */
export function validRendererName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name.trim())
}

/** The options of a choice, read as they were written: an object, or nothing. */
function optionsOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** Reads one situation's drawing: a name, or a name with its options. */
function choiceOf(value: unknown): RendererChoice | null {
  if (typeof value === 'string') {
    const name = value.trim()
    return name && validRendererName(name) ? { renderer: name, options: {} } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const said = value as Record<string, unknown>
  const name = typeof said.renderer === 'string' ? said.renderer.trim() : ''
  if (!name || !validRendererName(name)) return null
  return { renderer: name, options: optionsOf(said.options) }
}

/**
 * Reads a saying of how a field's values are drawn. A value that is not one is ignored, and
 * the field is drawn as it is without a saying: a field is never lost by a saying that
 * cannot be read. The owner's own views are kept as they were said.
 */
export function parseRenderers(value: unknown): FieldRenderers {
  const renderers: FieldRenderers = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return renderers
  const given = value as Record<string, unknown>
  for (const [situation, said] of Object.entries(given)) {
    const choice = choiceOf(said)
    if (choice) renderers[situation] = choice
  }
  return renderers
}

/** The saying itself, as it is stored: the name of a renderer, and its options. */
export function renderersValue(renderers: FieldRenderers): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const [situation, choice] of Object.entries(renderers)) {
    if (!choice) continue
    value[situation] = Object.keys(choice.options).length
      ? { renderer: choice.renderer, options: choice.options }
      : choice.renderer
  }
  return value
}

/** Are two sayings the same? The order the situations were said in does not matter. */
export function renderersEqual(one: FieldRenderers, other: FieldRenderers): boolean {
  const said = renderersValue(one)
  const also = renderersValue(other)
  const names = [...new Set([...Object.keys(said), ...Object.keys(also)])].sort()
  return names.every((name) => JSON.stringify(said[name]) === JSON.stringify(also[name]))
}

/** Every field's saying, by the column it names. */
export type RenderersIndex = Record<string, FieldRenderers>

/** Files every field's saying by the column it names. */
export function indexRenderers(rows: readonly MetadataRow[]): RenderersIndex {
  const index: RenderersIndex = {}
  for (const row of rows) {
    if (row.key !== renderersKey || !row.column_name) continue
    index[row.column_name] = parseRenderers(row.value)
  }
  return index
}

/** The saying of one field: what it says, or nothing at all. */
export function renderersOf(index: RenderersIndex, column: string): FieldRenderers {
  return index[column] ?? noRenderers
}

/** The drawing of one situation: what the field says, or nothing at all. */
export function rendererOf(
  renderers: FieldRenderers,
  situation: AnySituation
): RendererChoice | null {
  return renderers[situation] ?? null
}

/**
 * The statement that gives a field its own views. Every field the platform makes carries
 * one, so that where it appears is said of the field itself and not left to be inferred.
 * A saying of the owner's own is laid over the default: the three the interface draws are
 * always there.
 */
export function fieldViewsStatement(
  target: MetadataTarget,
  views?: Record<string, string>
): string {
  for (const [name, mode] of Object.entries(views ?? {}))
    if (!viewModes.includes(mode as ViewMode))
      throw new InvalidName(`${name}: a view is shown, hidden or shown and locked`)
  return metadataStatement(target, viewsKey, { ...defaultViews, ...views })
}

/**
 * The statement that gives a field its own value renderers: how its values are drawn in each
 * situation, where the situation is a place the field is drawn — the records grid, the record
 * form, the filter builder — or a view of the owner's own.
 *
 * The renderer of a situation is either the name of a renderer or an object naming one and
 * the options it takes. A saying the platform cannot read is kept as it was written: the
 * platform draws a value it cannot name as it draws every value.
 */
export function fieldRenderersStatement(
  target: MetadataTarget,
  renderers?: Record<string, unknown>
): string {
  return metadataStatement(target, renderersKey, renderers ?? {})
}

/**
 * The statement that gives several fields their own views at once: the fields every
 * collection is made with, or the fields of a collection that have no saying yet.
 */
export function fieldsViewsStatement(targets: readonly MetadataTarget[]): string {
  if (!targets.length) return ''
  if (targets.length === 1) return fieldViewsStatement(targets[0]!)
  // The fields of one collection, so of one workspace: they are written to its own metadata.
  const schema = targets[0]!.schema
  if (targets.some((target) => target.schema !== schema))
    throw new InvalidName('The fields are of more than one workspace')
  const rows = targets.map(
    (target) =>
      `  (${literal(target.scope)}, ${literal(target.table)}, ${literal(target.column)}, ${literal(viewsKey)}, ${literal(JSON.stringify(defaultViews))}::jsonb)`
  )
  return `INSERT INTO ${metadataOf(schema)} (scope, table_name, column_name, key, value)
VALUES
${rows.join(',\n')}
ON CONFLICT ${metadataConflict}
DO UPDATE SET value = EXCLUDED.value;`
}

/**
 * The statement that sets one metadata key of an item, and the statement that removes it.
 * The interface writes an item's metadata through them, so the reader is shown the same
 * statement a psql session would run, and runs exactly that. The row is written to the
 * metadata collection of the item's own workspace, and does not name the workspace: it is
 * in it.
 */
export function metadataStatement(target: MetadataTarget, key: string, value: unknown): string {
  return `INSERT INTO ${metadataOf(target.schema)} (scope, table_name, column_name, key, value)
VALUES (${literal(target.scope)}, ${literal(target.table)}, ${literal(target.column)}, ${literal(key)}, ${literal(JSON.stringify(value ?? null))}::jsonb)
ON CONFLICT ${metadataConflict}
DO UPDATE SET value = EXCLUDED.value;`
}

/** The statement that removes one metadata key of an item. */
export function metadataRemoval(target: MetadataTarget, key: string): string {
  return `DELETE FROM ${metadataOf(target.schema)}
 WHERE scope = ${literal(target.scope)}
   AND table_name IS NOT DISTINCT FROM ${literal(target.table)}
   AND column_name IS NOT DISTINCT FROM ${literal(target.column)}
   AND key = ${literal(key)};`
}
