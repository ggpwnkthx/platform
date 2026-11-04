/**
 * The answer of a command.
 *
 * A command answers twice: once as a value, and once as lines. The
 * value is what a script reads, and it is the same value whatever the
 * format is; the lines are what a human reads, and they are a table
 * when the answer is a list and a list of facts when it is one thing.
 *
 * The json of the CLI is stable: a script that reads it does not break
 * when the CLI draws a table differently.
 */

import { cellOf, lineOf, paint } from './color'
import type { GlobalOptions } from './commands'

/**
 * Reads the answer of a command.
 *
 * @param value the answer of the command.
 * @param globals the options of the CLI.
 * @param lines the lines of the command, when it has its own rendering.
 */
export function render(value: unknown, globals: GlobalOptions, lines?: readonly string[]): string {
  if (globals.quiet) return quietOf(value)
  switch (globals.output) {
    case 'json':
      return JSON.stringify(value, null, 2)
    case 'yaml':
      return yamlOf(value)
    default:
      // A command that has its own rendering says so, even when it
      // renders nothing: the answer of a command that draws its own
      // lines is never the table of its value.
      if (lines !== undefined) {
        return lines.map((line) => lineOf(line, globals.color)).join('\n')
      }
      return tableOf(value, globals.color)
  }
}

/**
 * The answer of a command, as the names of the things it names.
 *
 * @param value the answer of the command.
 */
function quietOf(value: unknown): string {
  // The envelope of the data API wraps the records in a `data` field,
  // and the names of the records are what the reader of a quiet answer
  // wants.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const data = (value as Record<string, unknown>).data
    if (Array.isArray(data)) return quietOf(data)
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          const id = record.id ?? record.key ?? record.slug ?? record.subject ?? record.name
          return typeof id === 'string' ? id : JSON.stringify(entry)
        }
        return String(entry)
      })
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.key ?? record.slug ?? record.subject ?? record.name
    if (typeof id === 'string') return id
  }
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * The lines of a table.
 *
 * The width of a column is the width of its plain text: the colour of
 * a cell is painted around the text and adds no width of its own.
 *
 * @param columns the names of the columns.
 * @param rows the cells of the rows.
 * @param color true when the answer is painted.
 */
export function tableLines(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  color: boolean
): string[] {
  if (columns.length === 0) return []
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => (row[index] ?? '').length))
  )
  return [
    columns
      .map((column, index) => paint(column.padEnd(widths[index]!), 'bold', color))
      .join('  ')
      .trimEnd(),
    ...rows.map((row) =>
      row
        .map((cell, index) => {
          const painted = cellOf(cell, color)
          return `${painted}${' '.repeat(widths[index]! - cell.length)}`
        })
        .join('  ')
        .trimEnd()
    ),
  ]
}

/**
 * The lines of a table of records.
 *
 * The columns are the ones the caller names, or every field of the
 * records when it names none. Every table of the CLI is drawn by this
 * function, so every table of the CLI lines up the same way.
 *
 * @param records the records of the table.
 * @param columns the columns of the table, when the caller names them.
 * @param color true when the answer is painted.
 */
export function tableOfRecords(
  records: readonly Record<string, unknown>[],
  columns: readonly string[] | undefined,
  color: boolean
): string[] {
  if (records.length === 0) return ['there is nothing']
  const used = columns ?? columnsOf(records)
  const rows = records.map((record) => used.map((column) => textOf(record[column])))
  return tableLines(used, rows, color)
}

/**
 * The lines of the facts of one thing.
 *
 * @param value the thing.
 * @param color true when the answer is painted.
 */
export function factsLines(value: unknown, color: boolean): string[] {
  if (value === null || value === undefined) return []
  if (typeof value !== 'object') return [String(value)]
  return Object.entries(value as Record<string, unknown>).map(
    ([key, entry]) => `${key}: ${cellOf(textOf(entry), color)}`
  )
}

/**
 * The fields of the records, in the order they appear.
 *
 * @param records the records of the table.
 */
function columnsOf(records: readonly Record<string, unknown>[]): string[] {
  const columns: string[] = []
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns
}

/**
 * The answer of a command, as a table.
 *
 * The width of a column is the width of its plain text: the colour of
 * a cell is painted around the text and adds no width of its own.
 *
 * @param value the answer of the command.
 * @param color true when the answer is painted.
 */
function tableOf(value: unknown, color: boolean): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    if (value.every((entry) => entry === null || typeof entry !== 'object')) {
      return value.map((entry) => String(entry)).join('\n')
    }
    const rows = value as Record<string, unknown>[]
    const columns = columnsOf(rows)
    const cells = rows.map((row) => columns.map((column) => textOf(row[column])))
    return tableLines(columns, cells, color).join('\n')
  }
  if (typeof value === 'object') {
    return factsLines(value, color).join('\n')
  }
  return String(value)
}

/**
 * The text of a cell of a table.
 *
 * @param value the value of the cell.
 */
function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * The answer of a command, as yaml.
 *
 * The emitter is a small one: the answers of the CLI are the answers
 * of the services, and they are objects, arrays and text.
 *
 * @param value the answer of the command.
 */
export function yamlOf(value: unknown): string {
  const lines = yamlLines(value, 0)
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * The lines of an answer, as yaml.
 *
 * @param value the answer of the command.
 * @param depth the depth of the lines.
 */
function yamlLines(value: unknown, depth: number): string[] {
  const indent = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`]
    const lines: string[] = []
    for (const entry of value) {
      if (entry !== null && typeof entry === 'object') {
        const nested = yamlLines(entry, depth + 1)
        const first = nested[0] ?? ''
        lines.push(`${indent}- ${first.trimStart()}`)
        lines.push(...nested.slice(1))
        continue
      }
      lines.push(`${indent}- ${scalarOf(entry)}`)
    }
    return lines
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return [`${indent}{}`]
    const lines: string[] = []
    for (const [key, entry] of entries) {
      if (entry !== null && typeof entry === 'object') {
        const nested = yamlLines(entry, depth + 1)
        if (Array.isArray(entry) && entry.length === 0) {
          lines.push(`${indent}${key}: []`)
          continue
        }
        lines.push(`${indent}${key}:`)
        lines.push(...nested)
        continue
      }
      lines.push(`${indent}${key}: ${scalarOf(entry)}`)
    }
    return lines
  }
  return [`${indent}${scalarOf(value)}`]
}

/**
 * The text of a value, as yaml.
 *
 * @param value the value.
 */
function scalarOf(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = String(value)
  if (text === '') return "''"
  if (/^[\w.@/+-][\w .@/+-]*$/.test(text) && !/^\d+$/.test(text)) return text
  return `'${text.replace(/'/g, "''")}'`
}
