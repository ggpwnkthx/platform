/**
 * The documentation of the platform, in the console.
 *
 * The console shows the documentation of the platform: the documents of
 * the platform, the contracts of the three services and the console
 * itself. The console shows them and it decides nothing of them: every
 * document is the document of the repository, and the console holds the
 * build of them.
 *
 * The rules of the place are here: the tree of the documentation, and
 * the urls of the links of its documents.
 */

export type { Block, Inline } from '../../../../../tooling/markdown'
export {
  type Asset,
  type Document,
  groupsOf,
  headOf,
  labelOf,
  ledeOf,
  navigatesItself,
  neighboursOf,
  type OutlineItem,
  outlineOf,
  readingOrderOf,
  renderOf,
  type Rendered,
  textOf,
  titleOf,
  type Tree,
} from './tree'
export { resolveOf, sourceUrlOf, urlOf } from './url'
