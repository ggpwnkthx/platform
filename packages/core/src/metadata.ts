import type { Db } from './db.ts'
import {
  defaultViews,
  type MetadataScope,
  metadataColumns,
  type MetadataTarget,
  renderersKey,
  type ViewMode,
  viewsKey,
} from './sql/metadata.ts'
export interface MetadataRow {
  scope: MetadataScope
  schema_name: string
  table_name: string | null
  column_name: string | null
  key: string
  value: unknown
}
export interface MetadataEntry {
  id: string
  key: string
  value: unknown
  version: number
  updated_at: string
  updated_by: string
}

export const presentationKeys = ['display_name', 'icon', 'color'] as const
const columns = metadataColumns
/** The metadata of one item. Row security returns the rows the caller may reach, no others. */
export async function metadata(db: Db, target: MetadataTarget) {
  const result = await db.query<MetadataEntry>(
    `SELECT id::text AS id, key, value, version::int AS version, updated_at::text AS updated_at, updated_by
       FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2
        AND table_name IS NOT DISTINCT FROM $3::text AND column_name IS NOT DISTINCT FROM $4::text
      ORDER BY key`,
    [target.scope, target.schema, target.table, target.column]
  )
  return result.rows
}
/** Every field's metadata of one collection, in one statement. */
export async function fieldMetadata(db: Db, schema: string, table: string) {
  const result = await db.query<MetadataRow>(
    `SELECT ${columns} FROM platform.item_metadata
      WHERE scope = 'field' AND schema_name = $1 AND table_name = $2 ORDER BY column_name, key`,
    [schema, table]
  )
  return result.rows
}
export async function presentations(db: Db): Promise<MetadataRow[]> {
  const result = await db.query<MetadataRow>(
    `SELECT ${columns} FROM platform.item_metadata
      WHERE key = ANY($1::text[]) OR (scope = 'collection' AND key = 'display_field')`,
    [[...presentationKeys]]
  )
  return result.rows
}

// ---------------------------------------------------------------------------- presentation

export interface Presentation {
  displayName: string | null
  icon: string | null
  color: string | null
  displayField: string | null
}
const noPresentation: Presentation = {
  displayName: null,
  icon: null,
  color: null,
  displayField: null,
}
export type PresentationIndex = Record<string, Presentation>
const itemKey = (schema: string, table?: string | null, column?: string | null) =>
  [schema, table, column].filter(Boolean).join('.')
const slots = {
  display_name: 'displayName',
  icon: 'icon',
  color: 'color',
  display_field: 'displayField',
} as const
export function indexPresentations(rows: readonly MetadataRow[]): PresentationIndex {
  const index: PresentationIndex = {}
  for (const row of rows) {
    const slot = slots[row.key as keyof typeof slots]
    if (!slot) continue
    const key = itemKey(row.schema_name, row.table_name, row.column_name)
    const text = typeof row.value === 'string' ? row.value.trim() : ''
    index[key] = { ...(index[key] ?? noPresentation), [slot]: text || null }
  }
  return index
}
export const presentationOf = (
  index: PresentationIndex,
  schema: string,
  table?: string | null,
  column?: string | null
) => index[itemKey(schema, table, column)] ?? noPresentation

// ----------------------------------------------------------------------------------- views

export type Situation = 'list' | 'record' | 'filter'
export const situations: Situation[] = ['list', 'record', 'filter']
/** `readonly` means something in the record form only: shown, never an input. */
export const situationModes: Record<Situation, ViewMode[]> = {
  list: ['show', 'hide'],
  record: ['show', 'readonly', 'hide'],
  filter: ['show', 'hide'],
}
export type FieldViews = Record<Situation, ViewMode> & Record<string, ViewMode | undefined>
export const everyView: FieldViews = { ...defaultViews }
export const validViewName = (name: string) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name.trim())
const modeOf = (value: unknown): ViewMode | null =>
  value === true
    ? 'show'
    : value === false
      ? 'hide'
      : value === 'show' || value === 'hide' || value === 'readonly'
        ? value
        : null
/** The saying as it is kept, read leniently: the three situations, then the owner's own views. */
export function parseViews(value: unknown): FieldViews {
  const views: FieldViews = { ...everyView }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return views
  for (const [name, said] of Object.entries(value)) {
    const mode = modeOf(said)
    if (!mode) continue
    const known = situationModes[name as Situation]
    views[name] = known && !known.includes(mode) ? 'show' : mode
  }
  return views
}

// ------------------------------------------------------------------------------- renderers

export interface RendererChoice {
  renderer: string
  options: Record<string, unknown>
}
export type FieldRenderers = Record<string, RendererChoice | undefined>
export const validRendererName = validViewName
function choiceOf(value: unknown): RendererChoice | null {
  const said = typeof value === 'string' ? { renderer: value } : value
  if (!said || typeof said !== 'object' || Array.isArray(said)) return null
  const { renderer, options } = said as { renderer?: unknown; options?: unknown }
  if (typeof renderer !== 'string' || !validRendererName(renderer)) return null
  const given = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  return { renderer: renderer.trim(), options: given as Record<string, unknown> }
}
export function parseRenderers(value: unknown): FieldRenderers {
  const renderers: FieldRenderers = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return renderers
  for (const [situation, said] of Object.entries(value)) {
    const choice = choiceOf(said)
    if (choice) renderers[situation] = choice
  }
  return renderers
}
/** The saying as it is written: a name alone where a renderer takes no options. */
export const renderersValue = (renderers: FieldRenderers) =>
  Object.fromEntries(
    Object.entries(renderers).flatMap(([situation, choice]) =>
      choice ? [[situation, Object.keys(choice.options).length ? choice : choice.renderer]] : []
    )
  )

/** What a collection's fields say of themselves, by column. */
export function indexFields(rows: readonly MetadataRow[]) {
  const index: Record<string, { label?: string; views?: FieldViews; renderers?: FieldRenderers }> =
    {}
  for (const row of rows) {
    if (!row.column_name) continue
    index[row.column_name] ??= {}
    const field = index[row.column_name]!
    if (row.key === viewsKey) field.views = parseViews(row.value)
    else if (row.key === renderersKey) field.renderers = parseRenderers(row.value)
    else if (row.key === 'display_name' && typeof row.value === 'string' && row.value.trim())
      field.label = row.value.trim()
  }
  return index
}
