/**
 * The helpers of the routes (spec §9).
 *
 * The module reads the parameters of the path and the body of a write,
 * and it hands the context of a request to the routes that need it.
 */

import type { Context } from 'hono'
import type { RequestContext } from '../domains/authorization'
import {
  AGGREGATE_FUNCTIONS,
  type AggregateFunction,
  type AggregateMetric,
} from '../domains/records'
import { ServiceError } from '../protocol/errors'
import type { AppEnv } from './types'

/**
 * The identifier of a record.
 *
 * An identifier that is not a uuid names no record: the answer is the
 * same as the answer of a record that does not exist.
 */
export function collectionOf(c: Context<AppEnv>): string {
  return c.req.param('collection') ?? ''
}

/** The identifier of a record of a request. */
export function recordOf(c: Context<AppEnv>): string {
  return recordId(c.req.param('id') ?? '')
}

/** The identifier of a record. */
export function recordId(value: string): string {
  if (
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  ) {
    throw new ServiceError('NOT_FOUND')
  }
  return value.toLowerCase()
}

/** The context of a request, when it is established. */
export function requireContext(c: Context<AppEnv>): RequestContext {
  const context = c.get('context') as RequestContext | undefined
  if (!context) {
    throw new ServiceError('UNAUTHENTICATED')
  }
  return context
}

/** Reads the body of a write. */
export async function readJsonBody(
  c: Context<AppEnv>,
  maxBytes: number
): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ServiceError('INVALID_REQUEST', {
      message: 'the body must be a json document',
    })
  }
  const text = await c.req.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new ServiceError('PAYLOAD_TOO_LARGE')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ServiceError('INVALID_REQUEST', { message: 'the body is not json' })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceError('INVALID_REQUEST', { message: 'the body is not an object' })
  }
  return parsed as Record<string, unknown>
}

/** Parses a json value of a query. */
function _parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new ServiceError('INVALID_QUERY', { message: 'the filter is not json' })
  }
}

/**
 * Parses the metrics of an aggregate.
 *
 * A metric is `count`, or a function and a field: `sum:amount`. The
 * function is checked by the domain, and the field with it.
 */
export function parseMetrics(value: string): AggregateMetric[] {
  const metrics: AggregateMetric[] = []
  for (const entry of value.split(',')) {
    const name = entry.trim()
    if (name.length === 0) continue
    if (name === 'count') continue
    const separator = name.indexOf(':')
    if (separator <= 0 || separator === name.length - 1) {
      throw new ServiceError('INVALID_QUERY', {
        message: 'a metric is count, or a function and a field',
      })
    }
    const fn = name.slice(0, separator)
    const field = name.slice(separator + 1)
    if (!(AGGREGATE_FUNCTIONS as readonly string[]).includes(fn)) {
      throw new ServiceError('INVALID_QUERY', { message: `the function "${fn}" is not known` })
    }
    metrics.push({ function: fn as AggregateFunction, field })
  }
  if (metrics.length === 0) {
    // The count of the rows is always part of the answer.
    return []
  }
  return metrics
}
