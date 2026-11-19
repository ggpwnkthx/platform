import {
  choicesOf,
  columnsOf,
  kindOf,
  relationOf,
  systemColumns,
  type Catalog,
  type ColumnInfo,
  type RelationInfo,
} from '@platform/data'
import { displayNameKey } from '@platform/data'
import {
  everyView,
  type FieldRenderers,
  type FieldViews,
  type MetadataRow,
  noRenderers,
  parseRenderers,
  parseViews,
  renderersKey,
  viewsKey,
} from '@platform/sql'
import { fieldTypeFor } from './registry.ts'
import type { Field } from './types.ts'

/**
 * The fields of a collection, each read once: what PostgreSQL says of the column, what the
 * field says of itself in its own metadata, and the type that follows from the two.
 *
 * Every page that shows fields starts here. The catalog and the metadata are both the
 * reader's own answer — PostgreSQL returned the columns they may reach and the sayings they
 * may read — so a field this reader may not reach has no saying here, and is drawn as the
 * platform draws it.
 */

/** What a field says of itself, beside what PostgreSQL says of its column. */
export interface FieldSaying {
  /** The row the column points at, when it is a foreign key. */
  relation?: RelationInfo | null
  /** The values a CHECK allows, when the column is chosen from a list. */
  choices?: string[] | null
  /** The name people read, when the owner gave it one. */
  label?: string | null
  /** Where the field appears. Without a saying, everywhere. */
  views?: FieldViews
  /** How its values are drawn. Without a saying, as the platform draws them. */
  renderers?: FieldRenderers
}

/** One field, from its column and what is said of it. */
export function describeField(column: ColumnInfo, said: FieldSaying = {}): Field {
  const facts = {
    column,
    kind: kindOf(column.type),
    relation: said.relation ?? null,
    choices: said.choices ?? null,
  }
  const label = said.label?.trim() || null
  return {
    ...facts,
    name: column.name,
    label: label ?? column.name,
    named: label !== null,
    system: systemColumns.includes(column.name),
    computed: Boolean(column.generated || column.identity),
    views: said.views ?? everyView,
    hasViews: said.views !== undefined,
    renderers: said.renderers ?? noRenderers,
    type: fieldTypeFor(facts),
  }
}

/** What each field's own metadata says, filed by the column it names. */
function sayings(rows: readonly MetadataRow[]): Map<string, FieldSaying> {
  const said = new Map<string, FieldSaying>()
  for (const row of rows) {
    if (!row.column_name) continue
    const saying = said.get(row.column_name) ?? {}
    if (row.key === displayNameKey) saying.label = typeof row.value === 'string' ? row.value : null
    else if (row.key === viewsKey) saying.views = parseViews(row.value)
    else if (row.key === renderersKey) saying.renderers = parseRenderers(row.value)
    said.set(row.column_name, saying)
  }
  return said
}

/**
 * Every field of a collection, in the order PostgreSQL holds its columns. The rows are the
 * fields' own metadata, as `fieldMetadata` read them; before they are read, every field is
 * what it is without a saying.
 */
export function resolveFields(
  catalog: Catalog,
  schema: string,
  table: string,
  rows: readonly MetadataRow[] = []
): Field[] {
  const said = sayings(rows)
  return columnsOf(catalog, schema, table).map((column) =>
    describeField(column, {
      ...said.get(column.name),
      relation: relationOf(catalog, schema, table, column.name) ?? null,
      choices: choicesOf(catalog, schema, table, column.name),
    })
  )
}
