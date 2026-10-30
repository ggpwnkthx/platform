/**
 * The answers of the services.
 *
 * Every service of the platform answers a refusal in its own shape, and
 * the CLI reads both of them: the gateway and Access answer
 * `{"error":"<code>","message":"<text>"}`, and the data API answers
 * `{"error":{"code":"<CODE>","message":"<text>"},"requestId":"<id>"}`.
 *
 * The code of the refusal is what a script branches on, and the text is
 * what a human reads: the CLI never guesses the meaning of a message.
 */

import { ClientError } from '@platform/client'
import type { HttpAnswer } from './contracts'
import { CliFailure, exitCodeOf } from './failure'

/** The refusal of a service, read from its answer. */
export interface Refusal {
  /** The code of the refusal. */
  readonly code: string
  /** The text of the refusal. */
  readonly message: string
  /** The details of the refusal, when the service sent some. */
  readonly details?: unknown
}

/**
 * Reads the refusal of an answer that is not a success.
 *
 * An answer that carries no readable refusal is a refusal nobody can
 * name, and it is reported with the status it was given.
 *
 * @param answer the answer of the service.
 */
export function refusalOf(answer: HttpAnswer): Refusal {
  let body: unknown
  try {
    body = JSON.parse(answer.body)
  } catch {
    return { code: `http_${answer.status}`, message: answer.body.slice(0, 400) }
  }
  if (typeof body !== 'object' || body === null) {
    return { code: `http_${answer.status}`, message: answer.body.slice(0, 400) }
  }
  const record = body as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') {
    const message = typeof record.message === 'string' ? record.message : error
    return { code: error, message }
  }
  if (typeof error === 'object' && error !== null) {
    const inner = error as Record<string, unknown>
    const code = typeof inner.code === 'string' ? inner.code : `http_${answer.status}`
    const message = typeof inner.message === 'string' ? inner.message : code
    return inner.details === undefined
      ? { code, message }
      : { code, message, details: inner.details }
  }
  return { code: `http_${answer.status}`, message: answer.body.slice(0, 400) }
}

/**
 * Reads the body of a successful answer.
 *
 * @param answer the answer of the service.
 * @param what the name of the thing that was asked, for the refusal.
 */
export function bodyOf(answer: HttpAnswer): unknown {
  if (answer.body.trim() === '') return null
  try {
    return JSON.parse(answer.body)
  } catch {
    return answer.body
  }
}

/**
 * Reads a successful answer, or refuses.
 *
 * @param answer the answer of the service.
 * @param what the name of the thing that was asked, for the refusal.
 */
export function expectSuccess(answer: HttpAnswer, what: string): unknown {
  if (answer.status >= 200 && answer.status < 300) return bodyOf(answer)
  const refusal = refusalOf(answer)
  throw new CliFailure(
    `${what}: ${refusal.message}`,
    exitCodeOf(answer.status, refusal.code),
    refusal.code,
    refusal.details
  )
}

/**
 * Reads the refusal of the client of the platform.
 *
 * The client of the platform raises the refusal of a service as it read
 * it, and the CLI turns it into the failure that carries the status the
 * process ends with.
 *
 * @param error the failure of the client.
 */
export function failureOf(error: unknown): CliFailure {
  if (error instanceof ClientError) {
    return new CliFailure(
      error.message,
      exitCodeOf(error.status, error.code),
      error.code,
      error.details
    )
  }
  throw error
}

/**
 * The request id of an answer.
 *
 * The services write the id of the request in a header and in the body,
 * and it is the handle the operator gives to the support of a
 * deployment.
 *
 * @param answer the answer of the service.
 */
export function requestIdOf(answer: HttpAnswer): string | undefined {
  const header = answer.headers['x-request-id']
  if (header) return header
  if (answer.body.trim() === '') return undefined
  try {
    const body = JSON.parse(answer.body) as Record<string, unknown>
    const id = body.requestId
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}
