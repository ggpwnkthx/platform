/**
 * The refusals of Access.
 *
 * A refusal of the service is shown as it is: its code, its message and
 * the identifier of the request in the logs of the service. The console
 * never rewrites a refusal into one of its own.
 */

import { bodyOf } from '../transport'

/** A refusal of Access. */
export class AccessError extends Error {
  override readonly name = 'AccessError'
  readonly status: number
  readonly code: string
  readonly requestId: string | null

  constructor(options: {
    status: number
    code: string
    message: string
    requestId: string | null
  }) {
    super(options.message)
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
  }
}

/** Reads the refusal of an answer that is not a success. */
export async function refusalOf(response: Response): Promise<AccessError> {
  const body = (await bodyOf(response)) as Record<string, unknown> | string | null
  const envelope = typeof body === 'object' && body !== null ? body : {}
  return new AccessError({
    status: response.status,
    code: typeof envelope.error === 'string' ? envelope.error : `http_${response.status}`,
    message:
      typeof envelope.message === 'string'
        ? envelope.message
        : typeof body === 'string' && body.length > 0 && body.length < 300
          ? body
          : `Access answered ${response.status}`,
    requestId: response.headers.get('x-request-id'),
  })
}
