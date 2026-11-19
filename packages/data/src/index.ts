/**
 * The data the platform reads and writes, asked of PostgreSQL and read back.
 *
 * The interface asks these questions in the page; the operator's tools ask them from a
 * terminal; a script may ask them from either. The questions are the same, so the answers
 * are the same, and the right to reach an answer is PostgreSQL's alone: every statement
 * here runs on the reader's own login, and nothing here decides a right.
 *
 * This package depends on the vocabulary and on nothing else: it holds no connection of its
 * own, and it runs in the browser, in Bun and in Node.
 */

export * from './access/query.ts'
export * from './access/types.ts'
export * from './activity/query.ts'
export * from './activity/types.ts'
export * from './catalog/catalog.ts'
export * from './catalog/query.ts'
export * from './catalog/types.ts'
export * from './content/filter.ts'
export * from './content/query.ts'
export * from './identity/query.ts'
export * from './identity/types.ts'
export * from './metadata/presentation.ts'
export * from './metadata/collection.ts'
export * from './metadata/query.ts'
export * from './workspace/query.ts'
export * from './workspace/types.ts'
