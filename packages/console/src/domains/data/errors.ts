/**
 * The refusals of Data, and of the gateway in front of it.
 *
 * A refusal of Data carries a stable code, a message and the
 * identifier of its request; a refusal of the gateway carries its own.
 * The console shows both as they are: it never says more than the
 * service said.
 */

import { bodyOf } from '../transport'

/** A refusal of Data, or of the gateway. */
export class DataError extends Error {
  override readonly name = 'DataError'
  readonly status: number
  readonly code: string
  readonly details: readonly { field: string; code: string }[]
  readonly requestId: string | null

  constructor(options: {
    status: number
    code: string
    message: string
    details?: readonly { field: string; code: string }[]
    requestId: string | null
  }) {
    super(options.message)
    this.status = options.status
    this.code = options.code
    this.details = options.details ?? []
    this.requestId = options.requestId
  }
}

/** Reads the refusal of an answer that is not a success. */
export async function refusalOf(response: Response): Promise<DataError> {
  const body = (await bodyOf(response)) as Record<string, unknown> | string | null
  const envelope = typeof body === 'object' && body !== null ? body : {}
  const error = envelope.error
  const requestId =
    (typeof envelope.requestId === 'string' ? envelope.requestId : null) ??
    response.headers.get('x-request-id')
  // The envelope of Data: `{ error: { code, message, details } }`.
  if (typeof error === 'object' && error !== null) {
    const detail = error as Record<string, unknown>
    return new DataError({
      status: response.status,
      code: typeof detail.code === 'string' ? detail.code : `HTTP_${response.status}`,
      message:
        typeof detail.message === 'string'
          ? detail.message
          : `the request failed (${response.status})`,
      details: Array.isArray(detail.details)
        ? (detail.details as { field: string; code: string }[])
        : [],
      requestId,
    })
  }
  // The envelope of the gateway: `{ error: "<code>", message }`.
  return new DataError({
    status: response.status,
    code: typeof error === 'string' ? error : `HTTP_${response.status}`,
    message:
      typeof envelope.message === 'string'
        ? envelope.message
        : typeof body === 'string' && body.length > 0 && body.length < 300
          ? body
          : `the gateway answered ${response.status}`,
    requestId,
  })
}
