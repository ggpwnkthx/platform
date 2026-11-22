import type { Catalog, ColumnInfo } from '@platform/data'
import { resolveFields } from '../src/fields/resolve.ts'
import type { Field } from '../src/fields/field.ts'

/**
 * What a field is. A field's type owns everything the interface does with it — the cell, the
 * value, the input and the filter — and the type follows from what the database says of the
 * column, so no page asks what kind of column it is drawing.
 */

/** A column of the kind a test needs. */
export function column(type: string, name = 'value', more: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    schema: 'newsroom',
    table: 'articles',
    name,
    position: 1,
    type,
    required: false,
    default: null,
    comment: null,
    generated: null,
    identity: null,
    can_select: true,
    can_insert: true,
    can_update: true,
    ...more,
  }
}

export const relation = {
  schema: 'newsroom',
  table: 'articles',
  column: 'author',
  target_schema: 'newsroom',
  target_table: 'authors',
  on_delete: 'r',
}

export const catalog: Catalog = {
  schemas: [],
  tables: [],
  columns: [
    column('uuid', 'id'),
    column('text', 'title', { required: true }),
    column('text', 'status'),
    column('uuid', 'author'),
    column('integer', 'words'),
    column('tsvector', 'search', { generated: 's' }),
    column('timestamp with time zone', 'updated_at'),
    // Another collection's column of the same name is not this collection's field.
    { ...column('text', 'title'), table: 'authors' },
  ],
  relations: [relation],
  constraints: [
    {
      schema: 'newsroom',
      table: 'articles',
      name: 'articles_status_check',
      type: 'c',
      definition: "CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))",
      columns: ['status'],
    },
  ],
  types: [],
}

const metadata = [
  { column_name: 'title', key: 'display_name', value: ' Headline ' },
  { column_name: 'title', key: 'renderers', value: { list: 'truncate' } },
  { column_name: 'title', key: 'views', value: { list: 'show', record: 'readonly' } },
  { column_name: 'words', key: 'purpose', value: 'How long it is' },
  // A saying about a collection names no column, and is no field's.
  { column_name: null, key: 'display_name', value: 'Articles' },
].map((row) => ({
  scope: 'field' as const,
  schema_name: 'newsroom',
  table_name: 'articles',
  ...row,
}))

export const fields = resolveFields(catalog, 'newsroom', 'articles', metadata)
export const named = (name: string): Field => fields.find((field) => field.name === name)!
