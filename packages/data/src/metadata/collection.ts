import { type MetadataScope, type MetadataTarget, metadataTable } from '@platform/vocabulary'
import type { Filter } from '../content/filter.ts'

/**
 * Metadata as the collection it is.
 *
 * Every workspace keeps its metadata in a collection of its own — `item_metadata`, in the
 * workspace's schema — and that collection is read by the questions every collection is
 * read by, a row of it is changed by its id and its version as every other row is, and
 * PostgreSQL's row security decides which rows reach the reader and which they may change.
 *
 * One thing about it is its own: what a row is about. The item is named — a scope, and the
 * names of a table and a column — and not pointed at, because the platform keeps no table
 * of items to point at, and because metadata outlives its item: a dropped collection leaves
 * its metadata behind, unread. A row does not name its workspace: it is in it. So the item
 * of a row is composed from the workspace the row was read in and the names it carries, and
 * the rows of an item are the ones a filter on those names lets through.
 */

/** The collection a workspace keeps its metadata in. */
export const metadataCollection = (schema: string) => ({ schema, table: metadataTable }) as const

/** The filter that lets through the rows of one item, and no others. */
export function metadataFilter(target: MetadataTarget): Filter {
  const named = (value: string | null) =>
    value === null ? { op: 'is_null' as const, value: null } : { op: 'eq' as const, value }
  return {
    scope: { op: 'eq', value: target.scope },
    table_name: named(target.table),
    column_name: named(target.column),
  }
}

/** What a new row about an item starts with: the names of the item, and nothing else. */
export function metadataStart(target: MetadataTarget): Record<string, string> {
  const start: Record<string, string> = { scope: target.scope }
  if (target.table !== null) start.table_name = target.table
  if (target.column !== null) start.column_name = target.column
  return start
}

const scopes: readonly MetadataScope[] = ['workspace', 'collection', 'field']

/**
 * The item a row is about: the workspace the row was read in, and the names the row
 * carries — or nothing, when the row does not name an item in a form the platform knows.
 */
export function metadataTargetOf(
  schema: string,
  row: Record<string, unknown> | null | undefined
): MetadataTarget | null {
  if (!row || !schema) return null
  const scope = row.scope as MetadataScope
  if (!scopes.includes(scope)) return null
  const table = typeof row.table_name === 'string' ? row.table_name : null
  const column = typeof row.column_name === 'string' ? row.column_name : null
  if (scope === 'workspace' && (table !== null || column !== null)) return null
  if (scope === 'collection' && (table === null || column !== null)) return null
  if (scope === 'field' && (table === null || column === null)) return null
  return { scope, schema, table, column }
}
