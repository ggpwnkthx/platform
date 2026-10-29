/**
 * The tree of the documentation of the platform.
 *
 * The console shows the documents of the documentation, and it holds
 * them as a tree: the documents of the platform, the contract of the
 * gateway, of Access and of Data, and the
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

/**
 * The tier of a document: what kind of reader it is for.
 *
 * - `overview`: the README of an area, the page to start with.
 * - `guides`: how to run, operate and integrate with the platform.
 * - `reference`: the contracts — specifications, APIs, configuration.
 * - `internals`: for maintainers only — collapsed in the navigation and
 *   kept out of the reading path.
 */
export type Tier = 'overview' | 'guides' | 'reference' | 'internals'

/**
 * The documents of each tier, by file name, in reading order. A file no
 * tier names is a guide, listed after the named guides by name.
 */
const TIERS: Record<Exclude<Tier, 'overview'>, readonly string[]> = {
  guides: [
    'quickstart',
    'concepts',
    'getting-started',
    'user-guide',
    'usage',
    'development',
    'modeling',
    'client',
    'operations',
    'upstream-identity',
    'troubleshooting',
    'security',
    // The task guides of `docs/guides/`, in the order a deployment meets them.
    'deploy-the-platform',
    'onboard-a-tenant',
    'manage-access',
    'put-a-service-behind-the-gateway',
    'build-an-app-on-data',
    'monitor-the-platform',
    'troubleshoot-a-request',
    'rotate-secrets',
    'back-up-and-restore',
    'upgrade-and-roll-back',
    'respond-to-an-incident',
  ],
  reference: ['spec', 'api', 'configuration'],
  internals: ['internals', 'decisions'],
}

/** The labels of the documents whose name says what they are. */
const LABELS: Record<string, string> = {
  README: 'Overview',
  spec: 'Specification',
  api: 'API',
  configuration: 'Configuration',
  internals: 'Internals',
  decisions: 'Decision log',
  quickstart: 'Quickstart',
  concepts: 'Concepts',
  'user-guide': 'User guide',
  usage: 'Usage',
  modeling: 'Modeling',
  'getting-started': 'Getting started',
  development: 'Development',
  operations: 'Operations',
  'upstream-identity': 'Upstream identity',
  client: 'Client',
  troubleshooting: 'Troubleshooting',
  security: 'Security',
  dba: 'DBA',
  sysops: 'SysOps',
  secops: 'SecOps',
  developer: 'Developer',
  maintainer: 'Maintainer',
  'end-user': 'Console user',
}

/** A group of documents: the documents of one directory. */
export interface Group {
  /** The name of the directory the group is. */
  readonly name: string
  /** The title of the group, as the documentation names it. */
  readonly title: string
  /** The overview of the group: its README. */
  readonly index: Document | null
  /** The guides of the group, in reading order. */
  readonly guides: readonly Document[]
  /** The reference pages of the group, in reading order. */
  readonly reference: readonly Document[]
  /** The pages for maintainers, in reading order. */
  readonly internals: readonly Document[]
  /** Every document of the group but its index: guides, reference, internals. */
  readonly documents: readonly Document[]
}

/** The title of each directory of the documentation, in the order they are shown. */
const TITLES: Record<string, string> = {
  '': 'Overview',
  platform: 'Platform',
  roles: 'By role',
  guides: 'Guides',
  gateway: 'Gateway',
  access: 'Access',
  data: 'Data',
  console: 'Console',
  cli: 'Command line',
}

/** The order of the groups: the directories of `TITLES`, then any other, by name. */
const GROUP_ORDER = Object.keys(TITLES)

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

/** The tier of a document, from its file name. */
export function tierOf(document: Document): Tier {
  const name = nameOf(document)
  if (name === 'README') return 'overview'
  if (TIERS.reference.includes(name)) return 'reference'
  if (TIERS.internals.includes(name)) return 'internals'
  return 'guides'
}

/** The documents of one tier, in reading order. */
function tierDocuments(
  documents: readonly Document[],
  tier: Exclude<Tier, 'overview'>
): Document[] {
  const order = TIERS[tier]
  return documents
    .filter((document) => tierOf(document) === tier)
    .sort(
      (left, right) =>
        rankOf(order, nameOf(left)) - rankOf(order, nameOf(right)) ||
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
 * The index of a group is its README; its other documents are split by
 * tier.
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
      const guides = tierDocuments(documents, 'guides')
      const reference = tierDocuments(documents, 'reference')
      const internals = tierDocuments(documents, 'internals')
      return {
        name,
        title: titleOf(name),
        index: documents.find((document) => tierOf(document) === 'overview') ?? null,
        guides,
        reference,
        internals,
        documents: [...guides, ...reference, ...internals],
      }
    })
}

/**
 * The documents a reader walks through, in the order the navigation
 * shows them: each group's overview, guides and reference. The internals
 * are not part of it.
 */
export function readingOrderOf(tree: Tree): Document[] {
  return groupsOf(tree).flatMap((group) => [
    ...(group.index ? [group.index] : []),
    ...group.guides,
    ...group.reference,
  ])
}

/**
 * The documents before and after a document. A page of the reading
 * order is followed by the next page of it, and never by a page for
 * maintainers; a page for maintainers is walked among the internals of
 * its group, and leads back to the group's overview.
 */
export function neighboursOf(
  tree: Tree,
  path: string
): { previous: Document | null; next: Document | null } {
  const document = tree.documents.find((item) => item.path === path)
  if (!document) return { previous: null, next: null }
  if (tierOf(document) === 'internals') {
    const group = groupsOf(tree).find((item) => item.name === document.directory)
    const internals = group?.internals ?? []
    const index = internals.indexOf(document)
    return {
      previous: internals[index - 1] ?? group?.index ?? null,
      next: internals[index + 1] ?? null,
    }
  }
  const order = readingOrderOf(tree)
  const index = order.indexOf(document)
  return { previous: order[index - 1] ?? null, next: order[index + 1] ?? null }
}

/**
 * The label of a document in the navigation. A document whose file name
 * says what it is carries that name ("Overview", "Specification", "API");
 * another one is named by its title when the title is short, and by its
 * file name otherwise.
 */
export function labelOf(document: Document): string {
  const name = nameOf(document)
  const known = LABELS[name]
  if (known) return known
  if (document.title.trim().split(/\s+/).length <= 3) return document.title
  const words = name.split('-').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
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
