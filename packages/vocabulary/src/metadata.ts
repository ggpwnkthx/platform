/**
 * What an item says about itself: the keys the platform reserves, the saying of where a
 * field appears and how its values are drawn, and the statements that write them.
 *
 * The interface and the operator's tools both read an item's metadata and both write it.
 * They must read it the same way and write it the same way: a field that says where it
 * appears means the same thing whoever reads it, and the value written under the key
 * `views` is the same value in the page and in a psql session.
 *
 * This module runs in the browser, in Bun and in Node.
 */
export * from './metadata/keys.ts'
export * from './metadata/renderers.ts'
export * from './metadata/rows.ts'
export * from './metadata/statements.ts'
export * from './metadata/targets.ts'
export * from './metadata/views.ts'
