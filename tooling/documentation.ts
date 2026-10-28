/**
 * The links of the documentation.
 *
 * The documentation of the platform is one tree, and a link that points
 * at nothing is a dead end for the reader. A link names two things: the
 * document it points at, and the place inside it, when it names one.
 * The checker resolves the path of every link, and the name of every
 * place it names.
 *
 * The name of a place is the name of a heading: the text of the
 * heading, in lower case, without the punctuation it does not carry,
 * with the spaces replaced by hyphens. It is the name the reader sees
 * in the address of a rendered document, and it is the name a link has
 * to carry to reach it. Two headings of the same name carry two names:
 * the second carries the name of the first with a number at its end.
 *
 * A link in a block of code is the text of an example, and a name in a
 * block of code is a comment of a shell: neither is a link of the
 * document, nor a heading of it.
 *
 * The engine lives here and not in the command: the command runs it,
 * and the test suite proves it.
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

/**
 * Reports whether a character is one of the punctuation that the name
 * of a heading does not carry.
 *
 * It is the punctuation of the ascii, and the punctuation of the
 * typography. The hyphen and the underscore are not punctuation of a
 * name: a name keeps them, and so does the number.
 */
function isPunctuation(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  if (code < 0x20) return true // the control characters
  if (code >= 0x21 && code <= 0x2c) return true // ! " # $ % & ' ( ) * + ,
  if (code === 0x2e) return true // .
  if (code === 0x2f) return true // /
  if (code >= 0x3a && code <= 0x40) return true // : ; < = > ? @
  if (code >= 0x5b && code <= 0x5e) return true // [ \ ] ^
  if (code === 0x60) return true // `
  if (code >= 0x7b && code <= 0x7f) return true // { | } ~ and the delete
  if (code >= 0x2000 && code <= 0x206f) return true // the punctuation of the typography
  if (code >= 0x2e00 && code <= 0x2e7f) return true // the supplementary punctuation
  if (code >= 0x3000 && code <= 0x303f) return true // the punctuation of the asian scripts
  if (code >= 0xfe00 && code <= 0xfe0f) return true // the selectors of a variation
  if (code >= 0xff00 && code <= 0xffef) return true // the full width forms
  return false
}

/** A link of a document. */
export interface Link {
  /** The file the link is in. */
  readonly file: string
  /** The line the link is on. */
  readonly line: number
  /**
   * The path of the document the link names, relative to the file the
   * link is in. It is the empty string when the link names a place of
   * the file it is in.
   */
  readonly path: string
  /** The name of the place the link names, or the empty string. */
  readonly anchor: string
}

/** A line of a document, and the number it has. */
interface Line {
  /** The number of the line, the first line of a document being 1. */
  readonly line: number
  /** The text of the line. */
  readonly text: string
}

/**
 * The lines of a document, outside the blocks of code.
 *
 * The fences of the blocks of code are found on the way: a line that
 * opens a fence and the lines it holds are not lines of the document.
 */
function linesOf(content: string): Line[] {
  const lines: Line[] = []
  let fence: string | null = null
  for (const [index, text] of content.split('\n').entries()) {
    const opening = /^\s*(`{3,}|~{3,})/.exec(text)
    if (fence !== null) {
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(text)
      if (closing && closing[1]![0] === fence[0] && closing[1]!.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (opening) {
      fence = opening[1]!
      continue
    }
    lines.push({ line: index + 1, text })
  }
  return lines
}

/**
 * The name a heading carries.
 *
 * The name is the text of the heading, in lower case, without the
 * punctuation it does not carry, with the spaces replaced by hyphens.
 * The markup of the heading is not part of it: the code of a heading is
 * its text, and a link in a heading is the text it names.
 */
export function slugOf(text: string): string {
  const plain = text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .toLowerCase()
    .trim()
  let name = ''
  for (const character of plain) {
    if (!isPunctuation(character)) name += character
  }
  return name.replace(/ /g, '-')
}

/**
 * The names of the headings of a document.
 *
 * A heading of the same name as another one carries a number at the end
 * of its name, so that every one of them keeps a name of its own.
 */
export function headingsOf(content: string): Set<string> {
  const names = new Set<string>()
  const occurrences = new Map<string, number>()
  const lines = linesOf(content)
  for (let index = 0; index < lines.length; index += 1) {
    const { text } = lines[index]!
    const atx = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text)
    if (atx) {
      names.add(nameOf(slugOf(atx[1]!), occurrences))
      continue
    }
    // A heading of the second kind: a line of text under a line of
    // equal signs or of hyphens.
    const under = lines[index + 1]
    if (!under || text.trim() === '') continue
    if (!/^\s{0,3}(?:=+|-+)\s*$/.test(under.text)) continue
    names.add(nameOf(slugOf(text.trim()), occurrences))
  }
  return names
}

/**
 * The name of a heading, and the number it carries.
 *
 * The first heading of a name carries the name itself, the second
 * carries the name with a 1 at its end, and the third with a 2.
 */
function nameOf(name: string, occurrences: Map<string, number>): string {
  let slug = name
  while (occurrences.has(slug)) {
    const count = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, count)
    slug = `${name}-${count}`
  }
  occurrences.set(slug, 0)
  return slug
}

/** The names of the elements of an html document. */
function elementsOf(content: string): Set<string> {
  const names = new Set<string>()
  for (const match of content.matchAll(/\sid=(["'])(.*?)\1/g)) names.add(match[2]!)
  return names
}

/**
 * Every relative link of a document.
 *
 * A link that names a url is not a path of the repository: it is not
 * resolved. A link that names a place of the file it is in carries no
 * path, and a link that names a document and a place carries both.
 */
export function linksOf(file: string, content: string): Link[] {
  const links: Link[] = []
  for (const { line, text } of linesOf(content)) {
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!
      // A link that is a url, a mail address or a protocol relative url
      // is not a path of the repository.
      if (/^(?:[a-z]+:|\/\/)/i.test(target)) continue
      const hash = target.indexOf('#')
      if (hash === -1) {
        links.push({ file, line, path: target, anchor: '' })
        continue
      }
      links.push({ file, line, path: target.slice(0, hash), anchor: target.slice(hash + 1) })
    }
  }
  return links
}

/**
 * The names a document carries.
 *
 * A markdown document carries the names of its headings, and an html
 * document the names of its elements. A file of another kind carries
 * none, and a link that names a place of it cannot be resolved.
 */
function namesOf(target: string, content: string): Set<string> | null {
  if (target.endsWith('.md')) return headingsOf(content)
  if (target.endsWith('.html')) return elementsOf(content)
  return null
}

/**
 * The problems of the links of a set of documents.
 *
 * Every document is read once, and every name is computed once. A link
 * that points at a document that is not there is a problem, and a link
 * that points at a place that is not there is a problem too.
 */
export async function linkProblemsOf(root: string, files: readonly string[]): Promise<string[]> {
  const problems: string[] = []
  const names = new Map<string, Set<string> | null>()
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    for (const link of linksOf(file, content)) {
      const target = link.path === '' ? file : resolve(dirname(file), link.path)
      if (link.path !== '') {
        const found = await stat(target).then(
          (answer) => answer,
          () => null
        )
        if (!found) {
          problems.push(
            `${relative(root, file)}:${link.line} points at ${link.path}, which is not there`
          )
          continue
        }
        // A directory is not a document, and it holds no name.
        if (!found.isFile()) continue
      }
      if (link.anchor === '') continue
      let known = names.get(target)
      if (known === undefined) {
        const read = await readFile(target, 'utf8').catch(() => null)
        known = read === null ? null : namesOf(target, read)
        names.set(target, known)
      }
      if (!known) continue
      if (known.has(link.anchor)) continue
      const kind = target.endsWith('.md') ? 'heading' : 'element'
      problems.push(
        `${relative(root, file)}:${link.line} points at ${link.anchor}, and ` +
          `${relative(root, target)} has no ${kind} of that name`
      )
    }
  }
  return problems
}
