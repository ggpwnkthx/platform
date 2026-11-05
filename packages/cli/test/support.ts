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
  InfrastructureBootstrap,
  InfrastructurePlan,
  InfrastructurePort,
  InfrastructureRun,
  InfrastructureState,
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
  /** The bootstraps the tool was asked for. */
  readonly bootstraps: { directory: string; variables: Readonly<Record<string, string>> }[] = []
  /** The templates the tool was asked to initialize. */
  readonly initialized: { directory: string; run: InfrastructureRun }[] = []
  /** The configuration of the backend the tool answers with. */
  backendConfig = 'resource_group_name = "platform-production-state"'
  /** The failure the tool refuses the apply with, when the test sets one. */
  failure?: Error
  /** The failure the tool refuses the plan with, when the test sets one. */
  planFailure?: Error
  /** The failure the tool refuses the creation of the place with, when the test sets one. */
  bootstrapFailure?: Error
  /** True when the tool refuses every apply, and not only the first one. */
  alwaysFails = false

  /** The version of the tool, as the tool names itself. */
  async version(): Promise<string> {
    return this.toolVersion
  }

  /** Creates the place where the state of the deployment lives. */
  async bootstrap(
    directory: string,
    variables: Readonly<Record<string, string>>
  ): Promise<InfrastructureBootstrap> {
    this.bootstraps.push({ directory, variables })
    if (this.bootstrapFailure !== undefined) {
      // The place is refused once, and the recovery writes the
      // resources that are already there in the state of the place.
      const failure = this.bootstrapFailure
      this.bootstrapFailure = undefined
      throw failure
    }
    return { backendConfig: this.backendConfig, created: true }
  }

  /** Initializes the templates of the deployment. */
  async initialize(directory: string, run: InfrastructureRun): Promise<InfrastructureState> {
    this.initialized.push({ directory, run })
    return this.state
  }

  /** The state of the deployment, as the initialization of the templates found it. */
  state: InfrastructureState = { read: true }

  /** The resources that were written in the state. */
  readonly imported: { address: string; id: string }[] = []
  /** The runs the resources were written with. */
  readonly importedRuns: { directory: string; run: InfrastructureRun }[] = []

  /** Writes a resource of the cloud into the state of the deployment. */
  async import(
    directory: string,
    address: string,
    id: string,
    run: InfrastructureRun
  ): Promise<void> {
    this.imported.push({ address, id })
    this.importedRuns.push({ directory, run })
  }

  /** The locks of the state of the deployment that were freed. */
  readonly unlocked: string[] = []

  /** Frees the lock of the state of the deployment. */
  async unlock(_directory: string, id: string, _run: InfrastructureRun): Promise<void> {
    this.unlocked.push(id)
  }

  /** The plan of the deployment. */
  async plan(directory: string, run: InfrastructureRun): Promise<InfrastructurePlan> {
    this.runs.push({ directory, run })
    if (this.planFailure !== undefined) {
      // The tool refuses once, and the test writes what is missing
      // before the plan is written again.
      const failure = this.planFailure
      this.planFailure = undefined
      throw failure
    }
    return { ...this.plan_, directory }
  }

  /** Applies a plan that the tool has written. */
  async apply(directory: string, plan: InfrastructurePlan): Promise<AppliedInfrastructure> {
    if (this.alwaysFails) {
      // The tool refuses every apply: the recovery runs the plan
      // again, and the tool refuses it again.
      throw this.failure ?? new Error('the deployment was not applied')
    }
    if (this.failure !== undefined) {
      // The tool refuses once, and the test writes the resource that
      // is already there in the state before the apply runs again.
      const failure = this.failure
      this.failure = undefined
      throw failure
    }
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
