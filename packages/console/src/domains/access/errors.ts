/**
 * The refusals of Access.
 *
 * A refusal of the service is shown as it is: its code, its message and
 * the identifier of the request in the logs of the service. The console
 * never rewrites a refusal into one of its own.
 */

import { ClientError } from '@platform/client'

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

/**
 * Reads the refusal of the client of the platform.
 *
 * The client of the platform raises the refusal of a service as it read
 * it, and the console shows it as it is: it never rewrites a refusal
 * into one of its own.
 *
 * @param error the failure of the client.
 */
export function failureOf(error: unknown): AccessError {
  if (error instanceof ClientError) {
    return new AccessError({
      status: error.status,
      code: error.code,
      message: error.message,
      requestId: error.requestId ?? null,
    })
  }
  throw error
}
