/**
 * The roles of the documentation.
 *
 * The documentation is written once and read by people who do different
 * jobs. The directory `roles/` holds one page per job — the platform
 * operator, the security engineer, the developer… — and each page says
 * which pages that job reads, grouped by what the reader is doing:
 * where to start, the common tasks, the reference, what to do when
 * something breaks.
 *
 * The console reads the role pages and nothing else to know the roles:
 * a role is its page, its sections are the page's second-level headings,
 * and its pages are the documents the section links to, in the order
 * the page links them. A role page that changes changes the navigation
 * of its role, and no list is kept twice.
 */

import { type Block, type Inline, parseMarkdown } from '../../../../../tooling/markdown'
import type { Document, Tree } from './tree'
import { textOf } from './tree'
import { targetOf, urlOf } from './url'

/** The directory of the role pages. */
export const ROLES_DIRECTORY = 'roles'

/** A link of a role to a page of the documentation. */
export interface RoleLink {
  /** What the reader sees: the task, or the name of the page. */
  readonly label: string
  /** The path of the target in the documentation (`gateway/operations`). */
  readonly path: string
  /** The anchor of the target, with its `#`, or the empty string. */
  readonly anchor: string
  /** The address of the target in the console. */
  readonly href: string
  /** Whether the target is a document, and not a file such as the atlas. */
  readonly document: boolean
}

/**
 * An entry of a section: one task, question or page of the role page,
 * and the links that answer it.
 *
 * A list item or a table row is one entry. When the row names itself in
 * plain text ("Rotate a secret"), that text is the label and every link
 * of the row is an answer; otherwise the first link names the entry and
 * the others follow it ("Gateway spec §5", then "§6" and "§7.4").
 */
export interface RoleEntry {
  readonly label: string
  /** Where the label leads: its own link, or the only link of the entry. */
  readonly href: string | null
  /** The links shown beside the label; empty when the label is the only one. */
  readonly links: readonly RoleLink[]
  /** Every target of the entry, the label's included. */
  readonly targets: readonly RoleLink[]
}

/** A section of a role page: a heading and the entries under it. */
export interface RoleSection {
  /** The anchor of the heading on the role page. */
  readonly id: string
  /** The text of the heading. */
  readonly title: string
  readonly entries: readonly RoleEntry[]
}

/** A role: one job, read from its page. */
export interface Role {
  /** The file name of the page: `sysops`. */
  readonly id: string
  /** The page of the role. */
  readonly page: Document
  /** The name of the job: the page's title. */
  readonly title: string
  /** What the job owns: the page's summary. */
  readonly summary: string
  readonly sections: readonly RoleSection[]
  /**
   * The documents of the role in reading order: its page first, then
   * every document its sections link to, once, in the order they come.
   */
  readonly pages: readonly string[]
}

/** The file name of a document. */
function nameOf(document: Document): string {
  return document.path.slice(document.path.lastIndexOf('/') + 1)
}

/** Whether a document is a role page. */
function isRolePage(document: Document): boolean {
  return document.directory === ROLES_DIRECTORY && nameOf(document) !== 'README'
}

/** A link as the markdown writes it. */
interface RawLink {
  readonly href: string
  readonly label: string
}

/** An entry as the markdown writes it, before its links are resolved. */
interface RawEntry {
  /** The plain-text name of the entry, when it has one. */
  readonly name: string | null
  readonly links: readonly RawLink[]
}

/** The links of a text, with their labels. */
function linksOf(inlines: readonly Inline[]): RawLink[] {
  const found: RawLink[] = []
  for (const inline of inlines) {
    if (inline.kind === 'link') {
      found.push({ href: inline.href, label: textOf(inline.children).trim() })
      continue
    }
    if (inline.kind === 'strong' || inline.kind === 'emphasis')
      found.push(...linksOf(inline.children))
  }
  return found
}

/** A label that opens a sentence: its first letter in upper case, unless it is code. */
function labelOf(inlines: readonly Inline[], text: string): string {
  if (inlines[0]?.kind === 'code') return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The entries of a block. */
function rawEntriesOf(block: Block): RawEntry[] {
  if (block.kind === 'paragraph')
    return linksOf(block.inline).map((link) => ({ name: null, links: [link] }))
  if (block.kind === 'list')
    return block.items.map((item) => ({ name: null, links: linksOf(item.inline) }))
  if (block.kind === 'quote') return block.blocks.flatMap(rawEntriesOf)
  if (block.kind !== 'table') return []
  return block.rows.map((row) => {
    const [first, ...rest] = row
    const own = linksOf(first ?? [])
    if (own.length > 0) return { name: null, links: [...own, ...rest.flatMap(linksOf)] }
    const text = textOf(first ?? []).trim()
    return { name: text === '' ? null : labelOf(first ?? [], text), links: rest.flatMap(linksOf) }
  })
}

/**
 * The role of a role page.
 *
 * An entry keeps the links that reach the documentation: a link to the
 * repository or the web is not a page the console shows, and a link to
 * a role page is the choice of another role, not a page of this one.
 */
export function roleOfPage(tree: Tree, page: Document): Role {
  const resolve = (link: RawLink): RoleLink | null => {
    const target = targetOf(tree, page.source, link.href)
    if (target.kind !== 'document' && target.kind !== 'asset') return null
    if (target.kind === 'document') {
      const document = tree.documents.find((item) => item.path === target.path)
      if (!document || document.directory === ROLES_DIRECTORY) return null
    }
    const label = link.label || target.path
    return {
      label: label.charAt(0).toUpperCase() + label.slice(1),
      path: target.path,
      anchor: target.anchor,
      href: `${urlOf(target.path)}${target.anchor}`,
      document: target.kind === 'document',
    }
  }
  const sections: { id: string; title: string; entries: RoleEntry[] }[] = []
  for (const block of parseMarkdown(page.content)) {
    if (block.kind === 'heading') {
      if (block.level === 2)
        sections.push({ id: block.id, title: textOf(block.inline), entries: [] })
      continue
    }
    const section = sections[sections.length - 1]
    if (!section) continue
    for (const raw of rawEntriesOf(block)) {
      const targets = raw.links.map(resolve).filter((link): link is RoleLink => link !== null)
      if (targets.length === 0) continue
      const [first] = targets as [RoleLink, ...RoleLink[]]
      const entry: RoleEntry =
        raw.name === null
          ? { label: first.label, href: first.href, links: targets.slice(1), targets }
          : targets.length === 1
            ? { label: raw.name, href: first.href, links: [], targets }
            : { label: raw.name, href: null, links: targets, targets }
      section.entries.push(entry)
    }
  }
  const kept = sections.filter((section) => section.entries.length > 0)
  const pages = [page.path]
  for (const section of kept) {
    for (const entry of section.entries) {
      for (const link of entry.targets) {
        if (link.document && !pages.includes(link.path)) pages.push(link.path)
      }
    }
  }
  return { id: nameOf(page), page, title: page.title, summary: page.summary, sections: kept, pages }
}

/**
 * The roles of the documentation, in the order the index of the roles
 * names them, then any other by name.
 */
export function rolesOf(tree: Tree): Role[] {
  const pages = tree.documents.filter(isRolePage)
  const index = tree.documents.find(
    (document) => document.directory === ROLES_DIRECTORY && nameOf(document) === 'README'
  )
  const order: string[] = []
  if (index) {
    for (const block of parseMarkdown(index.content)) {
      for (const { href } of rawEntriesOf(block).flatMap((entry) => entry.links)) {
        const target = targetOf(tree, index.source, href)
        if (target.kind === 'document' && !order.includes(target.path)) order.push(target.path)
      }
    }
  }
  const rank = (document: Document) => {
    const position = order.indexOf(document.path)
    return position === -1 ? order.length : position
  }
  return pages
    .sort((left, right) => rank(left) - rank(right) || left.path.localeCompare(right.path))
    .map((page) => roleOfPage(tree, page))
}

/** The role of an identifier, or null when no role page has that name. */
export function roleOf(roles: readonly Role[], id: string | undefined | null): Role | null {
  if (!id) return null
  return roles.find((role) => role.id === id) ?? null
}

/** The roles that read a document: the ones whose pages link to it. */
export function rolesFor(roles: readonly Role[], path: string): Role[] {
  return roles.filter((role) => role.pages.includes(path) && role.page.path !== path)
}

/**
 * The documents before and after a document in the reading order of a
 * role, and where the document stands in it. Null when the role does not
 * read the document.
 */
export function roleNeighboursOf(
  tree: Tree,
  role: Role,
  path: string
): { previous: Document | null; next: Document | null; position: number; total: number } | null {
  const index = role.pages.indexOf(path)
  if (index === -1) return null
  const find = (at: number) =>
    tree.documents.find((document) => document.path === role.pages[at]) ?? null
  return {
    previous: find(index - 1),
    next: find(index + 1),
    position: index + 1,
    total: role.pages.length,
  }
}
