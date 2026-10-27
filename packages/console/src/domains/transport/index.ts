/**
 * The calls of the console to the services of the platform.
 *
 * Every call has a budget: a service that does not answer in time is a
 * service that is not reachable, and the page says so instead of
 * waiting with the caller.
 */

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
