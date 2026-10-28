/**
 * The documentation of the platform, as the console holds it.
 *
 * The documentation is read when the console is built, and the build
 * holds it: the image of the console holds the build of the server and
 * nothing else.
 *
 * A document is parsed when a reader asks for it, and the console
 * keeps the blocks of the documents it has read: the documentation is
 * the same for every reader of the console.
 */

import { assets, documents } from 'virtual:documentation'
import { renderOf, type Rendered, type Tree } from '../domains/documentation'

/** The documentation of the platform, as the console holds it. */
export const DOCUMENTATION: Tree = { documents, assets }

/** The documents that are read, and the blocks they hold. */
const read = new Map<string, Rendered>()

/**
 * The document of the documentation, read.
 *
 * The document is null when the documentation holds no document of that
 * name.
 */
export function renderedOf(path: string): Rendered | null {
  const known = read.get(path)
  if (known) return known
  const document = DOCUMENTATION.documents.find((item) => item.path === path)
  if (!document) return null
  const rendered = renderOf(document)
  read.set(path, rendered)
  return rendered
}
