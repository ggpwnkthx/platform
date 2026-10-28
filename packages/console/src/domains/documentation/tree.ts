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
  /** The documents of the group. */
  readonly documents: readonly Document[]
}

/**
 * The names of the directories of the documentation.
 *
 * The access service and the data service are not named by their
 * directory: the directory of the access service is `access`, and the
 * service is the access service.
 */
const TITLES: Record<string, string> = {
  platform: 'The platform',
  gateway: 'The gateway',
  access: 'The access service',
  data: 'The data service',
  console: 'The console',
  '': 'The documentation',
}

/** The title of a group of documents. */
export function titleOf(directory: string): string {
  return TITLES[directory] ?? directory
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
 * The groups of the documentation.
 *
 * The documents of the documentation of the platform come first, and
 * the documents of a contract follow the contract.
 */
export function groupsOf(tree: Tree): Group[] {
  const groups = new Map<string, Document[]>()
  for (const document of tree.documents) {
    const group = groups.get(document.directory) ?? []
    group.push(document)
    groups.set(document.directory, group)
  }
  const order = ['', 'platform', 'gateway', 'access', 'data', 'console']
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const rank = (name: string): number => {
        const index = order.indexOf(name)
        return index === -1 ? order.length : index
      }
      return rank(left) - rank(right)
    })
    .map(([name, documents]) => ({
      name,
      title: titleOf(name),
      documents: [...documents].sort((left, right) => left.path.localeCompare(right.path)),
    }))
}
