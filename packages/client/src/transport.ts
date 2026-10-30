/**
 * The transport of the clients of the platform.
 *
 * The console and the CLI are clients of the services of the platform,
 * and they speak to them over HTTP. The transport is a port: it is a
 * promise of a shape, and every implementation of it is free to be
 * another one. The console answers with the network and with a budget
 * of time, the CLI answers with the network and with a dry run that
 * writes nothing, and the tests of the two answer with a double.
 *
 * The refusal of a service is read here, once: the gateway and Access
 * answer `{"error":"<code>","message":"<text>"}` and the data API
 * answers `{"error":{"code":"<CODE>","message":"<text>"},"requestId":"<id>"}`.
 * The code of the refusal is what a script branches on, and the text is
 * what a human reads.
 */

/** The methods a client of the platform uses. */
export type ClientMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** A request of a client of the platform. */
export interface ClientRequest {
  /** The method of the request. */
  readonly method: ClientMethod
  /** The absolute address of the request. */
  readonly url: string
  /** The headers of the request. */
  readonly headers?: Readonly<Record<string, string>>
  /** The body of the request, when it carries one. */
  readonly body?: string
}

/** The answer of a service of the platform. */
export interface ClientAnswer {
  /** The status of the answer. */
  readonly status: number
  /** The headers of the answer. */
  readonly headers: Readonly<Record<string, string>>
  /** The body of the answer, as it was received. */
  readonly body: string
}

/** The transport of a client of the platform. */
export interface ClientTransport {
  /**
   * Sends a request and reads the answer.
   *
   * The port never throws for a refusal of a service: a refusal is an
   * answer with a status, and the caller decides what it means.
   */
  send(request: ClientRequest): Promise<ClientAnswer>
}

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
 * Reads the body of an answer as json, or as the text it was.
 *
 * @param answer the answer of the service.
 */
export function bodyOf(answer: ClientAnswer): unknown {
  if (answer.body.trim() === '') return null
  try {
    return JSON.parse(answer.body)
  } catch {
    return answer.body
  }
}

/**
 * Reads the refusal of an answer that is not a success.
 *
 * An answer that carries no readable refusal is a refusal nobody can
 * name, and it is reported with the status it was given.
 *
 * @param answer the answer of the service.
 */
export function refusalOf(answer: ClientAnswer): Refusal {
  const body = bodyOf(answer)
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
 * The request id of an answer.
 *
 * The services write the id of the request in a header and in the body,
 * and it is the handle the operator gives to the support of a
 * deployment.
 *
 * @param answer the answer of the service.
 */
export function requestIdOf(answer: ClientAnswer): string | undefined {
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

/**
 * The refusal of a service, raised by a client.
 *
 * The client raises it and the consumer of the client decides what a
 * refusal means: the console shows it as it is, and the CLI turns it
 * into the failure that carries the exit code of the command.
 */
export class ClientError extends Error {
  override readonly name = 'ClientError'
  /** The status of the refusal. */
  readonly status: number
  /** The code of the refusal. */
  readonly code: string
  /** The details of the refusal, when the service sent some. */
  readonly details?: unknown
  /** The identifier of the request, when the service sent one. */
  readonly requestId?: string

  constructor(options: {
    status: number
    code: string
    message: string
    details?: unknown
    requestId?: string
  }) {
    super(options.message)
    this.status = options.status
    this.code = options.code
    if (options.details !== undefined) this.details = options.details
    if (options.requestId !== undefined) this.requestId = options.requestId
  }
}

/**
 * Reports whether an answer is a success.
 *
 * @param answer the answer of the service.
 */
export function isSuccess(answer: ClientAnswer): boolean {
  return answer.status >= 200 && answer.status < 300
}

/**
 * Raises the refusal of an answer that is not a success.
 *
 * @param answer the answer of the service.
 * @param what the name of the call, for the message of the refusal.
 */
export function expectSuccess(answer: ClientAnswer, what: string): unknown {
  if (isSuccess(answer)) return bodyOf(answer)
  const refusal = refusalOf(answer)
  const requestId = requestIdOf(answer)
  throw new ClientError({
    status: answer.status,
    code: refusal.code,
    message: `${what}: ${refusal.message}`,
    ...(refusal.details === undefined ? {} : { details: refusal.details }),
    ...(requestId === undefined ? {} : { requestId }),
  })
}

/** A value of a query of the platform. */
export type QueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | Readonly<Record<string, unknown>>
  | undefined
  | null

/** The query of a call of the platform. */
export type Query = Readonly<Record<string, QueryValue>>

/**
 * Reads a query as the string of an url.
 *
 * A value that is a list is joined with commas, a value that is an
 * object is written as json, and a value that is nothing is left out of
 * the query.
 *
 * @param query the query of the call.
 */
export function queryOf(query: Query | undefined): string {
  if (!query) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.join(','))
      continue
    }
    if (typeof value === 'object') {
      search.set(key, JSON.stringify(value))
      continue
    }
    search.set(key, String(value))
  }
  return search.toString()
}
