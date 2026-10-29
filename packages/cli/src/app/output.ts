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
      return lines && lines.length > 0 ? lines.join('\n') : tableOf(value)
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
          const id = record.id ?? record.key ?? record.slug
          return typeof id === 'string' ? id : JSON.stringify(entry)
        }
        return String(entry)
      })
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.key ?? record.slug
    if (typeof id === 'string') return id
  }
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * The answer of a command, as a table.
 *
 * @param value the answer of the command.
 */
function tableOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    if (value.every((entry) => entry === null || typeof entry !== 'object')) {
      return value.map((entry) => String(entry)).join('\n')
    }
    const rows = value as Record<string, unknown>[]
    const columns: string[] = []
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) columns.push(key)
      }
    }
    const widths = columns.map((column) =>
      Math.max(column.length, ...rows.map((row) => cellOf(row[column]).length))
    )
    const lines = [
      columns
        .map((column, index) => column.padEnd(widths[index]!))
        .join('  ')
        .trimEnd(),
      ...rows.map((row) =>
        columns
          .map((column, index) => cellOf(row[column]).padEnd(widths[index]!))
          .join('  ')
          .trimEnd()
      ),
    ]
    return lines.join('\n')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${cellOf(entry)}`)
      .join('\n')
  }
  return String(value)
}

/**
 * The text of a cell of a table.
 *
 * @param value the value of the cell.
 */
function cellOf(value: unknown): string {
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
