/**
 * The values of the query of a list.
 *
 * The lists of the administration are paginated, and their filters are
 * read from the query of the call: a value that is not understood is a
 * refusal, and never a page that is read from a value the caller did not
 * ask for.
 */

import { AdministrationError } from './errors'
import type { AuditFormat } from './ports'
import type { PrincipalStatus } from './ports/principals'

/** The default size of a page of the administration. */
export const DEFAULT_PAGE_SIZE = 50

/** The maximum size of a page of the administration. */
export const MAX_PAGE_SIZE = 200

/**
 * The maximum number of rows of an export of the audit.
 *
 * The export leaves the platform: it is a file that an operator keeps. The
 * number is a ceiling, not a promise: an audit that holds more rows is
 * exported page by page.
 */
export const MAX_EXPORT_ROWS = 10_000

/**
 * Reads a whole number of the query of a list.
 *
 * A value that is not a whole number, a value that is below the minimum
 * and a value that is above the maximum are refused: the page is never
 * read from a value that was not understood.
 */
export function wholeNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string
): number {
  if (value === undefined || value.trim() === '') return fallback
  const text = value.trim()
  if (!/^\d+$/.test(text)) {
    throw new AdministrationError('invalid_request', `${name} must be a whole number`)
  }
  const parsed = Number(text)
  if (parsed < min || parsed > max) {
    throw new AdministrationError('invalid_request', `${name} must be between ${min} and ${max}`)
  }
  return parsed
}

/**
 * Reads the format of the answer of the audit.
 *
 * A format that is not one of the three is refused: an export that is
 * asked for in a format the service does not know is not an export.
 */
export function auditFormat(value: string | null): AuditFormat {
  const text = (value ?? '').trim().toLowerCase()
  if (text === '' || text === 'json') return 'json'
  if (text === 'csv') return 'csv'
  if (text === 'jsonl') return 'jsonl'
  throw new AdministrationError('invalid_request', 'the format must be json, csv or jsonl')
}

/**
 * Reads the status of a principal of the query of a list.
 *
 * A status that is not one of the two of the schema is refused.
 */
export function statusOf(value: string | undefined): PrincipalStatus | null {
  if (value === undefined || value.trim() === '') return null
  const text = value.trim()
  if (text !== 'active' && text !== 'disabled') {
    throw new AdministrationError('invalid_request', 'status must be active or disabled')
  }
  return text
}

/**
 * Reads the "live" filter of the list of the grants.
 *
 * A value that is not `true` and not `false` is refused: the operator
 * does not get a list of something he did not ask for.
 */
export function liveOf(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === '') return null
  const text = value.trim().toLowerCase()
  if (text === 'true') return true
  if (text === 'false') return false
  throw new AdministrationError('invalid_request', 'live must be true or false')
}
