/**
 * The PostgreSQL client the platform speaks with.
 *
 * The page speaks PostgreSQL's protocol itself: there is no server of ours between the
 * reader and the database. This package is that client — the protocol, the browser's way
 * of carrying it, and the logins a page keeps open — and nothing else. It knows nothing
 * about the interface, and nothing about what a statement means: that is the vocabulary's
 * business, in `@platform/sql`, and the questions' business, in `@platform/data`.
 *
 * It has no dependencies and runs in the browser, in Bun and in Node.
 */

export * from './kept.ts'
export * from './socket.ts'
export * from './wire.ts'
