/// <reference types="vite/client" />

/**
 * The module the build of the console gives to the server: the
 * documentation of the platform, parsed.
 */
declare module 'virtual:documentation' {
  import type { Asset, Document } from '../domains/documentation'

  /** The documents of the documentation. */
  export const documents: Document[]
  /** The files of the documentation that are not documents. */
  export const assets: Asset[]
}
