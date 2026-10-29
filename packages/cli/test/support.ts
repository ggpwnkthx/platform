/**
 * The doubles of the tests.
 *
 * The CLI talks to the services of a deployment over HTTP, and the
 * tests of the CLI answer that HTTP themselves: a double of the
 * transport records what the CLI asked and answers what the test wants
 * it to answer.
 */

import type { HttpAnswer, HttpPort, HttpRequest } from '../src/domains/contracts'

/** The transport of the tests. */
export class FakeHttp implements HttpPort {
  /** The requests the CLI sent. */
  readonly requests: HttpRequest[] = []
  /** The answers the transport gives, in the order they are asked for. */
  readonly answers: HttpAnswer[] = []

  /**
   * The transport of the tests.
   *
   * @param answers the answers the transport gives.
   */
  constructor(...answers: HttpAnswer[]) {
    this.answers.push(...answers)
  }

  /**
   * Answers with a json body.
   *
   * @param status the status of the answer.
   * @param body the body of the answer.
   */
  static json(status: number, body: unknown): HttpAnswer {
    return {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'test-request' },
      body: JSON.stringify(body),
    }
  }

  /**
   * Sends a request and reads the answer.
   *
   * @param request the request of the CLI.
   */
  async send(request: HttpRequest): Promise<HttpAnswer> {
    this.requests.push(request)
    const answer = this.answers.shift()
    if (!answer) {
      throw new Error(`the double has no answer for ${request.method} ${request.url}`)
    }
    return answer
  }

  /** The last request the CLI sent. */
  get last(): HttpRequest {
    const request = this.requests[this.requests.length - 1]
    if (!request) throw new Error('the CLI sent no request')
    return request
  }
}
