/**
 * Rows as CSV, and CSV as rows (RFC 4180): a column is quoted where it holds a comma, a
 * quote or a line break, and a quote inside one is doubled. A value that is not text is
 * written as JSON; an empty column is read as nothing given.
 */
const cell = (value: unknown) => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
export const toCsv = (header: readonly string[], rows: readonly Record<string, unknown>[]) =>
  [
    header.map(cell).join(','),
    ...rows.map((row) => header.map((h) => cell(row[h])).join(',')),
  ].join('\r\n') + '\r\n'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let column = ''
  let quoted = false
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; at < text.length; at++) {
    const c = text[at]!
    if (quoted) {
      if (c === '"' && text[at + 1] === '"') {
        column += '"'
        at++
      } else if (c === '"') quoted = false
      else column += c
    } else if (c === '"' && column === '') quoted = true
    else if (c === ',') {
      row.push(column)
      column = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[at + 1] === '\n') at++
      row.push(column)
      rows.push(row)
      row = []
      column = ''
    } else column += c
  }
  if (column !== '' || row.length) {
    row.push(column)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f !== ''))
}
