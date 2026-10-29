/**
 * The transport of the CLI.
 *
 * The CLI speaks HTTP to the services of a deployment, and it speaks
 * nothing else: it never reaches a database and it never reads the
 * state of the gateway. A service that cannot be reached is a failure
 * the reader is told about, and not a stack trace.
 *
 * The timeout of a call is the timeout of the deployment: a call that
 * hangs is a call that holds the shell of the operator.
 */

import type { HttpAnswer, HttpPort, HttpRequest } from '../domains/contracts'
import { CliFailure } from '../domains/failure'

/** The timeout of a call, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** The transport that answers with the network. */
export class FetchHttp implements HttpPort {
  /** The timeout of a call, in milliseconds. */
  readonly timeoutMs: number
  /** True when the transport writes the calls it makes. */
  readonly verbose: boolean
  /** The id of the requests, when the reader named one. */
  readonly requestId?: string

  /**
   * The transport that answers with the network.
   *
   * @param timeoutMs the timeout of a call, in milliseconds.
   * @param verbose true when the transport writes the calls it makes.
   * @param requestId the id of the requests.
   */
  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS, verbose = false, requestId?: string) {
    this.timeoutMs = timeoutMs
    this.verbose = verbose
    this.requestId = requestId
  }

  /**
   * Sends a request and reads the answer.
   *
   * @param request the request to send.
   */
  async send(request: HttpRequest): Promise<HttpAnswer> {
    const headers: Record<string, string> = { accept: 'application/json', ...request.headers }
    if (this.requestId) headers['x-request-id'] = this.requestId
    if (request.token) headers.authorization = `Bearer ${request.token}`
    if (request.body !== undefined && headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json'
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      if (this.verbose) {
        process.stderr.write(`→ ${request.method} ${request.url}\n`)
      }
      const answer = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.body,
        signal: controller.signal,
      })
      const received: Record<string, string> = {}
      answer.headers.forEach((value, key) => {
        received[key.toLowerCase()] = value
      })
      if (this.verbose) {
        process.stderr.write(`← ${answer.status} ${request.url}\n`)
      }
      return { status: answer.status, headers: received, body: await answer.text() }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new CliFailure(`the service cannot be reached: ${reason}`, 7, 'unreachable')
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * The transport that writes nothing.
 *
 * A command that changes something is asked twice by an operator: once
 * to see what it would do, and once to do it. The dry run answers the
 * first one with the request it would have sent.
 */
export class DryRunHttp implements HttpPort {
  /**
   * Sends a request that is not sent.
   *
   * @param request the request that would be sent.
   */
  async send(request: HttpRequest): Promise<HttpAnswer> {
    const body = request.body === undefined ? null : safeJson(request.body)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dryRun: true,
        method: request.method,
        url: request.url,
        body,
        ok: true,
        revision: 0,
        errors: [],
        conflicts: [],
        warnings: [],
      }),
    }
  }
}

/**
 * Reads a body as json, or as the text it was.
 *
 * @param body the body of a request.
 */
function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}
