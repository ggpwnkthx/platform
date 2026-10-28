/**
 * The markdown of the documentation.
 *
 * The console shows the documents of the documentation, and it renders
 * them with this parser. A document of the documentation is a markdown
 * of a known subset, and the parser refuses the markdown that is not of
 * it: a refusal is a document that the console cannot show, and the
 * suite of the console reads every document of the repository, so the
 * refusal is found before a reader finds it.
 *
 * The names of the headings are the names of the documentation: they
 * come from the same place as the ones the check of the documentation
 * resolves, so a link that names a heading reaches it in the console as
 * it does in a rendered document.
 */

import { headingLinesOf, type Heading, namesOf } from './documentation'

/**
 * A text of a document, and the marks it carries.
 *
 * The marks are the ones the documentation uses: the code, the strong
 * text, the emphasis and the link.
 */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: Inline[] }
  | { readonly kind: 'emphasis'; readonly children: Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: Inline[] }

/** An item of a list. */
export interface ListItem {
  /** The text of the item, and the marks it carries. */
  readonly inline: Inline[]
  /**
   * Whether the item is a task, and whether it is done. It is null
   * when the item is not a task.
   */
  readonly task: boolean | null
}

/** A block of a document. */
export type Block =
  | {
      readonly kind: 'heading'
      readonly level: number
      readonly id: string
      readonly inline: Inline[]
    }
  | { readonly kind: 'paragraph'; readonly inline: Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: ListItem[] }
  | { readonly kind: 'code'; readonly language: string | null; readonly text: string }
  | { readonly kind: 'table'; readonly head: Inline[][]; readonly rows: Inline[][][] }
  | {
      readonly kind: 'quote'
      /**
       * The kind of a callout, when the quote opens with one: GitHub's
       * `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` or
       * `> [!CAUTION]`. A plain quote has none.
       */
      readonly alert: Alert | null
      readonly blocks: Block[]
    }
  | { readonly kind: 'rule' }

/** The markdown the parser does not know. */
/** The kinds of callout a quote may open with. */
export type Alert = 'note' | 'tip' | 'important' | 'warning' | 'caution'

/** The marker of a callout: the first line of a quote. */
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i

export class MarkdownError extends Error {
  constructor(
    /** The line the markdown is on. */
    readonly line: number,
    message: string
  ) {
    super(`line ${line}: ${message}`)
    this.name = 'MarkdownError'
  }
}

/** A line of a document, and the block of code it is in. */
interface Scanned {
  /** The number of the line, the first line of a document being 1. */
  readonly line: number
  /** The text of the line. */
  readonly text: string
  /** Whether the line is in a block of code, or opens one. */
  readonly code: boolean
  /** Whether the line opens a block of code. */
  readonly opens: boolean
  /** Whether the line closes a block of code. */
  readonly closes: boolean
}

/** A heading of a document, and the name it carries. */
interface Named extends Heading {
  /** The name the heading carries in the address of a document. */
  readonly name: string
  /** Whether the heading is a line of text under a line of signs. */
  readonly setext: boolean
}

/** The heading of a line of a document. */
const ATX = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/

/** The first item of a list. */
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

/** The line that opens a block of code. */
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/

/** The line that closes a block of code. */
const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/

/** The line that is a rule. */
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/

/**
 * The lines of a document, and the blocks of code they are in.
 *
 * The fences are found on the way: the line that opens a block of code
 * and the lines it holds are the code of the document, and not the
 * blocks of it.
 */
function scanOf(content: string): Scanned[] {
  const scanned: Scanned[] = []
  let fence: string | null = null
  for (const [index, text] of content.split('\n').entries()) {
    const line = index + 1
    if (fence !== null) {
      const closing = CLOSING_FENCE.exec(text)
      const closes =
        closing !== null && closing[1]![0] === fence[0] && closing[1]!.length >= fence.length
      scanned.push({ line, text, code: true, opens: false, closes })
      if (closes) fence = null
      continue
    }
    const opening = FENCE.exec(text)
    if (opening) {
      fence = opening[1]!
      scanned.push({ line, text, code: true, opens: true, closes: false })
      continue
    }
    scanned.push({ line, text, code: false, opens: false, closes: false })
  }
  return scanned
}

/**
 * The headings of a document, and the names they carry.
 *
 * The names come from the documentation, so that a link that names a
 * heading reaches it in the console as it does in a rendered document.
 */
function headingsOf(content: string): Map<number, Named> {
  const headings = headingLinesOf(content)
  const names = namesOf(headings)
  const named = new Map<number, Named>()
  headings.forEach((heading, index) => {
    named.set(heading.line, { ...heading, name: names[index] ?? '' })
  })
  return named
}

/**
 * The blocks of a document.
 *
 * The parser refuses what it does not know: an image, a text struck
 * through, a text in html, a list inside a list and a heading inside a
 * quote are not the markdown of the documentation.
 */
export function parseMarkdown(content: string): Block[] {
  return blocksOf(scanOf(content), headingsOf(content))
}

/** The blocks of a set of lines. */
function blocksOf(scanned: readonly Scanned[], headings: ReadonlyMap<number, Named>): Block[] {
  const blocks: Block[] = []
  let index = 0
  while (index < scanned.length) {
    const line = scanned[index]!
    if (line.opens) {
      blocks.push(codeOf(scanned, index))
      index = codeEnd(scanned, index)
      continue
    }
    if (line.code) {
      index += 1
      continue
    }
    if (line.text.trim() === '') {
      index += 1
      continue
    }
    if (isComment(line.text)) {
      index += 1
      continue
    }
    if (ATX.test(line.text) && !headings.has(line.line)) {
      throw new MarkdownError(line.line, 'a heading that the documentation does not name')
    }
    const heading = headings.get(line.line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading.level,
        id: heading.name,
        inline: inlineOf(heading.text, line.line),
      })
      index += heading.setext ? 2 : 1
      continue
    }
    if (/^\s{0,3}>/.test(line.text)) {
      const quoted: string[] = []
      const start = index
      while (index < scanned.length) {
        const inner = scanned[index]!
        if (inner.code) break
        const match = /^\s{0,3}>\s?(.*)$/.exec(inner.text)
        if (!match) break
        quoted.push(match[1]!)
        index += 1
      }
      const marker = quoted.length > 0 ? ALERT.exec(quoted[0]!.trim()) : null
      if (marker) quoted.shift()
      blocks.push({
        kind: 'quote',
        alert: marker ? (marker[1]!.toLowerCase() as Alert) : null,
        blocks: blocksOf(scanOf(quoted.join('\n')), new Map()),
      })
      if (index === start) index += 1
      continue
    }
    if (RULE.test(line.text)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    if (line.text.includes('|') && index + 1 < scanned.length) {
      const separator = scanned[index + 1]!
      if (!separator.code && isSeparator(separator.text)) {
        const head = cellsOf(line.text)
        index += 2
        const rows: Inline[][][] = []
        while (index < scanned.length) {
          const row = scanned[index]!
          if (row.code || !row.text.includes('|') || row.text.trim() === '') break
          rows.push(cellsOf(row.text).map((cell) => inlineOf(cell, row.line)))
          index += 1
        }
        blocks.push({
          kind: 'table',
          head: head.map((cell) => inlineOf(cell, line.line)),
          rows,
        })
        continue
      }
    }
    const item = LIST_ITEM.exec(line.text)
    if (item) {
      const items: ListItem[] = []
      while (index < scanned.length) {
        const current = scanned[index]!
        if (current.code) break
        const match = LIST_ITEM.exec(current.text)
        if (!match) break
        let content = match[3]!
        const task = /^\[([ xX])\]\s+/.exec(content)
        if (task) content = content.slice(task[0].length)
        const lines = [content]
        index += 1
        while (index < scanned.length) {
          const next = scanned[index]!
          if (next.code || next.text.trim() === '') break
          const nested = LIST_ITEM.exec(next.text)
          // An item at the level of the list is the next item of the
          // list. An item that is indented is a list inside a list.
          if (nested) {
            if (nested[1] !== '') {
              throw new MarkdownError(next.line, 'a list inside a list is not supported')
            }
            break
          }
          if (!/^\s{2,}/.test(next.text)) break
          lines.push(next.text.trim())
          index += 1
        }
        items.push({
          inline: inlineOf(lines.join(' '), current.line),
          task: task ? task[1] !== ' ' : null,
        })
      }
      blocks.push({ kind: 'list', ordered: /\d/.test(item[2]!), items })
      continue
    }
    const paragraph: string[] = []
    while (index < scanned.length) {
      const current = scanned[index]!
      if (current.code || current.text.trim() === '') break
      if (paragraph.length > 0 && startsBlock(current, headings)) break
      paragraph.push(current.text.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', inline: inlineOf(paragraph.join(' '), line.line) })
  }
  return blocks
}

/** The block of code that opens at a line. */
function codeOf(scanned: readonly Scanned[], index: number): Block {
  const opening = FENCE.exec(scanned[index]!.text)
  const language = opening?.[2]?.trim() || null
  const text: string[] = []
  let cursor = index + 1
  while (cursor < scanned.length) {
    const inner = scanned[cursor]!
    if (inner.closes) break
    text.push(inner.text)
    cursor += 1
  }
  return { kind: 'code', language, text: text.join('\n') }
}

/** The line that ends the block of code that opens at a line. */
function codeEnd(scanned: readonly Scanned[], index: number): number {
  let cursor = index + 1
  while (cursor < scanned.length) {
    if (scanned[cursor]!.closes) return cursor + 1
    cursor += 1
  }
  return cursor
}

/** Reports whether a line is a comment of html. */
function isComment(text: string): boolean {
  return /^\s*<!--.*-->\s*$/.test(text)
}

/** Reports whether a line opens a block of its own. */
function startsBlock(line: Scanned, headings: ReadonlyMap<number, Named>): boolean {
  if (ATX.test(line.text)) return true
  if (headings.has(line.line)) return true
  if (LIST_ITEM.test(line.text)) return true
  if (/^\s{0,3}>/.test(line.text)) return true
  if (RULE.test(line.text)) return true
  return false
}

/**
 * Reports whether a line separates the cells of a table.
 *
 * The line holds nothing but the dashes and the colons of the cells,
 * and at least one dash.
 */
function isSeparator(text: string): boolean {
  const cells = cellsOf(text)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-+:?$/.test(cell))
}

/**
 * The cells of a row of a table.
 *
 * The pipes that a code holds are not the pipes of the row.
 */
function cellsOf(row: string): string[] {
  let text = row.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let current = ''
  let code = false
  for (const character of text) {
    if (character === '`') code = !code
    if (character === '|' && !code) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  cells.push(current.trim())
  return cells
}

/**
 * The marks of a text.
 *
 * The parser refuses what it does not know: an image, a text struck
 * through and a text in html are not the markdown of the
 * documentation.
 */
export function inlineOf(text: string, line: number): Inline[] {
  const inlines: Inline[] = []
  let buffer = ''
  const flush = (): void => {
    if (buffer === '') return
    inlines.push({ kind: 'text', text: buffer })
    buffer = ''
  }
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1)
      if (end === -1) throw new MarkdownError(line, 'a code that is not closed')
      flush()
      inlines.push({ kind: 'code', text: rest.slice(1, end) })
      index += end + 1
      continue
    }
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2)
      if (end === -1) throw new MarkdownError(line, 'a strong text that is not closed')
      flush()
      inlines.push({ kind: 'strong', children: inlineOf(rest.slice(2, end), line) })
      index += end + 2
      continue
    }
    if (rest.startsWith('*')) {
      const end = rest.indexOf('*', 1)
      if (end === -1) throw new MarkdownError(line, 'an emphasis that is not closed')
      flush()
      inlines.push({ kind: 'emphasis', children: inlineOf(rest.slice(1, end), line) })
      index += end + 1
      continue
    }
    if (rest.startsWith('![')) {
      throw new MarkdownError(line, 'an image is not supported')
    }
    if (rest.startsWith('~~')) {
      throw new MarkdownError(line, 'a text that is struck through is not supported')
    }
    if (rest.startsWith('<')) {
      throw new MarkdownError(line, 'a text in html is not supported')
    }
    if (rest.startsWith('[')) {
      const end = rest.indexOf('](')
      if (end === -1) throw new MarkdownError(line, 'a link that is not closed')
      const close = rest.indexOf(')', end)
      if (close === -1) throw new MarkdownError(line, 'a link that is not closed')
      flush()
      inlines.push({
        kind: 'link',
        href: rest.slice(end + 2, close),
        children: inlineOf(rest.slice(1, end), line),
      })
      index += close + 1
      continue
    }
    buffer += text[index]!
    index += 1
  }
  flush()
  return inlines
}
