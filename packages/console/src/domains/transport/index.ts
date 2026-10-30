/**
 * The transport of the console to the services of the platform.
 *
 * Every call has a budget: a service that does not answer in time is a
 * service that is not reachable, and the page says so instead of
 * waiting with the caller.
 *
 * The transport is also the port of the clients of the platform
 * (`@platform/client`): the console answers with the network and with a
 * budget of time, and the client of the platform knows the contracts.
 */

import type { ClientTransport } from '@platform/client'

/** The transport of a client: `fetch`, or the fake of a test. */
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** A service that could not be reached, or that did not answer in time. */
export class UnreachableError extends Error {
  override readonly name = 'UnreachableError'
  /** The service that was called. */
  readonly service: string

  constructor(service: string, reason: string) {
    super(`the ${service} is not reachable: ${reason}`)
    this.service = service
  }
}

/** Calls a service within a budget. */
export async function call(
  service: string,
  fetcher: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    return await fetcher(url, { ...init, signal, redirect: 'manual' })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new UnreachableError(
      service,
      timedOut ? `no answer within ${timeoutMs} ms` : (error as Error).message
    )
  }
}

/** Reads the body of an answer as json, or as text when it is not json. */
export async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * The transport of the clients of the platform.
 *
 * The clients of the platform speak with a port of their own: this is
 * the adapter that answers it with the network of the console.
 *
 * @param service the name of the service the calls are for.
 * @param fetcher the transport of the calls.
 * @param timeoutMs the budget of a call.
 */
export function transportOf(service: string, fetcher: Fetch, timeoutMs: number): ClientTransport {
  return {
    send: async (request) => {
      const response = await call(
        service,
        fetcher,
        request.url,
        {
          method: request.method,
          headers: { ...(request.headers ?? {}) },
          ...(request.body === undefined ? {} : { body: request.body }),
        },
        timeoutMs
      )
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      return { status: response.status, headers, body: await response.text() }
    },
  }
}
