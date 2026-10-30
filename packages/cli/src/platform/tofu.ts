/**
 * The tool that writes the infrastructure of the deployment.
 *
 * The tool is OpenTofu, and the CLI runs it. The CLI never reads a plan
 * of its own and never draws a plan the tool did not write: the tool
 * answers with a plan in json, and the CLI reads the json.
 *
 * The tool is not a service of the platform, and it is not the client
 * of the platform either: it is a program of the machine of the
 * operator, it is found on the path, and the CLI refuses to run it when
 * it is too old for the templates of the deployment.
 *
 * A machine that holds no tool is a machine that needs one: the CLI
 * writes the tool of the release in the working directory and runs it
 * from there. The download can be refused, and a reader who refuses it
 * is told that the tool is not there.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CliFailure } from '../domains/failure'
import { type Answer, run } from './process'
import {
  binaryNameOf,
  type Download,
  installDirectoryOf,
  installTofu,
  targetOf,
  TOFU_VERSION,
} from './tofu-release'
import {
  actionOf,
  type AppliedInfrastructure,
  type InfrastructurePlan,
  type InfrastructurePort,
  type InfrastructureRun,
  type InfrastructureValidation,
  type PlanSummary,
  type PlannedResource,
  summaryOf,
} from '../domains/infrastructure'

/**
 * The oldest tool the templates of the deployment hold against.
 *
 * The templates ask for a version of the tool, and a tool that is older
 * than the one they ask for does not read them the way they are
 * written.
 */
export const MINIMUM_TOFU = '1.9.0'

/**
 * The values of the environment that refuse the download of the tool.
 *
 * A machine that holds no tool is a machine that needs one, and the
 * release of the tool is where the right one is. A reader who wants no
 * download says so: the tool is then installed by hand, or named with
 * `TOFU_BINARY`.
 */
const REFUSES_DOWNLOAD = new Set(['0', 'off', 'false', 'no'])

/**
 * The names whose values never reach the answer of the CLI.
 *
 * The outputs of a deployment carry the credentials of the deployment,
 * and a credential never reaches a line of a terminal. The list is the
 * one of the platform (`tooling/redaction.ts`): the processes of the
 * platform hold the same names back, and the check of the redaction
 * refuses the one that does not.
 */
const SENSITIVE_NAMES = new Set([
  'accessToken',
  'access_token',
  'authorization',
  'body',
  'client_secret',
  'code_verifier',
  'connectionString',
  'cookie',
  'credential',
  'databaseUrl',
  'email',
  'filter',
  'id_token',
  'password',
  'proxy-authorization',
  'query',
  'refresh_token',
  'secret',
  'session',
  'set-cookie',
  'token',
  'x-access-session',
  'x-access-token',
  'x-amz-security-token',
  'x-api-key',
  'x-gateway-session',
  'x-gateway-signature',
  'x-gateway-token',
])

/** The value that stands for a credential in an answer. */
export const REDACTED = '(sensitive value)'

/**
 * Reports whether the name of an output carries a credential.
 *
 * The names of the outputs are written with dashes, and a name that
 * ends with the name of a credential carries one: the output of the
 * administration of Access is a token, whatever it is called.
 *
 * @param name the name of the output.
 */
export function isSensitive(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const candidate of SENSITIVE_NAMES) {
    if (normalized.includes(candidate.toLowerCase().replace(/[^a-z0-9]/g, ''))) return true
  }
  return false
}

/**
 * Holds the credentials of the outputs back.
 *
 * @param value the outputs of the deployment.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const held: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(record)) {
    held[name] = isSensitive(name) ? REDACTED : redact(entry)
  }
  return held
}

/** The changes of a plan, as the tool answers them. */
interface RawChange {
  readonly address?: string
  readonly type?: string
  readonly name?: string
  readonly provider_name?: string
  readonly change?: { readonly actions?: readonly string[] }
}

/**
 * Reads the changes of a plan out of the answer of the tool.
 *
 * @param raw the changes, as the tool names them.
 */
function changesOf(raw: unknown): PlannedResource[] {
  if (!Array.isArray(raw)) return []
  const found: PlannedResource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const change = entry as RawChange
    const actions = change.change?.actions ?? []
    const action = actionOf(actions)
    if (action === 'no-op') continue
    found.push({
      address: change.address ?? '',
      action,
      kind: change.type ?? '',
      name: change.name ?? '',
      provider: change.provider_name ?? '',
    })
  }
  return found
}

/**
 * The tool that writes the infrastructure of the deployment.
 */
export class TofuInfrastructure implements InfrastructurePort {
  /** The environment of the process. */
  readonly #environment: Readonly<Record<string, string | undefined>>

  /** The directory the CLI runs in. */
  readonly #working: string

  /** The transport that reads the release of the tool. */
  readonly #download?: Download

  /**
   * The tool that writes the infrastructure of the deployment.
   *
   * @param environment the environment of the process.
   * @param options what the tool needs to know of the machine.
   */
  constructor(
    environment: Readonly<Record<string, string | undefined>>,
    options: { readonly working?: string; readonly download?: Download } = {}
  ) {
    this.#environment = environment
    this.#working = options.working ?? process.cwd()
    this.#download = options.download
  }

  /**
   * The path of the tool, as the operator named it or as the path holds
   * it.
   *
   * The tool of the machine of the operator comes first: a tool that is
   * installed is a tool the machine proved. A machine that holds no tool
   * takes the one of the release, and the CLI writes it in the working
   * directory.
   */
  async #binary(): Promise<string> {
    const named = this.#environment.TOFU_BINARY
    if (named) return named
    const onPath = this.#onPath()
    if (onPath !== undefined) return onPath
    const written = this.#written()
    if (written !== undefined) return written
    if (!this.#mayDownload()) {
      throw new CliFailure(
        'the tool that writes the infrastructure is not on the path: install OpenTofu, or name it with TOFU_BINARY',
        4,
        'tool_missing'
      )
    }
    const directory = this.#installDirectory()
    process.stderr.write(
      `the tool that writes the infrastructure is not on the path: the release ${TOFU_VERSION} is written in ${directory}\n`
    )
    return await installTofu({
      version: TOFU_VERSION,
      directory,
      platform: process.platform,
      arch: process.arch,
      download: this.#download,
    })
  }

  /** The tool of the path of the machine, when the path holds one. */
  #onPath(): string | undefined {
    const path = this.#environment.PATH ?? ''
    for (const directory of path.split(':')) {
      if (directory === '') continue
      const candidate = join(directory, 'tofu')
      if (existsSync(candidate)) return candidate
    }
    return undefined
  }

  /** The tool the CLI wrote in the working directory, when it wrote one. */
  #written(): string | undefined {
    const candidate = join(this.#installDirectory(), this.#name())
    if (existsSync(candidate)) return candidate
    return undefined
  }

  /** The directory the tool is written in. */
  #installDirectory(): string {
    const named = this.#environment.TOFU_DIRECTORY
    if (named) return named
    return installDirectoryOf(this.#working, TOFU_VERSION)
  }

  /** The name of the tool on the machine of the operator. */
  #name(): string {
    const target = targetOf(process.platform, process.arch)
    return target === null ? 'tofu' : binaryNameOf(target)
  }

  /** True when the reader lets the CLI write the tool of the release. */
  #mayDownload(): boolean {
    const named = this.#environment.TOFU_DOWNLOAD
    if (named === undefined) return true
    return !REFUSES_DOWNLOAD.has(named.trim().toLowerCase())
  }

  /** The environment of the tool: the environment of the process, without the empty names. */
  #environmentOf(): Record<string, string> {
    const environment: Record<string, string> = {}
    for (const [name, value] of Object.entries(this.#environment)) {
      if (value === undefined) continue
      environment[name] = value
    }
    environment.TF_IN_AUTOMATION = '1'
    return environment
  }

  /**
   * Runs the tool and waits for it.
   *
   * @param args the words of the tool.
   * @param directory the directory the tool runs in.
   */
  async #run(args: readonly string[], directory: string): Promise<Answer> {
    const binary = await this.#binary()
    try {
      return await run(binary, args, {
        cwd: directory,
        env: this.#environmentOf(),
      })
    } catch (error) {
      throw new CliFailure(
        `the tool that writes the infrastructure cannot be run: ${(error as Error).message}`,
        4,
        'tool_missing'
      )
    }
  }

  /** The version of the tool, as the tool names itself. */
  async version(): Promise<string> {
    const answer = await this.#run(['version'], process.cwd())
    if (answer.status !== 0) {
      throw new CliFailure(
        `the tool that writes the infrastructure does not answer its version: ${answer.stderr.trim()}`,
        1,
        'tool_failed'
      )
    }
    const version = answer.stdout.match(/(\d+\.\d+\.\d+)/)?.[1]
    if (!version) {
      throw new CliFailure(
        'the tool that writes the infrastructure does not name its version',
        1,
        'tool_failed'
      )
    }
    return version
  }

  /** The plan of the deployment. */
  async plan(directory: string, run: InfrastructureRun): Promise<InfrastructurePlan> {
    const args = ['plan', '-input=false', '-no-color', '-detailed-exitcode']
    if (run.varFile) args.push(`-var-file=${run.varFile}`)
    if (run.planFile) args.push(`-out=${run.planFile}`)
    const answer = await this.#run([`-chdir=${directory}`, ...args], process.cwd())
    // The tool answers with the status 2 when the plan holds a change,
    // and with the status 1 when it holds an error.
    if (answer.status !== 0 && answer.status !== 2) {
      throw new CliFailure(
        `the plan of the deployment was not written: ${answer.stderr.trim() || answer.stdout.trim()}`,
        1,
        'plan_failed'
      )
    }
    if (!run.planFile) {
      return {
        directory,
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
    }
    const shown = await this.#run(
      [`-chdir=${directory}`, 'show', '-json', '-no-color', run.planFile],
      process.cwd()
    )
    if (shown.status !== 0) {
      throw new CliFailure(
        `the plan of the deployment cannot be read: ${shown.stderr.trim()}`,
        1,
        'plan_failed'
      )
    }
    let document: Record<string, unknown> = {}
    try {
      document = JSON.parse(shown.stdout) as Record<string, unknown>
    } catch {
      throw new CliFailure(
        'the plan of the deployment is not the json the tool writes',
        8,
        'invalid_plan'
      )
    }
    const changes = changesOf(document.resource_changes)
    const drift = changesOf(document.resource_drift)
    const summary: PlanSummary = summaryOf(changes)
    return {
      directory,
      changes,
      drift,
      summary,
      errored: false,
      planFile: run.planFile,
    }
  }

  /** Applies a plan that the tool has written. */
  async apply(directory: string, plan: InfrastructurePlan): Promise<AppliedInfrastructure> {
    if (!plan.planFile) {
      throw new CliFailure(
        'the plan holds no file: the tool cannot apply a plan it did not write',
        8,
        'no_plan'
      )
    }
    const answer = await this.#run(
      [`-chdir=${directory}`, 'apply', '-input=false', '-no-color', plan.planFile],
      process.cwd()
    )
    if (answer.status !== 0) {
      throw new CliFailure(
        `the deployment was not applied: ${answer.stderr.trim() || answer.stdout.trim()}`,
        1,
        'apply_failed'
      )
    }
    return { directory, applied: plan.changes, summary: plan.summary }
  }

  /** The outputs of the deployment. */
  async output(directory: string, run: InfrastructureRun): Promise<Record<string, unknown>> {
    const answer = await this.#run(
      [`-chdir=${directory}`, 'output', '-json', '-no-color'],
      process.cwd()
    )
    if (answer.status !== 0) {
      throw this.#refusal(directory, run, answer, 'the outputs of the deployment cannot be read')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(answer.stdout)
    } catch {
      throw new CliFailure(
        'the outputs of the deployment are not the json the tool writes',
        8,
        'invalid_output'
      )
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return redact(parsed) as Record<string, unknown>
  }

  /**
   * The refusal of a run of the tool.
   *
   * A deployment that is not initialized is a deployment whose state is
   * not there, and the tool says so in its own words. The CLI says it
   * in the words of the operator: the command that fixes it.
   *
   * @param directory the directory of the templates.
   * @param run what the run needs to know.
   * @param answer the answer of the tool.
   * @param message what the reader is told.
   */
  #refusal(directory: string, run: InfrastructureRun, answer: Answer, message: string): CliFailure {
    const stderr = answer.stderr
    if (stderr.includes('Backend initialization required')) {
      const backend = run.backendConfig ? ` -backend-config=${run.backendConfig}` : ''
      return new CliFailure(
        `the deployment is not initialized: run "tofu -chdir=${directory} init${backend}" with the configuration of the backend of the deployment`,
        8,
        'not_initialized'
      )
    }
    return new CliFailure(`${message}: ${stderr.trim() || answer.stdout.trim()}`, 1, 'tool_failed')
  }

  /** Checks the templates of the deployment. */
  async validate(directory: string): Promise<InfrastructureValidation> {
    const initialized = await this.#run(
      [`-chdir=${directory}`, 'init', '-backend=false', '-input=false', '-no-color'],
      process.cwd()
    )
    if (initialized.status !== 0) {
      throw new CliFailure(
        `the templates of the deployment cannot be read: ${initialized.stderr.trim()}`,
        8,
        'not_initialized'
      )
    }
    const answer = await this.#run(
      [`-chdir=${directory}`, 'validate', '-json', '-no-color'],
      process.cwd()
    )
    let document: Record<string, unknown> = {}
    try {
      document = JSON.parse(answer.stdout) as Record<string, unknown>
    } catch {
      document = {}
    }
    const diagnostics = Array.isArray(document.diagnostics) ? document.diagnostics : []
    const errors: string[] = []
    for (const diagnostic of diagnostics) {
      if (!diagnostic || typeof diagnostic !== 'object') continue
      const record = diagnostic as Record<string, unknown>
      if (record.severity !== 'error') continue
      const summary = record.summary ?? record.detail
      errors.push(typeof summary === 'string' ? summary : 'the templates do not hold')
    }
    return { directory, valid: errors.length === 0, errors }
  }
}
