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
