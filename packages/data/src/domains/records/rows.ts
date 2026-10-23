/**
 * The rows of the records domain.
 *
 * The module maps the rows of the statements to the rows of the domain,
 * and it holds the paging of the expansion of a relation.
 *
 * The mapping never adds a field and never reads one that the statement
 * did not project: the payload of a row of the domain is the payload
 * that the policies of the deployment granted for that row, and it was
 * built by the database.
 */

import type { FieldDefinition } from '../schema'
import type { AggregateMetricColumn, SortColumn } from './sql'
import type { AggregateFunction, AggregateGroup } from './types'
import { EXPANSION_CHUNK_BYTES, EXPANSION_MAX_CHUNK_ROWS } from './types'

/** The row of a read, as the statement returns it. */
export interface SelectedRow {
  id: string
  version: number
  payload: Record<string, unknown>
  relations: string[]
  /** The values of the columns of the sort, with the rank of the nulls. */
  position: unknown[]
  /** The values of the foreign keys of the relations, hidden from the answer. */
  foreignKeys: Record<string, unknown>
  /** The size of the payload, in bytes, as the database measured it. */
  size: number
}

/**
 * Maps a row of a statement to the row of the domain.
 *
 * The position of the row is the tuple of the sort: it is the position
 * of the page that follows it.
 */
export function mapRow(
  row: Record<string, unknown>,
  sort: readonly SortColumn[],
  foreignKeys: readonly string[]
): SelectedRow {
  const payload = (row.payload ?? {}) as Record<string, unknown>
  const relations = (row.relations ?? {}) as Record<string, unknown>
  const position: unknown[] = []
  sort.forEach((_column, index) => {
    position.push(row[`n${index}`] ?? 0)
    position.push(row[`s${index}`] ?? null)
  })
  const keys: Record<string, unknown> = {}
  foreignKeys.forEach((field, index) => {
    keys[field] = row[`f${index}`] ?? null
  })
  return {
    id: String(row.id),
    version: Number(row.version ?? 1),
    payload,
    relations: Object.keys(relations).filter((name) => relations[name] === true),
    position,
    foreignKeys: keys,
    size: Number(row.size ?? 0),
  }
}

/**
 * Reports whether a function of an aggregate is defined for a type.
 *
 * The sum and the average are the functions of the numbers, and the
 * minimum and the maximum are the functions of the values that have an
 * order. The rules are the rules of the operators of the filters: a
 * function that is not defined for a type is refused before the
 * statement runs.
 */
export function supportsAggregate(fn: AggregateFunction, definition: FieldDefinition): boolean {
  if (fn === 'sum' || fn === 'avg') {
    return definition.type === 'integer' || definition.type === 'decimal'
  }
  return ['string', 'text', 'integer', 'decimal', 'uuid', 'timestamp', 'enum'].includes(
    definition.type
  )
}

/**
 * Maps the row of an aggregate to the group it holds.
 *
 * The values of the group and the values of the metrics are the values
 * of the rows: a minimum of a field is the field as a row carries it.
 */
export function mapAggregate(
  row: Record<string, unknown>,
  groupBy: readonly string[],
  metrics: readonly AggregateMetricColumn[]
): AggregateGroup {
  const group: Record<string, unknown> = {}
  groupBy.forEach((field, index) => {
    group[field] = row[`g${index}`] ?? null
  })
  const result: {
    group: Record<string, unknown>
    count: number
    sum?: Record<string, string | null>
    avg?: Record<string, string | null>
    min?: Record<string, unknown>
    max?: Record<string, unknown>
  } = {
    group,
    count: Number(row.count ?? '0'),
  }
  for (const metric of metrics) {
    const value = row[`${metric.function}:${metric.field}`] ?? null
    if (metric.function === 'sum') {
      result.sum = { ...(result.sum ?? {}), [metric.field]: value === null ? null : String(value) }
      continue
    }
    if (metric.function === 'avg') {
      result.avg = { ...(result.avg ?? {}), [metric.field]: value === null ? null : String(value) }
      continue
    }
    if (metric.function === 'min') {
      result.min = { ...(result.min ?? {}), [metric.field]: value }
      continue
    }
    result.max = { ...(result.max ?? {}), [metric.field]: value }
  }
  return result
}

/**
 * The size of the next chunk of an expansion.
 *
 * The chunk aims at a mebibyte: a collection of small rows is read in
 * big chunks, and a collection of large rows is read in small ones. The
 * chunk never grows beyond the bound of the contract, and it is never
 * empty: a chunk of one row is slow, and it is the last resort.
 */
export function nextChunkSize(current: number, bytes: number, rows: number): number {
  if (rows <= 0 || bytes <= 0) return current
  const perRow = bytes / rows
  const wanted = Math.floor(EXPANSION_CHUNK_BYTES / perRow)
  return Math.min(EXPANSION_MAX_CHUNK_ROWS, Math.max(1, wanted))
}
