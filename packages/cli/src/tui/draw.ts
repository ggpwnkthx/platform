/**
 * The drawing of the interface.
 *
 * The interface draws frames: the reader sees the same thing every
 * time it draws, and the frame fills the screen of the terminal. The
 * drawing is a function of the state and of the size of the terminal,
 * and nothing else: a frame is drawn the same way twice, and the tests
 * of the interface prove it.
 */

import { cellOf, paint } from '../app/color'

/** The character that starts an escape of the terminal. */
const ESCAPE_CHARACTER = String.fromCharCode(27)

/** The escape that starts an answer of the terminal. */
const ESCAPE = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z]`, 'g')

/** The letters of a text and the escapes between them. */
const PIECES = new RegExp(`(${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z])|([^${ESCAPE_CHARACTER}]+)`, 'g')

/**
 * The number of the columns a text takes on the screen.
 *
 * The colour of a text is painted around it and takes no room of its
 * own: the width of a text is the width of its letters.
 *
 * @param text the text.
 */
export function visibleLength(text: string): number {
  return text.replace(ESCAPE, '').length
}

/**
 * Cuts a text to the width of a column.
 *
 * @param text the text.
 * @param width the number of the columns of the column.
 */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (visibleLength(text) <= width) return text
  const keep = width - 1
  let out = ''
  let used = 0
  // The text is cut on its letters, and the escapes of the text are
  // kept: a cell that is painted is painted when it is drawn.
  const pieces = text.match(PIECES) ?? []
  for (const piece of pieces) {
    if (piece.startsWith(ESCAPE_CHARACTER)) {
      out += piece
      continue
    }
    if (used + piece.length <= keep) {
      out += piece
      used += piece.length
      continue
    }
    out += piece.slice(0, Math.max(0, keep - used))
    used = keep
    break
  }
  if (out.includes(ESCAPE_CHARACTER)) out += '\u001b[0m'
  return `${out}…`
}

/**
 * The lines of a text that is wider than its column.
 *
 * The text is cut between its words, and a word that is wider than the
 * column is cut where the column ends. The lines that do not fit are
 * left out, and the last line that is kept says so.
 *
 * @param text the text, without colour.
 * @param width the number of the columns of the column.
 * @param most the number of the lines the text takes at most.
 */
export function wrapOf(text: string, width: number, most: number): string[] {
  if (width <= 0 || most <= 0) return []
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    let rest = word
    if (line !== '' && line.length + 1 + rest.length > width) {
      lines.push(line)
      line = ''
    }
    while (rest.length > width) {
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    line = line === '' ? rest : `${line} ${rest}`
  }
  lines.push(line)
  if (lines.length <= most) return lines
  return [...lines.slice(0, most - 1), truncate(`${lines[most - 1]!} …`.padEnd(width + 1), width)]
}

/**
 * Fills a text to the width of a column.
 *
 * @param text the text.
 * @param width the number of the columns of the column.
 */
export function pad(text: string, width: number): string {
  const length = visibleLength(text)
  return length >= width ? text : text + ' '.repeat(width - length)
}

/**
 * The rows a list shows, and where the list starts.
 *
 * A list that is longer than the screen shows the rows around the
 * selection: the reader never loses the row they are on.
 *
 * @param items the rows of the list.
 * @param selection the index of the selected row.
 * @param height the number of the rows the screen holds.
 */
export function windowOf<T>(
  items: readonly T[],
  selection: number,
  height: number
): { readonly items: readonly T[]; readonly offset: number } {
  if (items.length <= height) return { items, offset: 0 }
  const offset = Math.max(0, Math.min(selection - Math.floor(height / 2), items.length - height))
  return { items: items.slice(offset, offset + height), offset }
}

/**
 * The lines of a table.
 *
 * The width of a column is the width of its plain text: the colour of
 * a cell is painted around the text and adds no width of its own. The
 * selected row is marked, and the mark is drawn before the first
 * column, so that every table of the interface lines up. A table that
 * is painted draws the selected row as a bar across its whole width:
 * the reader finds the row they are on at a glance.
 *
 * @param columns the names of the columns.
 * @param rows the cells of the rows.
 * @param selection the index of the selected row.
 * @param width the number of the columns of the table.
 * @param color true when the table is painted.
 * @param empty what the table says when it has no row.
 */
export function tableOf(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  selection: number,
  width: number,
  color: boolean,
  empty = 'there is nothing here'
): string[] {
  if (columns.length === 0 || rows.length === 0) {
    return ['', `  ${paint(truncate(empty, Math.max(1, width - 2)), 'dim', color)}`]
  }
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => (row[index] ?? '').length))
  )
  const gap = 2
  const mark = 2
  const fitted = fittedOf(widths, width - mark, gap)
  const head = columns
    .map((column, index) =>
      paint(pad(truncate(column, fitted[index]!), fitted[index]!), 'bold', color)
    )
    .join(' '.repeat(gap))
  const lines = [`  ${head}`.trimEnd()]
  rows.forEach((row, index) => {
    const selected = index === selection
    const cells = row
      .map((cell, column) => {
        const cut = truncate(cell, fitted[column]!)
        // The bar of the selected row is one colour from one end to
        // the other: the colour of a state would end the bar where
        // the state ends.
        return pad(selected && color ? cut : cellOf(cut, color), fitted[column]!)
      })
      .join(' '.repeat(gap))
    if (selected && color) {
      lines.push(paint(pad(truncate(`▸ ${cells}`, width), width), 'inverse', color))
      return
    }
    lines.push(`${selected ? '▸' : ' '} ${cells}`.trimEnd())
  })
  return lines
}

/**
 * The widths of the columns of a table.
 *
 * A table that is wider than the screen is cut, and it is cut where
 * it costs the least: the room is taken from the widest columns, a
 * letter at a time, and a short column — a state, a count — is read
 * whole next to an identifier that is not.
 *
 * @param widths the natural widths of the columns.
 * @param room the number of the columns the table has.
 * @param gap the number of the columns between two columns.
 */
function fittedOf(widths: readonly number[], room: number, gap: number): number[] {
  const fitted = [...widths]
  let over = fitted.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1) - room
  while (over > 0) {
    let widest = 0
    for (let index = 1; index < fitted.length; index += 1) {
      if (fitted[index]! > fitted[widest]!) widest = index
    }
    if (fitted[widest]! <= 4) break
    fitted[widest] = fitted[widest]! - 1
    over -= 1
  }
  return fitted
}

/**
 * The lines of a panel.
 *
 * A panel holds a title and its lines, and it is drawn with the lines
 * of the frame around it. The panel is as wide and as high as it is
 * told to be, and not more: two panels that are drawn side by side
 * keep both of their sides.
 *
 * @param title the title of the panel.
 * @param lines the lines of the panel.
 * @param width the number of the columns of the panel.
 * @param height the number of the rows of the panel.
 * @param color true when the panel is painted.
 */
export function panelOf(
  title: string,
  lines: readonly string[],
  width: number,
  height: number,
  color: boolean
): string[] {
  if (height < 2 || width < 6) return []
  const inner = width - 4
  const name = truncate(title, Math.max(1, width - 6))
  const rule = '─'.repeat(Math.max(0, width - 5 - visibleLength(name)))
  const side = paint('│', 'dim', color)
  const out = [
    `${paint('┌─', 'dim', color)} ${paint(name, 'bold', color)} ${paint(`${rule}┐`, 'dim', color)}`,
  ]
  for (let index = 0; index < height - 2; index += 1) {
    out.push(`${side} ${pad(truncate(lines[index] ?? '', inner), inner)} ${side}`)
  }
  out.push(paint(`└${'─'.repeat(width - 2)}┘`, 'dim', color))
  return out
}

/**
 * The lines of two blocks that are drawn side by side.
 *
 * @param left the lines of the block on the left.
 * @param right the lines of the block on the right.
 * @param width the number of the columns of the block on the left.
 */
export function besideOf(
  left: readonly string[],
  right: readonly string[],
  width: number
): string[] {
  const lines: string[] = []
  const height = Math.max(left.length, right.length)
  for (let index = 0; index < height; index += 1) {
    lines.push(`${pad(truncate(left[index] ?? '', width), width)} ${right[index] ?? ''}`.trimEnd())
  }
  return lines
}

/**
 * The bar of the keys, at the bottom of the screen.
 *
 * A bar that is wider than the screen does not cut a hint in two: it
 * leaves hints out, the last ones first, and it keeps the last hint of
 * all, which is the one that opens the page of the keys.
 *
 * @param hints the keys and what they do.
 * @param width the number of the columns of the bar.
 * @param color true when the bar is painted.
 */
export function keybarOf(
  hints: readonly (readonly [string, string])[],
  width: number,
  color: boolean
): string {
  const kept = [...hints]
  const plain = (): number =>
    kept.reduce((sum, [key, what]) => sum + key.length + what.length + 1, 0) +
    2 * Math.max(0, kept.length - 1) +
    1
  while (kept.length > 1 && plain() > width) kept.splice(kept.length - 2, 1)
  const text = kept
    .map(([key, what]) => `${paint(key, 'bold', color)} ${paint(what, 'dim', color)}`.trimEnd())
    .join('  ')
  return truncate(` ${text}`, width)
}

/**
 * A frame that fills the screen.
 *
 * @param lines the lines of the frame.
 * @param columns the number of the columns of the screen.
 * @param rows the number of the rows of the screen.
 */
export function frameOf(lines: readonly string[], columns: number, rows: number): string {
  const out: string[] = []
  for (let index = 0; index < rows; index += 1) {
    const line = lines[index]
    out.push(line === undefined ? '' : truncate(line, columns))
  }
  return out.join('\n')
}
