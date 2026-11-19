import type { MetadataScope, MetadataTarget } from '@platform/vocabulary'
import { systemSchema } from '../catalog/catalog.ts'
import type { Filter } from '../content/filter.ts'

/**
 * Metadata as the collection it is.
 *
 * The metadata of every item is kept in one table of the platform's own, and that table is
 * a system collection: it is read by the questions every collection is read by, a row of it
 * is changed by its id and its version as every other row is, and PostgreSQL's row security
 * decides which rows reach the reader and which they may change.
 *
 * One thing about it is its own: what a row is about. The item is named — a scope, and the
 * names of a schema, a table and a column — and not pointed at, because the platform keeps
 * no table of items to point at, and because metadata outlives its item: a dropped
 * collection leaves its metadata behind, unread. So the item of a row is composed from its
 * names, and the rows of an item are the ones a filter on those names lets through.
 */

/** The system collection that holds the metadata of every item. */
export const metadataCollection = { schema: systemSchema, table: 'item_metadata' } as const

/** The columns that name the item a row is about, in the order they narrow it. */
export const metadataTargetColumns = ['scope', 'schema_name', 'table_name', 'column_name'] as const

/** The filter that lets through the rows of one item, and no others. */
export function metadataFilter(target: MetadataTarget): Filter {
  const named = (value: string | null) =>
    value === null ? { op: 'is_null' as const, value: null } : { op: 'eq' as const, value }
  return {
    scope: { op: 'eq', value: target.scope },
    schema_name: { op: 'eq', value: target.schema },
    table_name: named(target.table),
    column_name: named(target.column),
  }
}

/** What a new row about an item starts with: the names of the item, and nothing else. */
export function metadataStart(target: MetadataTarget): Record<string, string> {
  const start: Record<string, string> = { scope: target.scope, schema_name: target.schema }
  if (target.table !== null) start.table_name = target.table
  if (target.column !== null) start.column_name = target.column
  return start
}

const scopes: readonly MetadataScope[] = ['workspace', 'collection', 'field']

/**
 * The item a row is about, composed from the names it carries — or nothing, when the row
 * does not name one in a form the platform knows.
 */
export function metadataTargetOf(
  row: Record<string, unknown> | null | undefined
): MetadataTarget | null {
  if (!row) return null
  const scope = row.scope as MetadataScope
  const schema = row.schema_name
  if (!scopes.includes(scope) || typeof schema !== 'string' || !schema) return null
  const table = typeof row.table_name === 'string' ? row.table_name : null
  const column = typeof row.column_name === 'string' ? row.column_name : null
  if (scope === 'workspace' && (table !== null || column !== null)) return null
  if (scope === 'collection' && (table === null || column !== null)) return null
  if (scope === 'field' && (table === null || column === null)) return null
  return { scope, schema, table, column }
}
