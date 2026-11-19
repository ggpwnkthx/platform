/**
 * The vocabulary the platform speaks, written once.
 *
 * The operator's tools and the interface both build SQL — a manifest applied to a database,
 * a collection made in the browser — and they must build it the same way: the same name has
 * to mean the same column, the same literal the same value, and the same grant the same
 * right, whichever wrote it. They also both read the same tokens and the same versions.
 *
 * This package has no dependencies and runs in the browser, in Bun and in Node: everything
 * here is either the text of a statement or the reading of a token.
 */

export * from './core.ts'
export * from './dcl.ts'
export * from './errors.ts'
export * from './token.ts'
export * from './transaction.ts'
export * from './version.ts'
