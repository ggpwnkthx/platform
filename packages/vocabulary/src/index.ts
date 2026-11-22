/**
 * The vocabulary the platform speaks, written once.
 *
 * The operator's tools and the interface both build SQL — a manifest applied to a database,
 * a collection made in the browser — and they must build it the same way: the same name has
 * to mean the same column, the same literal the same value, and the same grant the same
 * right, whichever wrote it. They also both read the same tokens and the same versions, and
 * they both read and write an item's metadata the same way: where a field appears, and how
 * its values are drawn, is said once and means the same wherever it is said.
 *
 * This package runs in the browser, in Bun and in Node: everything
 * here is either the text of a statement, the reading of a token, or the saying of what an
 * item is.
 */

export * from './core.ts'
export * from './access.ts'
export * from './errors.ts'
export * from './metadata.ts'
export * from './model.ts'
export * from './source.ts'
export * from './token.ts'
export * from './transaction.ts'
export * from './version.ts'
