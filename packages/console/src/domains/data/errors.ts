/**
 * The refusals of Data, and of the gateway in front of it.
 *
 * A refusal of Data carries a stable code, a message and the
 * identifier of its request; a refusal of the gateway carries its own.
 * The console shows both as they are: it never says more than the
 * service said.
 */

import { ClientError } from '@platform/client'

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

/**
 * Reads the refusal of the client of the platform.
 *
 * The client of the platform raises the refusal of a service as it read
 * it, and the console shows it as it is: it never rewrites a refusal
 * into one of its own.
 *
 * @param error the failure of the client.
 */
export function failureOf(error: unknown): DataError {
  if (error instanceof ClientError) {
    return new DataError({
      status: error.status,
      code: error.code,
      message: error.message,
      details: Array.isArray(error.details)
        ? (error.details as { field: string; code: string }[])
        : [],
      requestId: error.requestId ?? null,
    })
  }
  throw error
}
