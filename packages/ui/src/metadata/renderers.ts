import { renderersKey } from '@platform/sql'
import type { MetadataRow } from './types.ts'
import type { AnySituation } from './views.ts'

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

/** The reserved key of a field's own metadata that says how its values are drawn. */
export { renderersKey }

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
