/**
 * The queries of the requests (spec §9).
 *
 * The module reads the parameters of a query and refuses the ones that
 * are not known, that appear twice or that are too long. A parameter
 * that the caller repeats is a parameter whose answer depends on the
 * reader, and it is refused.
 */

import { ServiceError } from '../protocol/errors'

/** The parameters of a query, with the detection of the repetitions. */
export class QueryError extends ServiceError {
  constructor(message: string) {
    super('INVALID_QUERY', { message })
  }
}

/**
 * Reads the parameters of a query.
 *
 * A parameter that appears twice is refused: the answer would depend on
 * which value the reader picked.
 */
export function readQuery(url: URL, allowed: readonly string[]): Map<string, string> {
  const raw = url.search.startsWith('?') ? url.search.slice(1) : url.search
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) {
    throw new QueryError('the query is too long')
  }
  const values = new Map<string, string>()
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key)) {
      throw new QueryError(`the parameter "${key}" is not known`)
    }
    if (values.has(key)) {
      throw new QueryError(`the parameter "${key}" appears twice`)
    }
    values.set(key, value)
  }
  return values
}

/** Parses a json value of a query. */
export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new ServiceError('INVALID_QUERY', { message: 'the filter is not json' })
  }
}
