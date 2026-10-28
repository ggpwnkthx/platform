/**
 * The tree of the documentation of the platform.
 *
 * The console shows the documents of the documentation, and it holds
 * them as a tree: the documents of the platform, the contract of the
 * gateway, of the access service and of the data service, and the
 * console itself.
 *
 * The tree is built when the console is built, and it is held by the
 * server: the image of the console holds the build of the server and
 * nothing else, and the documentation is a part of that build.
 */

import { parseMarkdown, inlineOf } from '../../../../../tooling/markdown'
import type { Block, Inline } from '../../../../../tooling/markdown'
import { headingLinesOf } from '../../../../../tooling/documentation'

/** A document of the documentation. */
export interface Document {
  /**
   * The path of the document, relative to the documentation: the name
   * of the file, without its extension.
   */
  readonly path: string
  /** The path of the document in the repository. */
  readonly source: string
  /** The directory of the documentation the document is in. */
  readonly directory: string
  /** The document, as it is written. */
  readonly content: string
  /** The title of the document: the heading of its first level. */
  readonly title: string
  /** The summary of the document: the paragraph that follows its title. */
  readonly summary: string
}

/**
 * A document of the documentation, read.
 *
 * The console parses a document when a reader asks for it, and it
 * keeps the result: the blocks of a document and the title it names
 * itself with.
 */
export interface Rendered {
  /** The document the rendering is of. */
  readonly document: Document
  /** The title of the document: the heading of its first level. */
  readonly title: string
  /** The blocks of the document. */
  readonly blocks: Block[]
}

/**
 * Reads a document of the documentation.
 *
 * The names of the headings are the names of the documentation: they
 * come from the same place as the ones the check of the documentation
 * resolves, so a link that names a heading reaches it in the console as
 * it does in a rendered document.
 */
export function renderOf(document: Document): Rendered {
  const blocks = parseMarkdown(document.content)
  return {
    document,
    title: headOf(document.content, document.path).title,
    blocks,
  }
}

/**
 * Reports whether a document navigates itself.
 *
 * A document that holds a table of contents names its own sections and
 * links to them. The console does not add an outline to such a
 * document: the reader would see the same list twice.
 */
export function navigatesItself(rendered: Rendered): boolean {
  return rendered.blocks.some(
    (block) =>
      block.kind === 'heading' &&
      block.level === 2 &&
      block.inline.length === 1 &&
      block.inline[0]!.kind === 'text' &&
      block.inline[0]!.text.trim().toLowerCase() === 'contents'
  )
}

/**
 * The head of a document: its title and its summary.
 *
 * The title is the heading of its first level, and the summary is the
 * paragraph that follows it: the one line that says what the document
 * holds. The index of the documentation names every document with them,
 * and a reader chooses a document by what it holds and not by its name.
 */
export interface Head {
  /** The title of the document. */
  readonly title: string
  /** The summary of the document: its first paragraph. */
  readonly summary: string
}

/**
 * The head of a document.
 *
 * The head is read without the blocks of the document: the index of the
 * documentation names every document of it, and it reads the head of
 * every one of them.
 */
export function headOf(content: string, fallback: string): Head {
  const heading = headingLinesOf(content).find((item) => item.level === 1)
  const title = heading
    ? (() => {
        try {
          return textOf(inlineOf(heading.text, heading.line))
        } catch {
          return heading.text
        }
      })()
    : fallback
  return { title, summary: summaryOf(content) }
}

/**
 * The summary of a document: the paragraph that follows its title.
 *
 * The summary is the text of the document and not a description of it:
 * the index shows the words the document itself opens with.
 */
function summaryOf(content: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex((line) => /^#\s+\S/.test(line))
  if (start === -1) return ''
  const paragraph: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') {
      // The blank lines before the paragraph are not the end of it.
      if (paragraph.length > 0) break
      continue
    }
    if (/^#{1,6}\s/.test(line) || /^\|/.test(line) || /^```/.test(line)) break
    paragraph.push(line.trim())
  }
  const text = paragraph.join(' ')
  if (text === '') return ''
  try {
    return textOf(inlineOf(text, start + 2))
  } catch {
    return text
  }
}

/** A file of the documentation that is not a document. */
export interface Asset {
  /** The path of the file, relative to the documentation. */
  readonly path: string
  /** The path of the file in the repository. */
  readonly source: string
  /** The content of the file. */
  readonly content: string
}

/** The documentation, as the console holds it. */
export interface Tree {
  /** The documents of the documentation. */
  readonly documents: readonly Document[]
  /** The files of the documentation that are not documents. */
  readonly assets: readonly Asset[]
}

/** A group of documents: the documents of one directory. */
export interface Group {
  /** The name of the directory the group is. */
  readonly name: string
  /** The title of the group, as the documentation names it. */
  readonly title: string
  /**
   * The index of the group: the document that names the documents of
   * the group and what they hold.
   */
  readonly index: Document | null
  /** The documents of the group, and not its index. */
  readonly documents: readonly Document[]
}

/** The title of each directory of the documentation, in the order they are shown. */
const TITLES: Record<string, string> = {
  '': 'Overview',
  platform: 'Platform',
  gateway: 'Gateway',
  access: 'Access service',
  data: 'Data service',
  console: 'Console',
}

/** The order of the groups: the directories of `TITLES`, then any other, by name. */
const GROUP_ORDER = Object.keys(TITLES)

/**
 * The order of the documents of a group, by file name. The README is the
 * group's overview and comes first; a file this list does not name comes
 * after the named ones, by name.
 */
const DOCUMENT_ORDER = [
  'README',
  'spec',
  'api',
  'getting-started',
  'architecture',
  'configuration',
  'client',
  'operations',
  'recovery',
  'troubleshooting',
  'backup-restore',
  'capacity',
  'runtime',
  'upstream-identity',
  'security',
  'release',
  'compatibility',
  'development',
  'decisions',
]

/** The title of a group of documents. */
export function titleOf(directory: string): string {
  return TITLES[directory] ?? directory
}

/** The rank of a name in an order: its position, or after every named one. */
function rankOf(order: readonly string[], name: string): number {
  const index = order.indexOf(name)
  return index === -1 ? order.length : index
}

/** The file name of a document, without its directory. */
function nameOf(document: Document): string {
  return document.path.slice(document.path.lastIndexOf('/') + 1)
}

/** Sorts documents in reading order. */
function sortDocuments(documents: readonly Document[]): Document[] {
  return [...documents].sort(
    (left, right) =>
      rankOf(DOCUMENT_ORDER, nameOf(left)) - rankOf(DOCUMENT_ORDER, nameOf(right)) ||
      left.path.localeCompare(right.path)
  )
}

/**
 * The text of a text of a document, without the marks it carries.
 *
 * The title of a document and the name of a heading in the table of the
 * contents are the text of their text: a document that names itself
 * with a code shows the code in its title.
 */
export function textOf(inlines: readonly Inline[]): string {
  let text = ''
  for (const inline of inlines) {
    if (inline.kind === 'text' || inline.kind === 'code') {
      text += inline.text
      continue
    }
    if (inline.kind === 'strong' || inline.kind === 'emphasis' || inline.kind === 'link') {
      text += textOf(inline.children)
    }
  }
  return text
}

/**
 * The groups of the documentation: one per directory, in reading order.
 * The index of a group is its README, and it is not listed among the
 * group's other documents.
 */
export function groupsOf(tree: Tree): Group[] {
  const groups = new Map<string, Document[]>()
  for (const document of tree.documents) {
    const group = groups.get(document.directory) ?? []
    group.push(document)
    groups.set(document.directory, group)
  }
  return [...groups.entries()]
    .sort(
      ([left], [right]) =>
        rankOf(GROUP_ORDER, left) - rankOf(GROUP_ORDER, right) || left.localeCompare(right)
    )
    .map(([name, documents]) => {
      const sorted = sortDocuments(documents)
      const index = sorted.find((document) => nameOf(document) === 'README') ?? null
      return {
        name,
        title: titleOf(name),
        index,
        documents: index ? sorted.filter((document) => document !== index) : sorted,
      }
    })
}

/** Every document of the documentation, in the order the sidebar shows them. */
export function readingOrderOf(tree: Tree): Document[] {
  return groupsOf(tree).flatMap((group) =>
    group.index ? [group.index, ...group.documents] : [...group.documents]
  )
}

/** The documents before and after a document, in reading order. */
export function neighboursOf(
  tree: Tree,
  path: string
): { previous: Document | null; next: Document | null } {
  const order = readingOrderOf(tree)
  const index = order.findIndex((document) => document.path === path)
  if (index === -1) return { previous: null, next: null }
  return { previous: order[index - 1] ?? null, next: order[index + 1] ?? null }
}

/**
 * The label of a document in the navigation: a group's README is its
 * "Overview", any other document is named by its title.
 */
export function labelOf(document: Document): string {
  return nameOf(document) === 'README' ? 'Overview' : document.title
}

/** An entry of the outline of a page. */
export interface OutlineItem {
  readonly id: string
  readonly text: string
  readonly level: number
}

/** The outline of a document: its headings of the second and third level. */
export function outlineOf(blocks: readonly Block[]): OutlineItem[] {
  const items: OutlineItem[] = []
  for (const block of blocks) {
    if (block.kind !== 'heading' || block.level < 2 || block.level > 3) continue
    items.push({ id: block.id, text: textOf(block.inline), level: block.level })
  }
  return items
}

/**
 * The lede of a document, and the blocks that follow it.
 *
 * The first-level heading names the page and is dropped: the page header
 * says it. The paragraph that follows it is the document's summary: the
 * page header shows it as the lede, so the body does not repeat it.
 */
export function ledeOf(blocks: readonly Block[]): { lede: Inline[] | null; body: Block[] } {
  const body = blocks.filter((block) => !(block.kind === 'heading' && block.level === 1))
  const first = body[0]
  if (first?.kind === 'paragraph') {
    return { lede: first.inline, body: body.slice(1) }
  }
  return { lede: null, body }
}
