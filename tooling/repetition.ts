/**
 * The repetition of the documentation.
 *
 * The documentation is one tree, and a reader reads it as one thing: a
 * document that says what another document says is a document the
 * reader reads twice, and the second time is a waste of their time.
 *
 * The rule is about the sentences, not about the words: two documents
 * that use the same word are not in conflict, and two documents that
 * say the same sentence are. The sentences of a document are the ones
 * of its prose — its paragraphs and its lists — and not the ones of
 * its tables, of its code or of its headings: a table row is a fact
 * of a table, and a heading is a name.
 *
 * The engine lives here and not in the command: the command runs it,
 * and the test suite proves it.
 */

import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

/**
 * The number of words a sentence has to carry to be counted.
 *
 * A short sentence is a sentence everybody writes: "The service is
 * headless." is not a repetition of anything. A long one is a rule,
 * and a rule that two documents state is a rule the reader has to
 * read twice.
 */
const MINIMUM_WORDS = 8

/**
 * The number of words a sentence that points at another document may
 * carry.
 *
 * A sentence that ends with a link names where something else is said,
 * and it is a pointer and not a rule: the reader of the second document
 * follows it and reads the rule where it is said. A pointer is short by
 * nature: it names a place and nothing else.
 */
const POINTER_WORDS = 24

/** A sentence of a document. */
export interface Sentence {
  /** The file the sentence is in. */
  readonly file: string
  /** The line the sentence is on. */
  readonly line: number
  /** The text of the sentence. */
  readonly text: string
}

/** A block of a document: the lines between two blank lines. */
interface Block {
  /** The line the block starts on. */
  readonly line: number
  /** The lines of the block. */
  readonly lines: readonly string[]
}

/**
 * The blocks of prose of a document.
 *
 * The fences of the blocks of code are found on the way: a block that
 * opens a fence and the blocks it holds are the code of the document,
 * and not its prose. A block that is a heading, a table or a rule is
 * not prose either.
 */
function blocksOf(content: string): Block[] {
  const blocks: Block[] = []
  let lines: string[] = []
  let start = 0
  let fence: string | null = null
  const flush = (): void => {
    if (lines.length === 0) return
    blocks.push({ line: start, lines })
    lines = []
  }
  for (const [index, text] of content.split('\n').entries()) {
    if (fence !== null) {
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(text)
      if (closing && closing[1]![0] === fence[0]) fence = null
      continue
    }
    const opening = /^\s*(`{3,}|~{3,})/.exec(text)
    if (opening) {
      fence = opening[1]!
      flush()
      continue
    }
    if (text.trim() === '') {
      flush()
      continue
    }
    if (lines.length === 0) start = index + 1
    lines.push(text)
  }
  flush()
  return blocks
}

/**
 * Reports whether a block is prose.
 *
 * A heading names a thing, a table holds facts and a rule separates
 * two parts: none of them is prose.
 */
function isProse(block: Block): boolean {
  const first = block.lines[0]!.trim()
  if (/^#{1,6}\s/.test(first)) return false
  if (first.startsWith('|')) return false
  if (/^(?:[-*_]\s*){3,}$/.test(first)) return false
  return true
}

/**
 * The text of a block of prose, without the marks it carries.
 *
 * The marks of the documentation are the code, the strong text, the
 * emphasis and the link: the sentence of a document is the sentence a
 * reader reads, and not the sentence a reader sees the marks of. The
 * marker of a list item is not part of the sentence it opens.
 *
 * The link is kept whole: a sentence that points at another document is
 * recognized by its link, and two sentences that point at two places
 * are two sentences.
 */
function plainOf(lines: readonly string[]): string {
  return lines
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .join(' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The text of a sentence, without the marks it carries.
 *
 * The link of a sentence is reduced to the words it names: two
 * sentences that point at the same place in two ways are the same
 * sentence.
 */
function bareOf(sentence: string): string {
  return sentence
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The sentences of a block of prose.
 *
 * The block is split after the mark that ends a sentence, and the mark
 * that ends an abbreviation is not a mark: "e.g." ends a word and not
 * a sentence.
 */
function sentencesOf(text: string): string[] {
  const sentences: string[] = []
  let current = ''
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    current = current === '' ? part : `${current} ${part}`
    // A mark that ends a word and not a sentence: "e.g.", "i.e.",
    // "etc.", "vs." and the like. The sentence goes on.
    if (/(?:e\.g|i\.e|etc|vs|Mr|Mrs|Dr|§\d+\.)$/.test(current)) continue
    sentences.push(current)
    current = ''
  }
  if (current !== '') sentences.push(current)
  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== '')
}

/**
 * The sentences of the prose of a document.
 *
 * A paragraph is one block of text and a list is one block of items:
 * the sentences of a list are the sentences of its items.
 */
export function sentencesOfDocument(file: string, content: string): Sentence[] {
  const sentences: Sentence[] = []
  for (const block of blocksOf(content)) {
    if (!isProse(block)) continue
    for (const sentence of sentencesOf(plainOf(block.lines))) {
      sentences.push({ file, line: block.line, text: sentence })
    }
  }
  return sentences
}
/**
 * The problems of the repetition of a set of documents.
 *
 * Every document is read once, and every sentence of it is compared
 * with the sentences of the others: a sentence that two documents
 * carry is a problem, and the problem names both of them.
 */
export async function repetitionProblemsOf(
  root: string,
  files: readonly string[]
): Promise<string[]> {
  const seen = new Map<string, Sentence[]>()
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    for (const sentence of sentencesOfDocument(file, content)) {
      if (sentence.text.split(/\s+/).length < MINIMUM_WORDS) continue
      const found = seen.get(sentence.text) ?? []
      found.push(sentence)
      seen.set(sentence.text, found)
    }
  }
  const problems: string[] = []
  for (const [text, found] of seen) {
    const files = new Set(found.map((sentence) => sentence.file))
    // A sentence that one document carries twice is a repetition: the
    // reader of that document reads it twice.
    if (found.length > 1 && files.size === 1) {
      const places = found
        .map((sentence) => `${relative(root, sentence.file)}:${sentence.line}`)
        .sort()
      problems.push(`the sentence "${bareOf(text)}" is in ${places.join(', ')}`)
      continue
    }
    // A sentence that two documents carry is a repetition too, unless it
    // is a pointer: two documents may point at the same place, and the
    // reader of the second follows the pointer.
    if (files.size < 2) continue
    if (isPointer(text)) continue
    const places = found
      .map((sentence) => `${relative(root, sentence.file)}:${sentence.line}`)
      .sort()
    problems.push(`the sentence "${bareOf(text)}" is in ${places.join(', ')}`)
  }
  return problems.sort()
}

/**
 * Reports whether a sentence is a pointer.
 *
 * A pointer ends with a link and carries nothing else: it names the
 * place where a rule is said, and the reader of the pointer reads the
 * rule there.
 */
function isPointer(text: string): boolean {
  if (!/\[[^\]]*\]\([^)]+\)/.test(text)) return false
  if (text.split(/\s+/).length > POINTER_WORDS) return false
  return /\[[^\]]*\]\([^)]+\)[.!]?$/.test(text.trim())
}
