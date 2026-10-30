/**
 * The doubles of the tests.
 *
 * The CLI talks to the services of a deployment over HTTP, and the
 * tests of the CLI answer that HTTP themselves: a double of the
 * transport records what the CLI asked and answers what the test wants
 * it to answer.
 */

import type { HttpAnswer, HttpPort, HttpRequest } from '../src/domains/contracts'
import type {
  AppliedInfrastructure,
  InfrastructurePlan,
  InfrastructurePort,
  InfrastructureRun,
  InfrastructureValidation,
} from '../src/domains/infrastructure'

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

/** The tool that writes the infrastructure, as the tests answer with it. */
export class FakeInfrastructure implements InfrastructurePort {
  /** The version the tool names itself. */
  toolVersion = '1.13.2'
  /** The plan the tool answers with. */
  plan_: InfrastructurePlan = {
    directory: '/templates',
    changes: [],
    drift: [],
    summary: { create: 0, update: 0, delete: 0, replace: 0 },
    errored: false,
  }
  /** The outputs the tool answers with. */
  outputs: Record<string, unknown> = {}
  /** The answer of the validation of the templates. */
  validation: InfrastructureValidation = {
    directory: '/templates',
    valid: true,
    errors: [],
  }
  /** The runs the tool was asked for. */
  readonly runs: { directory: string; run: InfrastructureRun }[] = []
  /** The plans the tool was asked to apply. */
  readonly applied: InfrastructurePlan[] = []

  /** The version of the tool, as the tool names itself. */
  async version(): Promise<string> {
    return this.toolVersion
  }

  /** The plan of the deployment. */
  async plan(directory: string, run: InfrastructureRun): Promise<InfrastructurePlan> {
    this.runs.push({ directory, run })
    return { ...this.plan_, directory }
  }

  /** Applies a plan that the tool has written. */
  async apply(directory: string, plan: InfrastructurePlan): Promise<AppliedInfrastructure> {
    this.applied.push(plan)
    return { directory, applied: plan.changes, summary: plan.summary }
  }

  /** The outputs of the deployment. */
  async output(_directory: string, _run: InfrastructureRun): Promise<Record<string, unknown>> {
    return this.outputs
  }

  /** Checks the templates of the deployment. */
  async validate(directory: string): Promise<InfrastructureValidation> {
    return { ...this.validation, directory }
  }
}
