/**
 * The colour of the answer.
 *
 * The colour of the CLI is a reading aid and never a meaning: the
 * answer says the same thing in colour and without it, and a script
 * that reads the json of the CLI reads no escape at all. The colour
 * follows the terminal, and `NO_COLOR` in the environment turns it off.
 */

/** The escape that starts a colour. */
const RESET = '\u001b[0m'

/** The colours the CLI paints with. */
const COLOURS = {
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  inverse: '\u001b[7m',
} as const

/** The name of a colour. */
export type Colour = keyof typeof COLOURS

/**
 * The words that say what the state of a thing is.
 *
 * The words are the ones the answers of the platform use: `ok`,
 * `unreachable`, `refused`, and the words that mean a thing is not
 * right.
 */
const STATES: Readonly<Record<string, Colour>> = {
  ok: 'green',
  ready: 'green',
  active: 'green',
  healthy: 'green',
  create: 'green',
  created: 'green',
  fail: 'red',
  failed: 'red',
  failure: 'red',
  error: 'red',
  errors: 'red',
  unreachable: 'red',
  refused: 'red',
  denied: 'red',
  delete: 'red',
  deleted: 'red',
  destroy: 'red',
  destroyed: 'red',
  replace: 'red',
  replaced: 'red',
  warn: 'yellow',
  warning: 'yellow',
  pending: 'yellow',
  degraded: 'yellow',
  update: 'yellow',
  updated: 'yellow',
}

/**
 * Paints a text with a colour.
 *
 * @param text the text to paint.
 * @param colour the colour to paint it with.
 * @param enabled true when the answer is painted.
 */
export function paint(text: string, colour: Colour, enabled: boolean): string {
  if (!enabled || text === '') return text
  return `${COLOURS[colour]}${text}${RESET}`
}

/**
 * The colour of a word, when the word is a state.
 *
 * @param word the word to read.
 */
export function colourOf(word: string): Colour | undefined {
  return STATES[word.toLowerCase()]
}

/**
 * The colour of a cell of a table.
 *
 * A cell that is a state is painted with the colour of the state, and
 * a cell that is not a state is painted as it is.
 *
 * @param cell the text of the cell.
 * @param enabled true when the answer is painted.
 */
export function cellOf(cell: string, enabled: boolean): string {
  const colour = colourOf(cell.trim())
  return colour ? paint(cell, colour, enabled) : cell
}

/**
 * The colour of a line of the answer of a command.
 *
 * The state of a thing is the first word of the line or the last one:
 * the lines of the commands that show a state begin with it or end
 * with it, and a word in the middle of a sentence is not a state.
 *
 * @param line the line of the answer.
 * @param enabled true when the answer is painted.
 */
export function lineOf(line: string, enabled: boolean): string {
  if (!enabled) return line
  const words = line.trim().split(/\s+/)
  if (words.length === 0 || words[0] === '') return line
  const first = colourOf(words[0]!)
  if (first) {
    const painted = paint(words[0]!, first, enabled)
    return line.replace(words[0]!, () => painted)
  }
  const last = words[words.length - 1]!
  const colour = colourOf(last)
  if (!colour) return line
  const index = line.length - last.length
  return `${line.slice(0, index)}${paint(last, colour, enabled)}`
}
