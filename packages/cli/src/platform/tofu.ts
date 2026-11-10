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
  type InfrastructureBootstrap,
  type InfrastructurePlan,
  type InfrastructurePort,
  type InfrastructureRun,
  type InfrastructureState,
  type InfrastructureValidation,
  type PlanSummary,
  type PlannedResource,
  type StateLock,
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

/** The number of times the templates are initialized again. */
const RETRIES = 3

/** The wait between two attempts, in milliseconds. */
const WAIT_MS = 20_000

/**
 * Reports whether the tool crashed.
 *
 * The tool crashes when it cannot read the directory of the templates,
 * and the crash is a stack trace of the tool: the reason of the crash
 * is not in it. A crash is not a state that becomes reachable, and the
 * tool is not asked again.
 *
 * @param answer what the tool said.
 */
export function crashed(answer: Answer): boolean {
  return answer.stderr.includes('OPENTOFU CRASH')
}

/**
 * The errors of a document of the tool.
 *
 * The tool answers with a json document that holds the diagnostics of
 * the templates, and the summary of an error is the reason the tool
 * gives.
 *
 * @param document the json the tool answered with.
 */
export function errorsOf(document: string): { summary: string; detail: string }[] {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(document) as Record<string, unknown>
  } catch {
    return []
  }
  const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : []
  const errors: { summary: string; detail: string }[] = []
  for (const diagnostic of diagnostics) {
    if (!diagnostic || typeof diagnostic !== 'object') continue
    const record = diagnostic as Record<string, unknown>
    if (record.severity !== 'error') continue
    const summary = record.summary ?? record.detail
    const detail = record.detail
    errors.push({
      summary: typeof summary === 'string' ? summary : 'the templates do not hold',
      detail: typeof detail === 'string' && detail !== summary ? detail : '',
    })
  }
  return errors
}

/**
 * The hint of a resource that is already there.
 *
 * A resource that a failed apply left in the cloud is not in the state
 * of the deployment, and the next apply refuses to create it again: the
 * reader is told how to write it in the state.
 *
 * @param reason what the tool said.
 */
export function hintOf(reason: string): string {
  if (!/already exists|alreadyexists|already in use|alreadyexists/i.test(reason)) return ''
  return '\nA resource that a failed apply left in the cloud is written in the state with: platformctl infra import <address> <id>'
}

/**
 * Reports whether the tool refused because the configuration of the
 * backend changed.
 *
 * The tool refuses to change the configuration of the backend on its
 * own: the state of the deployment may have to move with it, and the
 * move is a decision.
 *
 * @param stderr what the tool wrote.
 */
export function changedBackend(stderr: string): boolean {
  return stderr.includes('Backend configuration changed')
}

/**
 * The lock of the state of the deployment, as the tool names it.
 *
 * The tool refuses to write the state when another run holds its lock,
 * and it names the lock, the one who holds it and the moment it was
 * taken:
 *
 *   Error: Error acquiring the state lock
 *
 *   Error message: state blob is already locked
 *   Lock Info:
 *     ID:        74e078e2-ccfa-a2ef-6a45-0ac061764254
 *     Who:       isaac@isaac-gaming
 *     Created:   2026-11-04 21:55:29.404365078 +0000 UTC
 *
 * @param reason what the tool said.
 */
export function lockOf(reason: string): StateLock | undefined {
  if (!/state blob is already locked|Error acquiring the state lock/i.test(reason)) {
    return undefined
  }
  const id = reason.match(/^\s*ID:\s*(\S+)/m)?.[1]
  if (id === undefined) return undefined
  const who = reason.match(/^\s*Who:\s*(.+)$/m)?.[1]?.trim() ?? 'another run'
  const created = reason.match(/^\s*Created:\s*(.+)$/m)?.[1]?.trim() ?? 'a moment ago'
  return { id, who, created }
}

/**
 * Waits.
 *
 * @param milliseconds the time of the wait.
 */
async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

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
 *
 * The redaction holds a value back where the answers are drawn: the
 * tool reads the truth of the deployment, and the command that shows it
 * holds the credential back.
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
 * Reports whether a text is the configuration of the backend of the
 * state.
 *
 * The configuration of the backend is a set of attributes, and every
 * one of them holds a name and a value: a name in quotes, a number, or
 * a boolean. The tool answers with a diagnostic instead of the
 * configuration when the state of the bootstrap holds no output: a
 * diagnostic is not a configuration, and the CLI never writes a
 * diagnostic in the file of the backend.
 *
 * @param text what the tool answered with.
 */
export function isBackendConfiguration(text: string): boolean {
  if (text === '') return false
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return false
  return lines.every((line) =>
    /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"]*"|true|false|[0-9]+)$/.test(line)
  )
}

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
 * The values of the outputs, as the tool answers with them.
 *
 * The tool answers with the full metadata of every output — whether it
 * is sensitive and what its type is — and the value of an output is
 * inside that metadata. The values are what the deployment answers,
 * and the metadata is what the tool knows about them.
 *
 * @param outputs the answers of the tool.
 */
export function valuesOf(outputs: unknown): Record<string, unknown> {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return {}
  const values: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(outputs as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      values[name] = entry
      continue
    }
    const metadata = entry as { value?: unknown }
    values[name] = 'value' in metadata ? metadata.value : entry
  }
  return values
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

  /** The number of times the templates are initialized again. */
  readonly #retries: number

  /** The wait between two attempts, in milliseconds. */
  readonly #waitMs: number

  /** The telling of the progress of the tool to the operator. */
  readonly #progress: (text: string) => void

  /**
   * The tool that writes the infrastructure of the deployment.
   *
   * @param environment the environment of the process.
   * @param options what the tool needs to know of the machine.
   */
  constructor(
    environment: Readonly<Record<string, string | undefined>>,
    options: {
      readonly working?: string
      readonly download?: Download
      readonly retries?: number
      readonly waitMs?: number
      readonly progress?: (text: string) => void
    } = {}
  ) {
    this.#environment = environment
    this.#working = options.working ?? process.cwd()
    this.#download = options.download
    this.#retries = options.retries ?? RETRIES
    this.#waitMs = options.waitMs ?? WAIT_MS
    this.#progress = options.progress ?? (() => undefined)
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
   * @param stream true when the reader is shown what the tool writes.
   */
  async #run(args: readonly string[], directory: string, stream = false): Promise<Answer> {
    const binary = await this.#binary()
    try {
      return await run(binary, args, {
        cwd: directory,
        env: this.#environmentOf(),
        stream,
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

  /**
   * Creates the place where the state of the deployment lives.
   *
   * The bootstrap runs once per deployment, before the first apply of
   * the templates, and it is the only stack that runs without a
   * backend. The tool writes the configuration of the backend of the
   * state, and the deployment writes it down as `backend.hcl`.
   *
   * A bootstrap that fails is a failure, and it is the failure of the
   * tool: the CLI never answers a configuration the tool did not write,
   * and it never hides a failure of the tool behind a configuration it
   * read before.
   *
   * @param directory the directory of the bootstrap.
   * @param variables the values of the bootstrap, as the tool takes them.
   */
  async bootstrap(
    directory: string,
    variables: Readonly<Record<string, string>>
  ): Promise<InfrastructureBootstrap> {
    const initialized = await this.#run(
      [`-chdir=${directory}`, 'init', '-input=false', '-no-color'],
      process.cwd(),
      true
    )
    if (initialized.status !== 0) {
      throw new CliFailure(
        `the place where the state of the deployment lives cannot be created: ${initialized.stderr.trim()}`,
        1,
        'tool_failed'
      )
    }
    const args = [`-chdir=${directory}`, 'apply', '-input=false', '-no-color', '-auto-approve']
    for (const [name, value] of Object.entries(variables)) {
      args.push(`-var=${name}=${value}`)
    }
    const applied = await this.#run(args, process.cwd(), true)
    if (applied.status !== 0) {
      throw new CliFailure(
        `the place where the state of the deployment lives was not created: ${applied.stderr.trim() || applied.stdout.trim()}`,
        1,
        'tool_failed'
      )
    }
    const configuration = await this.#backendConfiguration(directory)
    if (configuration === undefined) {
      throw new CliFailure(
        'the configuration of the backend of the state cannot be read: the tool answered with something that is not a configuration',
        1,
        'tool_failed'
      )
    }
    return { backendConfig: configuration, created: true }
  }

  /**
   * The configuration of the backend of the state, as the tool writes it.
   *
   * The tool answers with the configuration of the backend, and it
   * answers with a diagnostic when the state of the bootstrap holds no
   * output: a diagnostic is not a configuration, and a file of the
   * backend that holds one is a file the tool cannot read.
   *
   * @param directory the directory of the bootstrap.
   */
  async #backendConfiguration(directory: string): Promise<string | undefined> {
    const answer = await this.#run(
      [`-chdir=${directory}`, 'output', '-raw', 'backend_config_hcl', '-no-color'],
      process.cwd()
    )
    if (answer.status !== 0) return undefined
    const configuration = answer.stdout.trim()
    return isBackendConfiguration(configuration) ? configuration : undefined
  }

  /**
   * Initializes the templates of the deployment against the backend of
   * the state.
   *
   * The place where the state lives was created a moment ago, and the
   * data plane of the account sees the container of the state a little
   * after the management plane created it: the init is run again while
   * it fails.
   *
   * The configuration of the backend changed: the state of the
   * deployment may have to move with it, and the tool never moves it
   * on its own. When the state cannot be moved, the templates are
   * initialized with a state that is empty, and the CLI is told that
   * the state of the deployment was not read: the plan that follows is
   * the plan of a deployment whose state is empty.
   *
   * @param directory the directory of the templates.
   * @param run what the run needs to know.
   */
  async initialize(directory: string, run: InfrastructureRun): Promise<InfrastructureState> {
    const args = [`-chdir=${directory}`, 'init', '-input=false', '-no-color']
    if (run.backendConfig) args.push(`-backend-config=${run.backendConfig}`)
    let answer = await this.#run(args, process.cwd(), true)

    // The configuration of the backend changed: the state of the
    // deployment may have to move with it, and the tool never moves it
    // on its own.
    if (answer.status !== 0 && changedBackend(answer.stderr)) {
      const migrated = await this.#run([...args, '-migrate-state'], process.cwd(), true)
      if (migrated.status === 0) return { read: true }
      const reconfigured = await this.#run([...args, '-reconfigure'], process.cwd(), true)
      if (reconfigured.status === 0) {
        // The state of the deployment could not be moved: the
        // templates are initialized against a state that is empty, and
        // the reason the state was not read is carried to the CLI.
        return { read: false, reason: migrated.stderr.trim() || migrated.stdout.trim() }
      }
      answer = migrated
    }

    for (let attempt = 0; attempt < this.#retries && answer.status !== 0; attempt += 1) {
      // A crash of the tool is not a state that becomes reachable: the
      // tool cannot read the templates, and it will not read them
      // later either.
      if (crashed(answer)) break
      process.stderr.write(
        `the state of the deployment is not reachable yet: the templates are initialized again in ${this.#waitMs / 1000} seconds\n`
      )
      await sleep(this.#waitMs)
      answer = await this.#run(args, process.cwd(), true)
    }
    if (answer.status !== 0) {
      throw new CliFailure(
        `the templates of the deployment cannot be initialized: ${await this.#reasonOf(directory, answer)}`,
        8,
        'not_initialized'
      )
    }
    return { read: true }
  }

  /**
   * The reason the tool could not initialize the templates.
   *
   * The tool crashes when it cannot read the directory of the
   * templates, and the crash is a stack trace of the tool and not a
   * reason: the tool answers with the reason when it is asked what it
   * cannot read. The answer names the file that is in the way, and the
   * operator can do something about it.
   *
   * @param directory the directory of the templates.
   * @param answer what the tool said.
   */
  async #reasonOf(directory: string, answer: Answer): Promise<string> {
    if (!crashed(answer)) return answer.stderr.trim()
    const validated = await this.#run(
      [`-chdir=${directory}`, 'validate', '-json', '-no-color'],
      process.cwd()
    )
    const errors = errorsOf(validated.stdout)
    if (errors.length === 0) return answer.stderr.trim()
    return errors
      .map((error) => (error.detail === '' ? error.summary : `${error.summary}: ${error.detail}`))
      .join('; ')
  }

  /**
   * Writes a resource of the cloud into the state of the deployment.
   *
   * The import reads the templates of the deployment, and the
   * templates read the values of the deployment: the import is told
   * where the values are, or the templates ask for them and the import
   * stops.
   *
   * @param directory the directory of the templates.
   * @param address the address of the resource in the state.
   * @param id the identifier of the resource in the cloud.
   * @param run what the run needs to know.
   */
  async import(
    directory: string,
    address: string,
    id: string,
    run: InfrastructureRun
  ): Promise<void> {
    const args = [`-chdir=${directory}`, 'import', '-input=false', '-no-color']
    if (run.varFile) args.push(`-var-file=${run.varFile}`)
    for (const [name, value] of Object.entries(run.variables ?? {})) {
      args.push(`-var=${name}=${value}`)
    }
    args.push(address, id)
    const answer = await this.#run(args, process.cwd())
    if (answer.status !== 0) {
      throw new CliFailure(
        `the resource ${address} was not written in the state: ${answer.stderr.trim()}`,
        1,
        'tool_failed'
      )
    }
  }

  /**
   * Frees the lock of the state of the deployment.
   *
   * A run that was killed leaves the lock of the state behind it, and
   * the next run cannot write the state at all: the lock is freed by
   * its identifier.
   *
   * @param directory the directory of the templates.
   * @param id the identifier of the lock.
   * @param run what the run needs to know.
   */
  async unlock(directory: string, id: string, run: InfrastructureRun): Promise<void> {
    const args = [`-chdir=${directory}`, 'force-unlock', '-force', '-no-color']
    if (run.backendConfig) args.push(`-backend-config=${run.backendConfig}`)
    args.push(id)
    const answer = await this.#run(args, process.cwd())
    if (answer.status !== 0) {
      throw new CliFailure(
        `the lock of the state of the deployment could not be freed: ${answer.stderr.trim() || answer.stdout.trim()}`,
        1,
        'tool_failed'
      )
    }
  }

  /** The plan of the deployment. */
  async plan(directory: string, run: InfrastructureRun): Promise<InfrastructurePlan> {
    const args = ['plan', '-input=false', '-no-color', '-detailed-exitcode']
    if (run.varFile) args.push(`-var-file=${run.varFile}`)
    if (run.planFile) args.push(`-out=${run.planFile}`)
    // A plan of a deployment takes a while, and an operator who sees
    // nothing for a while does not know whether the CLI is working.
    this.#progress('the plan of the deployment is written, this may take a moment')
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
      process.cwd(),
      true
    )
    if (answer.status !== 0) {
      const reason = answer.stderr.trim() || answer.stdout.trim()
      throw new CliFailure(
        `the deployment was not applied: ${reason}${hintOf(reason)}`,
        1,
        'apply_failed'
      )
    }
    return { directory, applied: plan.changes, summary: plan.summary }
  }

  /**
   * The outputs of the deployment.
   *
   * The outputs are the outputs of the state of the deployment, and the
   * tool reads the outputs of the state the templates are initialized
   * against: the templates are initialized against the backend of the
   * deployment before its outputs are read. A machine holds the
   * templates of every deployment, and the state of one deployment is
   * not the state of another.
   *
   * The state is not moved: the backend is reconfigured, and the
   * reconfiguration leaves the state of the other backend where it is.
   */
  async output(directory: string, run: InfrastructureRun): Promise<Record<string, unknown>> {
    if (run.backendConfig !== undefined) {
      const initialized = await this.#run(
        [
          `-chdir=${directory}`,
          'init',
          `-backend-config=${run.backendConfig}`,
          '-reconfigure',
          '-input=false',
          '-no-color',
        ],
        process.cwd()
      )
      if (initialized.status !== 0) {
        throw new CliFailure(
          `the outputs of the deployment cannot be read: the templates cannot be read against the state of the deployment: ${initialized.stderr.trim()}`,
          8,
          'not_initialized'
        )
      }
    }
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
    // The outputs are the truth of the deployment, credentials
    // included: the wizard of the deployment registers the tenant of
    // the deployment at Access with the token of the administration and
    // with the secrets of the client, and a held-back value is a
    // refusal the wizard cannot read. The credential is held back
    // where the answers are drawn, and not here: a line of a terminal
    // never carries one.
    return valuesOf(parsed) as Record<string, unknown>
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
    const errors = errorsOf(answer.stdout)
    return { directory, valid: errors.length === 0, errors: errors.map((e) => e.summary) }
  }
}
