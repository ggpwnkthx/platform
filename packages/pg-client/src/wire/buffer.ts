import { Buffer } from 'buffer'

/**
 * The buffer the protocol writes with.
 *
 * `pg-protocol` writes its messages with Node's `Buffer`, which the browser does not have:
 * it reads the global one. Here the standard polyfill is given to the browser, and Node and
 * Bun keep the one they have.
 */
globalThis.Buffer ??= Buffer

export {}
