/**
 * The wizard of a deployment.
 *
 * The deployment of the platform is written in OpenTofu, and the values
 * of a deployment name one deployment. The wizard signs the operator in
 * to the system of the provider, asks the questions the provider
 * declares, writes the file of the values, and goes on with the
 * deployment: it creates the place where the state of the deployment
 * lives, it initializes the templates, and it applies the plan of the
 * deployment once the operator confirms it.
 *
 * The wizard writes the files of the deployment in the directory of the
 * deployment: the file of the values, the configuration of the backend
 * of the state and the plan. The state itself belongs to the tool, and
 * the wizard writes none of it.
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CommandInput, CommandResult, CommandSpec, GroupSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import { ask, confirm } from '../../app/prompt'
import { CliFailure } from '../../domains/failure'
import {
  appliedOf,
  changesNothing,
  type InfrastructureBootstrap,
  type InfrastructurePlan,
  type InfrastructurePort,
  questionOf,
} from '../../domains/infrastructure'
import {
  answerOf,
  defaultsOf,
  type DeploymentProvider,
  type Found,
  type Importable,
  PLATFORM_IMAGES,
  problemOf,
  problemsOf,
  type Question,
  questionsOf,
  type SignIn,
  valuesFile,
  type Values,
} from '../../domains/deployment'
import { azureProvider } from '../../platform/azure'
import { isAddress, publicAddressOf, rangeOf, servicesOf } from '../../platform/address'
import { digestOf, repositoryOf, tagOf } from '../../platform/registry'
import { pathOf, placeOf, templatesAtTagOf, templatesStateOf } from '../../platform/checkout'
import { contractOf, differencesOf } from '../../platform/contract'
import { type Release, releaseOf } from '../../platform/release'
import { VERSION } from '../../runtime/version'
import { planContext, tableOfChanges, toolOf, unlockState } from './infrastructure'

/** The directory of the templates, when the reader names none. */
const DEFAULT_DIRECTORY = join('deploy', 'tofu', 'azure')

/** The name of the file of the values of the deployment. */
const VALUES = 'terraform.tfvars'

/** The name of the example of the values of the templates. */
const EXAMPLE = 'terraform.tfvars.example'

/** The name of the file of the configuration of the backend of the state. */
const BACKEND = 'backend.hcl'

/** The name of the file of the plan of the deployment. */
const PLAN = 'plan.bin'

/** The name of the value that holds the addresses that reach the state. */
const ADDRESSES = 'operator_addresses'

/**
 * The notes of the wizard.
 *
 * A note is a thing the operator is told about the deployment that is
 * under way. The note is told as it is made, and the answer of the
 * command keeps the outcome of the deployment and nothing else.
 */
class Notes extends Array<string> {
  /** The telling of a note to the operator. */
  readonly tell: (text: string) => void

  /**
   * The notes of the wizard.
   *
   * @param tell the telling of a note to the operator.
   */
  constructor(tell: (text: string) => void) {
    super()
    this.tell = tell
  }

  /**
   * The array of the notes is an array of notes, and not an array of
   * a length: the methods that build a new array build a plain one.
   */
  static override get [Symbol.species](): ArrayConstructor {
    return Array
  }

  /**
   * Makes a note and tells the operator about it.
   *
   * @param items the notes.
   */
  override push(...items: string[]): number {
    for (const item of items) this.tell(item)
    return super.push(...items)
  }
}

/**
 * The directory of the templates of the deployment.
 *
 * The wizard walks up from the directory it runs in: the templates live
 * in a checkout of the repository, and the checkout is not always the
 * directory the operator runs the command from.
 *
 * @param input what the command received.
 */
function templatesOf(input: CommandInput): string {
  const named = stringOf(input.options, 'directory')
  if (named) return pathOf(named)
  return placeOf(DEFAULT_DIRECTORY)
}

/**
 * The directory of the files of the deployment.
 *
 * The files of a deployment live next to the templates of the
 * deployment, and they are named after the environment of the
 * deployment, and the environment is one of the values of the
 * deployment.
 *
 * The directory is named after the templates and not after the
 * directory the reader runs the command from: a reader who runs the
 * command from the workspace of a package writes the values of the
 * deployment in the workspace of that package.
 *
 * @param input what the command received.
 * @param directory the directory of the templates.
 * @param environment the environment of the deployment.
 */
function runtimeOf(input: CommandInput, directory: string, environment: string): string {
  const named = stringOf(input.options, 'runtime')
  if (named) return pathOf(named)
  return join(dirname(directory), 'runtime', environment)
}

/**
 * The values of the deployments that are already there.
 *
 * The files of the values of the deployments that are already there
 * hold the answers of the operator: they are the defaults of the
 * questions, so that the operator confirms the answers of a deployment
 * instead of typing them again.
 *
 * The deployments are found in the directory of the files of the
 * deployment: the one the reader names, or every environment that is
 * there. The environment of a deployment is the environment its own
 * file names.
 *
 * @param named the directory of the files of the deployment, when the
 * reader names one.
 * @param directory the directory of the templates.
 */
export async function existingOf(
  named: string | undefined,
  directory: string
): Promise<Map<string, Values>> {
  const existing = new Map<string, Values>()
  const files: string[] = []
  if (named) {
    files.push(join(pathOf(named), VALUES))
  } else {
    const root = join(dirname(directory), 'runtime')
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      return existing
    }
    for (const entry of entries) {
      files.push(join(root, entry, VALUES))
    }
  }
  for (const file of files) {
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const values = defaultsOf(content)
    const environment = values.environment ?? dirname(file)
    existing.set(environment, values)
  }
  return existing
}

/**
 * The environment of the deployment that was written last.
 *
 * An operator who deploys again works on the deployment they worked on
 * last, most of the time: the files of the values say which one it is,
 * by the moment they were written.
 *
 * @param directory the directory of the templates.
 */
export async function latestOf(directory: string): Promise<string | undefined> {
  const root = join(dirname(directory), 'runtime')
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return undefined
  }
  let latest: { readonly environment: string; readonly written: number } | undefined
  for (const entry of entries) {
    const file = join(root, entry, VALUES)
    try {
      const written = (await stat(file)).mtimeMs
      if (latest !== undefined && latest.written >= written) continue
      const environment = defaultsOf(await readFile(file, 'utf8')).environment ?? entry
      latest = { environment, written }
    } catch {
      // A directory that holds no values is not a deployment.
    }
  }
  return latest?.environment
}

/**
 * The default of a question.
 *
 * The values of the deployment that is already there are the defaults
 * of the questions, and the example of the templates is the default of
 * everything the deployment does not hold.
 *
 * The environment names the deployment: the values of a deployment of
 * another environment are the defaults of nothing.
 *
 * @param name the name of the value of the question.
 * @param values the values the wizard collected.
 * @param example the values of the example of the templates.
 * @param existing the values of the deployments that are already there.
 */
export function fallbackOf(
  name: string,
  values: Readonly<Values>,
  example: Readonly<Values>,
  existing: ReadonlyMap<string, Values>
): string | undefined {
  const environment = values.environment ?? example.environment
  const previous = environment === undefined ? undefined : existing.get(environment)
  const held = previous?.[name]
  if (held !== undefined && held !== '') return held
  // The environment of the question itself: the deployment that is
  // already there, when there is one.
  if (name === 'environment' && existing.size === 1) {
    const only = [...existing.keys()][0]
    if (only !== undefined && only !== example.environment) return only
  }
  return example[name]
}

/**
 * The default of a question, when the deployment can use it.
 *
 * A default the deployment cannot use is no default at all: a
 * question that offers an answer the templates refuse asks the
 * operator to type one the templates take, and the offer is a trap.
 * The example of the templates takes the place of a default that
 * cannot be used, and the operator is asked when there is none.
 *
 * @param question the question the default answers.
 * @param fallback the default the wizard found.
 * @param defaults the values of the example of the templates.
 */
export function offeredOf(
  question: Question,
  fallback: string | undefined,
  defaults: Readonly<Values>
): string | undefined {
  if (fallback !== undefined && fallback !== '' && problemOf(question, fallback) === undefined) {
    return fallback
  }
  const example = defaults[question.name]
  if (example !== undefined && example !== '' && problemOf(question, example) === undefined) {
    return example
  }
  return undefined
}

/**
 * The answers the operator gave in a file.
 *
 * The file holds the values in the shape of the example of the
 * templates, and it lets the wizard run without a terminal: the
 * operator answers once, and the wizard is run again with the file.
 *
 * @param input what the command received.
 */
async function answersOf(input: CommandInput): Promise<Values> {
  const named = stringOf(input.options, 'answers')
  if (!named) return {}
  let content: string
  try {
    content = await readFile(pathOf(named), 'utf8')
  } catch {
    throw new CliFailure(`the file of the answers cannot be read: ${named}`, 4, 'not_found')
  }
  return defaultsOf(content)
}

/**
 * The path of a directory, as the reader reads it.
 *
 * A path inside the directory the reader is in is written the way the
 * reader would write it, and a path outside of it is written whole.
 *
 * @param path the path of the directory.
 */
function shownOf(path: string): string {
  const here = process.cwd()
  if (!path.startsWith(`${here}/`)) return path
  return path.slice(here.length + 1)
}

/**
 * What the wizard checks before it asks anything.
 */
interface Preflight {
  /** The tool that writes the infrastructure, when the deployment is applied. */
  readonly tool?: InfrastructurePort
  /** The directory of the bootstrap of the deployment. */
  readonly bootstrap: string
  /** The variables the bootstrap of the deployment declares. */
  readonly declared: ReadonlySet<string>
  /** The variables the templates of the deployment declare. */
  readonly declaredDeployment: ReadonlySet<string>
}

/**
 * What the wizard refuses before it asks anything.
 *
 * The templates of the deployment and their bootstrap, the tool that
 * writes the infrastructure and the identity of the operator are
 * checked before the first question: a wizard that answers twenty
 * questions and refuses afterwards has taken the time of the operator
 * for nothing.
 *
 * A dry run runs no tool: it applies nothing, and the tool is not part
 * of what it does.
 *
 * @param input what the command received.
 * @param directory the directory of the templates.
 * @param dryRun true when the command applies nothing.
 */
async function preflight(
  input: CommandInput,
  directory: string,
  dryRun: boolean
): Promise<Preflight> {
  const bootstrap = bootstrapOf(directory)
  if (!existsSync(bootstrap)) {
    throw new CliFailure(
      `the templates of the deployment hold no bootstrap: the place where the state of the deployment lives cannot be created: ${bootstrap}`,
      4,
      'not_found'
    )
  }
  const tool = dryRun ? undefined : await toolOf(input)
  const declared = await declaredVariablesOf(bootstrap)
  const declaredDeployment = await declaredVariablesOf(directory)
  return { tool, bootstrap, declared, declaredDeployment }
}

/**
 * The facts of the provider, as a dry run reads them.
 *
 * A dry run signs nobody in: it reads the facts the machine of the
 * operator already holds, and it asks what it cannot read. A provider
 * that holds no facts without a session holds none.
 *
 * @param provider the provider of the deployment.
 */
async function factsOf(provider: DeploymentProvider): Promise<SignIn> {
  const facts = provider.facts === undefined ? {} : await provider.facts().catch(() => ({}))
  return { facts, message: 'the dry run signs nobody in' }
}

/**
 * The values of the deployment that are already there.
 *
 * @param file the file of the values of the deployment.
 */
async function previousOf(file: string): Promise<Values | undefined> {
  try {
    return defaultsOf(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The values the wizard writes in the file of the deployment.
 *
 * The file holds the values of the questions of the deployment and
 * nothing else: the facts the provider read and the images of the
 * release are not values of the deployment.
 *
 * @param provider the provider of the deployment.
 * @param values the values the wizard collected.
 */
function collectedOf(provider: DeploymentProvider, values: Readonly<Values>): Values {
  const collected: Values = {}
  for (const question of provider.questions) {
    const value = values[question.name]
    if (value !== undefined) collected[question.name] = value
  }
  return collected
}

/**
 * Reports whether the values that are there are the ones the operator
 * chose.
 *
 * A file that holds a value the wizard does not collect is not the
 * file the wizard would write: the operator changed it, and the
 * wizard does not throw it away without saying so.
 *
 * @param collected the values the wizard collected.
 * @param previous the values that are there.
 */
function sameValues(collected: Readonly<Values>, previous: Readonly<Values>): boolean {
  const names = Object.keys(collected)
  if (names.length !== Object.keys(previous).length) return false
  return names.every((name) => previous[name] === collected[name])
}

/**
 * The answers of the operator, as a person reads them.
 *
 * The questions the wizard asked are the answers of the operator, and
 * they are told before the deployment goes on.
 *
 * @param provider the provider of the deployment.
 * @param values the values the wizard collected.
 */
function reviewOf(provider: DeploymentProvider, values: Readonly<Values>): string[] {
  const asked = provider.questions.filter((question) => question.kind !== 'given')
  if (asked.length === 0) return []
  const width = Math.max(...asked.map((question) => question.name.length))
  return asked.map((question) => `  ${question.name.padEnd(width)}  ${values[question.name] ?? ''}`)
}

/**
 * The answers of the operator, as the wizard tells them.
 *
 * @param provider the provider of the deployment.
 * @param values the values the wizard collected.
 */
function reviewLines(provider: DeploymentProvider, values: Readonly<Values>): string[] {
  const answers = reviewOf(provider, values)
  if (answers.length === 0) return []
  return ['', 'the deployment goes on with these answers:', ...answers]
}

/**
 * The question of the values that are already there.
 *
 * The values of a deployment that is already there are the answers of
 * an earlier run, and the operator says whether they are replaced. The
 * reader who answers no keeps them, and the deployment of the values
 * that are there goes on.
 *
 * @param file the file of the values of the deployment.
 * @param yes true when the reader asked for no question.
 */
async function confirmValues(file: string, yes: boolean): Promise<void> {
  try {
    await confirm(
      `the values of the deployment are already there: ${file}. They are not the ones you chose: write them again?`,
      yes,
      process.stdin,
      process.stderr
    )
  } catch (error) {
    if (error instanceof CliFailure && error.code === 'not_confirmed') {
      throw new CliFailure(
        `the values of the deployment are already there: ${file}. Pass --force to write them again.`,
        5,
        'already_there'
      )
    }
    throw error
  }
}

/**
 * The number of times a question is asked before it is refused.
 *
 * A reader who answers with something the deployment cannot use is
 * asked again: the wizard that refuses the whole interview over one
 * mistyped character throws the answers of the reader away.
 */
const ATTEMPTS = 3

/**
 * The answer of a question, and the answer is one the deployment can use.
 *
 * The question is asked again when the answer is not one the
 * deployment can use, and the operator is told why: an identifier that
 * is not an identifier is refused at the question, and not at the end
 * of the interview, where the reader has already answered everything.
 *
 * A question that has choices is asked with the choices: the operator
 * picks one of them, and the answer is one of them before the
 * deployment starts.
 *
 * @param question the question of the wizard.
 * @param prompt the question, as the operator reads it.
 * @param facts the facts the provider read.
 * @param effective the values the answer falls back on.
 * @param tell what the operator is told about an answer it cannot use.
 */
async function askOf(
  question: Question,
  prompt: string,
  facts: Readonly<Record<string, string>>,
  effective: Readonly<Values>,
  tell: (text: string) => void
): Promise<string> {
  let problem = `${question.summary} is needed`
  // A question that has choices is asked with the choices, and the
  // default of the question is one of them: the operator confirms the
  // default by answering nothing.
  const fallback = defaultOf(question, effective)
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const answer = await ask(prompt, question.choices, process.stdin, process.stderr, fallback)
    const value = answerOf(question, facts, effective, answer)
    const found = problemOf(question, value)
    if (found === undefined) return value
    problem = found
    tell(`that answer cannot be used: ${problem}`)
  }
  throw new CliFailure(`the deployment is not ready: ${problem}`, 8, 'invalid_values')
}

/**
 * The default of a question that has choices.
 *
 * The default is the answer the operator confirms by answering
 * nothing, and it is one of the choices: a default that is not one of
 * them is not a default the operator can take.
 *
 * @param question the question of the wizard.
 * @param effective the values the answer falls back on.
 */
function defaultOf(question: Question, effective: Readonly<Values>): string | undefined {
  if (question.choices === undefined) return undefined
  const value = effective[question.name]
  if (value === undefined || value === '') return undefined
  return question.choices.includes(value) ? value : undefined
}

/**
 * The steps of a deployment, as a dry run tells them.
 *
 * The wizard writes the values; the place where the state lives, the
 * configuration of the backend and the plan belong to the tool. The
 * steps say what the deployment does, in the words of the deployment:
 * the commands of the tool are the business of the tool.
 */
function stepsOf(): string[] {
  return [
    'create the place where the state of the deployment lives',
    'write the configuration of the backend of the state',
    'initialize the templates of the deployment',
    'write the plan of the deployment and show it',
    'apply the plan once the operator confirms it',
  ]
}

/**
 * The directory of the bootstrap of the deployment.
 *
 * The bootstrap creates the place where the state of the deployment
 * lives, and it runs once per deployment, before the first apply of the
 * templates.
 *
 * @param directory the directory of the templates.
 */
function bootstrapOf(directory: string): string {
  return join(directory, 'bootstrap')
}

/**
 * The directory the bootstrap of the deployment runs in.
 *
 * The bootstrap is the only stack that runs without a backend, and its
 * state is a local state: the tool writes it in the directory it runs
 * in. The state of the bootstrap holds the credentials of the account
 * of the state of the deployment, and a credential in a checkout of the
 * repository is a credential in the working tree of every machine that
 * clones it.
 *
 * The templates of the bootstrap are copied into the directory of the
 * files of the deployment, and the tool runs them there: the state of
 * the bootstrap is written next to the values of the deployment, and
 * the directory of the files of the deployment is not committed.
 *
 * The file of the lock of the providers is copied with the templates:
 * the bootstrap of the deployment reads the resources of Azure with the
 * version of the provider the templates pin, and not with the version
 * that happens to be the newest of the day.
 *
 * The state of a bootstrap that ran before the deployment moved it is
 * taken with it: the state holds the name of the account of the state
 * of the deployment, and it is a credential that belongs in the
 * directory of the files of the deployment and not in the checkout of
 * the templates.
 *
 * @param source the directory of the templates of the bootstrap.
 * @param runtime the directory of the files of the deployment.
 * @param notes the notes the operator is told.
 */
async function bootstrapWorkspaceOf(
  source: string,
  runtime: string,
  notes: Notes
): Promise<string> {
  const workspace = join(runtime, 'bootstrap')
  await mkdir(workspace, { recursive: true })
  let entries: string[]
  try {
    entries = await readdir(source)
  } catch (error) {
    throw new CliFailure(
      `the templates of the bootstrap cannot be read: ${source}: ${(error as Error).message}`,
      4,
      'not_found'
    )
  }
  for (const entry of entries) {
    if (!entry.endsWith('.tf') && entry !== '.terraform.lock.hcl') continue
    await copyFile(join(source, entry), join(workspace, entry))
  }
  for (const entry of ['terraform.tfstate', 'terraform.tfstate.backup']) {
    const state = join(source, entry)
    if (!existsSync(state)) continue
    await copyFile(state, join(workspace, entry))
    await rm(state, { force: true })
    notes.push(
      `the state of the place where the state of the deployment lives was in the checkout of the templates: it is written in ${join(runtime, 'bootstrap')} now`
    )
  }
  return workspace
}

/**
 * The addresses that reach the account of the state of the deployment.
 *
 * The account of the state is a secret store, and it is closed to every
 * address but the ones of the operator: the operator is asked, and the
 * answer of the file of the answers is the answer of the operator.
 *
 * The address of the machine is read first, and it is the default of
 * the question: the operator confirms it by answering nothing, and
 * changes it by typing another one. A reader who cannot answer the
 * question keeps the address that was read.
 *
 * An address that is not a range is refused at the question, and the
 * question is asked again.
 *
 * @param environment the environment of the process.
 * @param answers the answers the operator gave in a file.
 * @param notes what the operator is told about the reading of the address.
 * @param tell what the operator is told about an answer it cannot use.
 */
async function askAddresses(
  environment: Readonly<Record<string, string | undefined>>,
  answers: Values,
  notes: string[],
  tell: (text: string) => void
): Promise<readonly string[]> {
  const given = answers[ADDRESSES]
  if (given !== undefined && given.trim() !== '') return noted(rangesIn(given), notes)
  const detected = await publicAddressOf(undefined, servicesOf(environment))
  if (detected === undefined) {
    notes.push('the public address of the machine could not be read: the addresses are asked')
  }
  const fallback = detected === undefined ? undefined : rangeOf(detected)
  const question =
    fallback === undefined
      ? 'the addresses that reach the account of the state of the deployment, separated by commas'
      : `the addresses that reach the account of the state of the deployment, separated by commas [${fallback}]`
  let problem = 'the addresses that reach the account of the state of the deployment are needed'
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let answer: string
    try {
      answer = await ask(question)
    } catch (error) {
      // Nobody can answer the question: the address that was read is
      // the answer, and the operator is told which one it is.
      if (fallback !== undefined && error instanceof CliFailure && error.code === 'not_answered') {
        notes.push(`the addresses that reach the account of the state are ${fallback}`)
        return [fallback]
      }
      throw error
    }
    try {
      return noted(addressesOf(answer, fallback), notes)
    } catch (error) {
      if (!(error instanceof CliFailure)) throw error
      problem = error.message
      tell(`that answer cannot be used: ${problem}`)
    }
  }
  throw new CliFailure(`the deployment is not ready: ${problem}`, 8, 'invalid_values')
}

/**
 * The ranges of the addresses, and what the operator is told about the
 * ones that were widened.
 *
 * @param ranges the ranges of the addresses.
 * @param notes what the operator is told.
 */
function noted(ranges: Ranges, notes: string[]): readonly string[] {
  for (const widened of ranges.widened) {
    notes.push(
      `the address ${widened} was widened to ${rangeOf(widened)}: the account of the state refuses a range of one address`
    )
  }
  return ranges.ranges
}

/**
 * The ranges of the addresses of an answer.
 */
export interface Ranges {
  /** The ranges the service of the state takes. */
  readonly ranges: readonly string[]
  /** The answers that were wider than the service takes. */
  readonly widened: readonly string[]
}

/**
 * The addresses of the answer of the operator.
 *
 * An answer that is empty takes the address that was read: the
 * operator confirms the address of the machine by answering nothing.
 *
 * @param answer what the operator typed.
 * @param detected the range of the address that was read.
 */
export function addressesOf(answer: string, detected?: string): Ranges {
  if (answer.trim() === '') {
    if (detected === undefined) {
      throw new CliFailure(
        'the addresses that reach the account of the state of the deployment are needed: the account is closed to every other address',
        8,
        'invalid_values'
      )
    }
    return { ranges: [detected], widened: [] }
  }
  return rangesIn(answer)
}

/**
 * The ranges of the addresses in a line, as the service takes them.
 *
 * The service that holds the state refuses a range of one address: a
 * range that is narrower is widened to the range that holds the
 * address.
 *
 * @param text the line the operator wrote.
 */
function rangesIn(text: string): Ranges {
  const entries = text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  const ranges: string[] = []
  const widened: string[] = []
  for (const entry of entries) {
    const address = entry.split('/')[0] ?? ''
    if (!isAddress(address)) {
      throw new CliFailure(
        `the address ${entry} is not a range, in the notation of a network`,
        8,
        'invalid_values'
      )
    }
    const range = rangeOf(entry)
    ranges.push(range)
    if (prefixOf(range) < prefixOf(entry)) widened.push(entry)
  }
  return { ranges, widened }
}

/**
 * The number of bits of the prefix of a range.
 *
 * A range that carries no prefix is the range of one address: the
 * tightest range there is.
 *
 * @param range the range, with its prefix.
 */
function prefixOf(range: string): number {
  const parts = range.split('/')
  if (parts.length < 2) return (parts[0] ?? '').includes(':') ? 128 : 32
  const prefix = Number(parts[1])
  return Number.isInteger(prefix) ? prefix : 0
}

/**
 * The variables the bootstrap of the deployment declares.
 *
 * The tool refuses a value for a variable that is not declared, and the
 * bootstrap of a provider declares the variables it takes. The wizard
 * reads them, and it passes only what the bootstrap declares.
 *
 * @param directory the directory of the bootstrap.
 */
async function declaredVariablesOf(directory: string): Promise<Set<string>> {
  const declared = new Set<string>()
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return declared
  }
  for (const entry of entries) {
    if (!entry.endsWith('.tf')) continue
    const content = await readFile(join(directory, entry), 'utf8').catch(() => '')
    for (const match of content.matchAll(/variable\s+"([^"]+)"/g)) {
      declared.add(match[1]!)
    }
  }
  return declared
}

/**
 * The values of the bootstrap, as the tool takes them.
 *
 * The bootstrap creates the place where the state of the deployment
 * lives, and it names it after the deployment. The group of the state
 * is not the group of the deployment: the templates create the group of
 * the deployment, and the bootstrap creates the group that holds the
 * state.
 *
 * @param values the values the wizard collected.
 * @param defaults the values of the example of the templates.
 * @param addresses the addresses that reach the account of the state.
 * @param declared the variables the bootstrap declares.
 */
function bootstrapVariables(
  values: Readonly<Values>,
  defaults: Readonly<Values>,
  addresses: readonly string[],
  declared: ReadonlySet<string>
): Record<string, string> {
  const prefix = values.name_prefix ?? defaults.name_prefix ?? 'platform'
  const environment = values.environment ?? defaults.environment ?? 'production'
  const location = values.location ?? defaults.location ?? 'westeurope'
  const wanted: Record<string, string> = {
    name_prefix: prefix,
    environment,
    location,
    resource_group_name: `${prefix}-${environment}-state`,
    operator_addresses: `[${addresses.map((address) => `"${address}"`).join(',')}]`,
    // The identity of the operator reads and writes the state of the
    // deployment: the shared key of the account of the state is off,
    // and the access is a role of Entra ID.
    operator_principal_id: values.operator_principal_id ?? '',
    // The place where the state of the deployment lives is created in
    // the subscription of the deployment, and in no other: a provider
    // that takes the subscription of the session creates the state of
    // the deployment wherever the session of the operator points at.
    subscription_id: values.subscription_id ?? '',
  }
  const taken: Record<string, string> = {}
  for (const [name, value] of Object.entries(wanted)) {
    if (!declared.has(name)) continue
    taken[name] = value
  }
  return taken
}

/**
 * The ways the contract of the templates of the checkout differs from
 * the contract of the templates of a release.
 *
 * The contract of the release is the contract of the templates at the
 * tag of the release: the images of the release were built out of that
 * commit, and they read the documents that the templates of that
 * commit write.
 *
 * A checkout that holds no tag, or no templates, holds no contract:
 * the answer is undefined, and the caller refuses the deployment,
 * because a contract it cannot prove is a contract it cannot trust.
 *
 * @param directory the directory of the templates of the deployment.
 * @param tag the tag of the release.
 */
async function contractDifferencesOf(
  directory: string,
  tag: string
): Promise<readonly string[] | undefined> {
  const here = await templateFilesOf(directory)
  const there = await templatesAtTagOf(directory, tag)
  if (here === undefined || there === undefined) return undefined
  return differencesOf(contractOf(here), contractOf(there))
}

/**
 * The files of the templates of the deployment.
 *
 * @param directory the directory of the templates of the deployment.
 */
async function templateFilesOf(directory: string): Promise<Record<string, string> | undefined> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return undefined
  }
  const files: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.endsWith('.tf')) continue
    const content = await readFile(join(directory, entry), 'utf8').catch(() => null)
    if (content === null) return undefined
    files[entry] = content
  }
  return files
}

/**
 * The answers of a deployment that are read and not asked.
 *
 * The interface of the operator shows the questions of a deployment as
 * a form, and the form holds what the wizard would have read: the
 * digests of the images of the latest release, the digest of the image
 * of the client of PostgreSQL and the range of the public address of
 * the machine. The three are read together, and what cannot be read is
 * a note and not a failure: the operator answers that question.
 *
 * @param defaults the values of the example of the templates.
 * @param environment the environment of the process.
 */
export async function readingsOf(
  defaults: Readonly<Values>,
  environment: Readonly<Record<string, string | undefined>>
): Promise<Found> {
  const [release, client, address] = await Promise.all([
    readRelease().catch(() => undefined),
    readClientImage(defaults),
    publicAddressOf(undefined, servicesOf(environment)).catch(() => undefined),
  ])
  const values: Values = {}
  const notes: string[] = []
  if (release === undefined) {
    notes.push('the release of the platform could not be read: the digests of the images are asked')
  } else {
    for (const name of PLATFORM_IMAGES) {
      const image = release.images[name]
      if (image !== undefined) values[name] = image
    }
    notes.push(`the digests of the images come from the release ${release.tag}`)
  }
  if (client === undefined) {
    notes.push('the digest of the image of the client of PostgreSQL could not be read: it is asked')
  } else {
    values.postgres_client_image = client
    notes.push('the digest of the image of the client of PostgreSQL comes from its registry')
  }
  if (address === undefined) {
    notes.push('the public address of the machine could not be read: the addresses are asked')
  } else {
    values[ADDRESSES] = rangeOf(address)
    notes.push(`the address that reaches the state is the one of this machine, ${rangeOf(address)}`)
  }
  return { values, notes, ...(release === undefined ? {} : { release: release.tag }) }
}

/**
 * The answers a deployment that is already there offers.
 *
 * The values of the deployment of an environment are the defaults of
 * its questions, exactly as the wizard offers them: an operator who
 * deploys an environment again confirms its answers and does not type
 * them. A value the deployment cannot use is no offer at all.
 *
 * @param provider the provider of the deployment.
 * @param defaults the values of the example of the templates.
 * @param existing the values of the deployments that are already there.
 * @param environment the environment the operator chose, when one is chosen.
 */
export function offersOf(
  provider: DeploymentProvider,
  defaults: Readonly<Values>,
  existing: ReadonlyMap<string, Values>,
  environment?: string
): Values {
  const chosen = environment ?? fallbackOf('environment', {}, defaults, existing)
  const values: Values = {}
  for (const question of provider.questions) {
    if (question.kind === 'given') continue
    if (question.name === 'environment') {
      if (chosen !== undefined && problemOf(question, chosen) === undefined) {
        values.environment = chosen
      }
      continue
    }
    const held: Values = chosen === undefined ? {} : { environment: chosen }
    const offered = offeredOf(
      question,
      fallbackOf(question.name, held, defaults, existing),
      defaults
    )
    if (offered !== undefined) values[question.name] = offered
  }
  return values
}

/**
 * Whether the operator brought the images of the deployment.
 *
 * The digests of the images of a release are the digests of a build
 * that was proved, and the templates of the deployment are the ones of
 * the same release. An operator who names the digests of the images of
 * another build brings the templates of that build too, and the wizard
 * does not compare the two.
 *
 * @param answers the answers the operator gave in a file.
 */
function carriesImages(answers: Readonly<Values>): boolean {
  return PLATFORM_IMAGES.some((name) => answers[name] !== undefined)
}

/**
 * The release of the platform the deployment runs.
 *
 * The release carries the digest of every image it published. A release
 * that cannot be read is not a failure: the wizard asks the operator
 * for the digests, and says why it asks.
 *
 * The default is the **latest** release of the platform: a deployment
 * runs the newest images that were published, and the digests are
 * written in the values of the deployment, so the deployment stays the
 * one that was applied. A reader who wants another release names it.
 *
 * @param named the release the reader named, when the reader named one.
 */
async function readRelease(named?: string): Promise<Release | undefined> {
  if (named !== undefined) {
    // A release the reader named is one release: it is not there, and
    // the deployment is a failure, and the message says why.
    return await releaseOf(named)
  }
  // The latest release is a moving target, and the release of the CLI
  // is the release of the line of the templates: a machine that cannot
  // reach the repository of the releases runs the images of its own
  // line.
  try {
    return await releaseOf('latest')
  } catch {
    try {
      return await releaseOf(VERSION)
    } catch {
      return undefined
    }
  }
}

/**
 * The image of the client of PostgreSQL, by digest.
 *
 * The image is the one image of a deployment that the platform does not
 * publish, and its digest is read from the registry that holds it. A
 * registry that cannot be reached is not a failure: the wizard asks the
 * operator for the digest.
 *
 * The reference names the registry of the image, and the digest is read
 * from the registry of Docker: the repository of Docker is the name of
 * the image without the name of the registry.
 *
 * @param defaults the values of the example of the templates.
 */
async function readClientImage(defaults: Readonly<Values>): Promise<string | undefined> {
  const reference = defaults.postgres_client_image
  if (!reference) return undefined
  const tag = tagOf(reference)
  if (!tag) return undefined
  const name = reference.split('@')[0]!.split(':')[0]!
  const repository = repositoryOf(name)
  try {
    const digest = await digestOf(repository, tag)
    return `${name}:${tag}@${digest}`
  } catch {
    return undefined
  }
}

/**
 * What the recovery of a failed apply needs to know.
 */
export interface Recovery {
  /** The provider of the deployment. */
  readonly provider: DeploymentProvider
  /** The tool that writes the infrastructure. */
  readonly port: InfrastructurePort
  /** The directory of the templates. */
  readonly directory: string
  /** The file of the values of the deployment. */
  readonly file: string
  /**
   * The values of the deployment, as the tool is told them.
   *
   * A stack that has no file of values is told its values one by one,
   * and the tool is told them the same way when it writes a resource
   * in the state: a resource that is written with other values than
   * the ones of the apply is a resource the next apply wants to change.
   */
  readonly variables?: Readonly<Record<string, string>>
  /** The region the deployment runs in. */
  readonly region?: string
  /** True when the operator has already said yes to everything. */
  readonly yes: boolean
  /** The names the recovery has already freed. */
  readonly purged: readonly string[]
  /** What the operator is told about the recovery. */
  readonly tell: (text: string) => void
}

/**
 * Writes the resources that a failed apply left in the cloud into the
 * state of the deployment.
 *
 * The resources are already there, and the state of the deployment
 * does not know them: the next apply refuses to create them again. The
 * tool names every one of them, and the state learns about all of them
 * before the plan is run again: a plan that holds one resource of a
 * hundred is a plan that refuses the hundredth one.
 *
 * The identifiers of a resource are tried in the order the provider
 * gave them: the tool refuses an import that names the resource in a
 * way it does not know, and the next one is tried.
 *
 * @param recovery what the recovery needs to know.
 * @param importables the resources the tool named.
 */
async function takeOver(
  recovery: Recovery,
  importables: readonly Importable[]
): Promise<{ note: string }> {
  const { port, directory, file, tell } = recovery
  // The recovery writes one resource at a time, and there may be a
  // hundred of them: the operator is told how many and that it takes a
  // moment, or the recovery looks like a wizard that is stuck.
  tell(
    `${importables.length} resources that a failed apply left in the cloud are written in the state of the deployment, this takes a moment`
  )
  for (const one of importables) {
    let refusal: string | undefined
    let written = false
    for (const id of one.ids) {
      try {
        await port.import(directory, one.address, id, {
          varFile: file,
          variables: recovery.variables,
        })
        written = true
        break
      } catch (error) {
        refusal = error instanceof CliFailure ? error.message : String(error)
      }
    }
    if (!written) {
      throw new CliFailure(
        `the deployment is not applied: ${one.address} is already in the cloud and could not be written in the state: ${refusal ?? 'the tool refused the import'}`,
        5,
        'already_there'
      )
    }
    // The recovery writes one resource at a time, and there may be a
    // hundred of them: the operator is told about each one, or the
    // recovery looks like a wizard that is stuck.
    tell(`${one.address} is written in the state of the deployment`)
  }
  return {
    note: `${importables.length} resources that a failed apply left in the cloud are written in the state`,
  }
}

/**
 * The number of times the place where the state of the deployment lives
 * is created again.
 *
 * The place holds four resources of Azure and two waits, and the
 * resources that are already there are written in the state one by one:
 * the tool refuses to create a resource that is there, and it names the
 * one it refuses. The resource is written in the state, and the next
 * apply refuses the next one.
 */
const BOOTSTRAP_ATTEMPTS = 8

/**
 * Creates the place where the state of the deployment lives.
 *
 * The place is created once per deployment, and the state of the
 * bootstrap is a file of the machine of the operator: a file that is
 * lost leaves the resources of the place in the cloud and the state of
 * the bootstrap empty. The next apply refuses to create the resources
 * that are there, and the recovery writes them in the state: the
 * resources are taken over, and nothing of the state of the deployment
 * is lost.
 *
 * @param recovery what the recovery needs to know.
 * @param variables the values of the place.
 */
async function bootstrapPlace(
  recovery: Recovery,
  variables: Readonly<Record<string, string>>
): Promise<InfrastructureBootstrap> {
  let last: unknown
  for (let attempt = 0; attempt < BOOTSTRAP_ATTEMPTS; attempt += 1) {
    try {
      return await recovery.port.bootstrap(recovery.directory, variables)
    } catch (error) {
      last = error
      const recovered = await recoverLeftover(recovery, error)
      if (recovered === undefined) throw error
      // The place where the state of the deployment lives is not a
      // resource that is freed or renamed: the state of the deployment
      // is in it.
      if (recovered.purged !== undefined || recovered.values !== undefined) throw error
    }
  }
  throw last instanceof CliFailure
    ? last
    : new CliFailure(
        'the place where the state of the deployment lives was not created',
        1,
        'tool_failed'
      )
}

/**
 * The resource of the cloud that a failed apply left behind.
 *
 * A resource that is already there is not in the state of the
 * deployment, and the next apply refuses to create it again: the CLI
 * finds the resource in the cloud and writes it in the state.
 *
 * The identifiers of the resources the cloud answered with are tried in
 * the order the cloud gave them: the import of a resource of another
 * kind is refused by the tool, and the next one is tried.
 *
 * A resource that was deleted and not purged keeps the name it had, and
 * the name cannot be used again: the CLI asks the operator, and purges
 * the resource when the operator says yes. The cloud frees the name a
 * little after the purge, and the recovery does not purge a name it has
 * already freed.
 *
 * @param recovery what the recovery needs to know.
 * @param error what the apply refused with.
 */
export async function recoverLeftover(
  recovery: Recovery,
  error: unknown
): Promise<{ note: string; purged?: string; values?: Readonly<Values> } | undefined> {
  const { provider, port, directory, file, region, yes, purged } = recovery
  if (!(error instanceof CliFailure)) return undefined
  const reason = error.message
  if (!/already exists|alreadyexists|already in use/i.test(reason)) return undefined
  const address = addressOf(reason)
  if (address === undefined) return undefined

  // The tool names every resource that is already there and not in
  // the state: they are written in the state, and the plan that
  // follows holds them.
  const importables = provider.importablesOf?.(reason) ?? []
  if (importables.length > 0) {
    return await takeOver(recovery, importables)
  }

  if (provider.leftoverOf === undefined) return undefined
  const leftover = await provider.leftoverOf(reason, region)
  if (leftover === undefined) return undefined

  // The name is held by a resource the deployment cannot take over: the
  // name of the resource of the deployment changes, and the operator
  // says yes to it.
  if (leftover.ids.length === 0 && leftover.location === undefined) {
    const where =
      leftover.place === undefined ? 'already exists' : `already exists in ${leftover.place}`
    const searched = leftover.searched === undefined ? '' : `: ${leftover.searched}`
    if (leftover.values === undefined) {
      throw new CliFailure(
        `the deployment is not applied: ${leftover.name} ${where}, and the deployment cannot take it over${searched}`,
        5,
        'already_there'
      )
    }
    const named = Object.entries(leftover.values)[0]
    if (named === undefined) {
      throw new CliFailure(
        `the deployment is not applied: ${leftover.name} ${where}, and the deployment cannot take it over${searched}`,
        5,
        'already_there'
      )
    }
    try {
      await confirm(
        `${leftover.name} ${where}, and the deployment cannot take it over: the deployment names its resource ${named[1]} instead: is that right?`,
        yes,
        process.stdin,
        process.stderr
      )
    } catch (error) {
      if (error instanceof CliFailure && error.code === 'not_confirmed') {
        throw new CliFailure(
          `the deployment is not applied: ${leftover.name} ${where}, and the deployment cannot take it over${searched}`,
          5,
          'already_there'
        )
      }
      throw error
    }
    return {
      note: `${leftover.name} was already there: the deployment names its resource ${named[1]} instead (${named[0]})`,
      values: leftover.values,
    }
  }

  // The name is held by a resource that was deleted and not purged: the
  // resource has to be purged, and what is left of it is lost.
  if (leftover.ids.length === 0) {
    if (provider.release === undefined) return undefined
    if (purged.includes(leftover.name)) {
      throw new CliFailure(
        `the deployment is not applied: ${leftover.name} was purged, and the cloud has not freed the name yet: wait a moment, and run the command again`,
        5,
        'already_there'
      )
    }
    try {
      await confirm(
        `${leftover.name} was deleted and not purged, and it holds the name the deployment wants: purging it frees the name and loses what is left of it: purge it?`,
        yes,
        process.stdin,
        process.stderr
      )
    } catch (error) {
      if (error instanceof CliFailure && error.code === 'not_confirmed') {
        throw new CliFailure(
          `the deployment is not applied: ${leftover.name} was deleted and not purged, and it holds the name the deployment wants: purge it, or name the vault of the deployment differently`,
          5,
          'already_there'
        )
      }
      throw error
    }
    await provider.release(leftover)
    return {
      note: `${leftover.name} was deleted and not purged: it is purged, and the name is free`,
      purged: leftover.name,
    }
  }

  let refusal: string | undefined
  for (const id of leftover.ids) {
    try {
      await port.import(directory, address, id, {
        varFile: file,
        variables: recovery.variables,
      })
      return { note: `${address} was already there: it is written in the state of the deployment` }
    } catch (error) {
      refusal = error instanceof CliFailure ? error.message : String(error)
    }
  }
  throw new CliFailure(
    `the deployment is not applied: ${leftover.name} already exists, and it was not written in the state: ${refusal ?? 'the tool refused the import'}`,
    5,
    'already_there'
  )
}

/**
 * The address of the resource that a refusal names.
 *
 * The tool of the infrastructure names the address of the resource in
 * the state: the address is what the state knows the resource by.
 *
 * @param reason what the tool said about the failure.
 */
function addressOf(reason: string): string | undefined {
  return reason.match(/with ([A-Za-z0-9_.[\]"-]+),/)?.[1]
}

/**
 * Checks what the system of the provider needs before the plan of the
 * deployment is applied.
 *
 * Some systems of the provider need something the templates of the
 * deployment cannot write: the delegation of a zone of DNS is one of
 * those things, and the operator writes it at the registrar of the
 * domain. The check is made before the plan is applied, and a refusal
 * is a refusal of the deployment: the apply that follows would fail in
 * the cloud with a reason that names the symptom and not the cause.
 *
 * The answers of the templates are read from the state of the
 * deployment: the state of a deployment that was never applied holds
 * none, and the check is made with the values of the deployment alone.
 *
 * @param provider the provider of the deployment.
 * @param tool the tool that writes the infrastructure.
 * @param directory the directory of the templates.
 * @param backend the configuration of the backend of the state.
 * @param values the values of the deployment.
 * @param tell what the operator is told while the check is made.
 */
async function checkedBefore(
  provider: DeploymentProvider,
  tool: InfrastructurePort,
  directory: string,
  backend: string,
  values: Values,
  tell: (text: string) => void
): Promise<void> {
  if (provider.beforeApply === undefined) return
  let outputs: Record<string, unknown> = {}
  try {
    outputs = await tool.output(directory, { backendConfig: backend })
  } catch {
    // The state of the deployment is empty: there is nothing to check,
    // and the check is made with the values of the deployment alone.
  }
  for (const note of await provider.beforeApply({ values, outputs, tell })) tell(note)
}

/**
 * Binds what the system of the provider needs after the apply.
 *
 * The provider of the deployment reads the names of the deployment in
 * the answers of the templates: a name that is written in the
 * templates and in the code of the provider is a name that drifts.
 *
 * The step is not a failure of the deployment when it does not go
 * through: the deployment is applied, and the binding is written again
 * the next time the deployment goes on.
 *
 * @param provider the provider of the deployment.
 * @param tool the tool that writes the infrastructure.
 * @param directory the directory of the templates.
 * @param backend the configuration of the backend of the state.
 * @param values the values of the deployment.
 * @param file the file of the values of the deployment.
 * @param tell what the operator is told while the deployment goes on.
 */
async function boundAfter(
  provider: DeploymentProvider,
  tool: InfrastructurePort,
  directory: string,
  backend: string,
  values: Values,
  file: string,
  tell: (text: string) => void = () => {}
): Promise<string[]> {
  if (provider.afterApply === undefined) return []
  let outputs: Record<string, unknown>
  try {
    outputs = await tool.output(directory, { backendConfig: backend })
  } catch (error) {
    return [
      `\nthe answers of the templates could not be read: ${error instanceof Error ? error.message : String(error)}`,
    ]
  }
  try {
    const lines = await provider.afterApply({ values, outputs, file, tell })
    return lines.map((line) => `\n${line}`)
  } catch (error) {
    return [`\n${error instanceof Error ? error.message : String(error)}`]
  }
}

export function deployCommand(provider: DeploymentProvider): CommandSpec {
  return {
    name: provider.name,
    summary: `deploy the platform on ${provider.summary}`,
    description:
      'The wizard signs the operator in to the system of the provider, asks the questions the deployment needs, writes the file of the values, and goes on with the deployment: it creates the place where the state of the deployment lives, it initializes the templates, it shows the plan, and it applies the plan once the operator confirms it.',
    options: [
      {
        name: 'directory',
        kind: 'string',
        summary: 'the directory of the templates of the deployment',
      },
      {
        name: 'runtime',
        kind: 'string',
        summary: 'the directory of the files of the deployment',
      },
      {
        name: 'answers',
        kind: 'string',
        summary: 'the file of the answers of the operator',
      },
      {
        name: 'force',
        kind: 'boolean',
        summary: 'write the values over the values that are there',
      },
      {
        name: 'release',
        kind: 'string',
        summary:
          'the release of the platform the deployment runs: a version, or "latest". The default is the latest release the platform published',
      },
    ],
    examples: [`platformctl deploy ${provider.name}`],
    async run(input: CommandInput): Promise<CommandResult> {
      const directory = templatesOf(input)
      const examplePath = join(directory, EXAMPLE)
      let example: string
      try {
        example = await readFile(examplePath, 'utf8')
      } catch {
        throw new CliFailure(
          `the example of the values of the templates is not there: ${examplePath}`,
          4,
          'not_found'
        )
      }
      const defaults = defaultsOf(example)

      // The wizard refuses what is missing before it asks anything: a
      // reader who answers twenty questions and is told afterwards
      // that the tool is not there answered for nothing.
      const checked = await preflight(input, directory, input.globals.dryRun)
      const { bootstrap, declared, declaredDeployment } = checked

      // The sign in comes first: the facts the provider reads answer
      // some of the questions, and the operator does not type them.
      const answers = await answersOf(input)
      const notes = new Notes((text) => input.services.progress(text))
      // The names the recovery freed: the cloud frees a name a little
      // after the resource that held it is purged.
      const purged: string[] = []

      // The digests of the images come from the release of the
      // platform: a deployment pins the digest of the image it runs,
      // and the digest of a release does not move. The release is read
      // before the provider is asked for a session: a release that is
      // not there is a failure that no browser has to be open for.
      const release = await readRelease(stringOf(input.options, 'release'))
      const known: Values = {}

      // The provider is asked for a session after the release: the
      // facts of the provider answer the questions that the release
      // does not. A dry run signs nobody in: it reads the facts the
      // machine of the operator already holds.
      const signIn = input.globals.dryRun
        ? await factsOf(provider)
        : await provider.signIn(ask, answers)
      input.services.progress(signIn.message)
      Object.assign(known, signIn.facts)
      if (release === undefined) {
        notes.push(
          'the release of the platform could not be read: the digests of the images are asked'
        )
      } else {
        Object.assign(known, release.images)
        notes.push(`the digests of the images come from the release ${release.tag}`)
        // The CLI, the templates of the deployment and the images are
        // one version line: a deployment that runs the images of
        // another release runs a deployment that nobody proved.
        if (release.version !== VERSION) {
          notes.push(
            `the release ${release.tag} is not the release of the CLI (${VERSION}): the templates of the deployment are the ones of ${VERSION}`
          )
        }
      }

      // The templates of the deployment and the images of the release
      // are one release. A checkout that is ahead of the tag of the
      // release holds templates that the images of the release do not
      // know: a gateway that reads a route table of a version it does
      // not know refuses to start, and a service that reads a secret
      // under another name refuses to start too. The wizard refuses it
      // before it applies anything.
      //
      // A commit is more than its documents: a commit that moves a
      // private endpoint, or that keeps more than one revision of an
      // application, writes the documents of the commit before it. The
      // **contract** of the templates is the documents they write, and
      // the deployment runs the images of the release when the contract
      // of the checkout and the contract of the release are the same.
      //
      // A document is read without its comments and without the
      // addresses of the deployment: the address of a service is a
      // value of the deployment, and the images of the release read the
      // address they are given.
      if (release !== undefined && !carriesImages(answers)) {
        const state = await templatesStateOf(directory, release.tag)
        if (state === 'different') {
          const differences = await contractDifferencesOf(directory, release.tag)
          if (differences === undefined || differences.length > 0) {
            const why =
              differences === undefined || differences.length === 0
                ? ''
                : `: ${differences.join(', ')}`
            throw new CliFailure(
              `the templates of the checkout are not the ones of the release ${release.tag}: the deployment would run the images of ${release.tag} with the templates of another commit, and a service that reads a document it does not know refuses to start${why}`,
              5,
              'templates_mismatch',
              undefined,
              `check out the tag ${release.tag}, or publish a release of the templates of the checkout, or name the digests of the images of another build in the file of the answers`
            )
          }
          notes.push(
            `the templates of the checkout are ahead of the release ${release.tag}, and the documents the images read did not change: the deployment runs the images of ${release.tag} with the templates of the checkout`
          )
        } else if (state === 'unknown' && release.version !== VERSION) {
          // The images of another line than the line of the CLI, and
          // the templates of the checkout cannot be compared with the
          // templates of the release: the deployment would run the
          // images of a release it cannot prove anything about.
          throw new CliFailure(
            `the templates of the deployment are not in a checkout that holds the tag ${release.tag} of the release: the deployment cannot prove that the images of the release ${release.tag} read the documents the templates write`,
            5,
            'templates_mismatch',
            undefined,
            `fetch the tag of the release (git fetch --tags), or name the digests of the images of the release in the file of the answers`
          )
        }
      }

      // The image of the client of PostgreSQL is the one image of a
      // deployment that the platform does not publish: its digest is
      // read from the registry that holds it.
      const client = await readClientImage(defaults)
      if (client === undefined) {
        notes.push(
          'the digest of the image of the client of PostgreSQL could not be read: it is asked'
        )
      } else {
        known.postgres_client_image = client
      }

      // What the operator answered by hand wins over what was read:
      // the answers of a file are the answers of the operator, and they
      // are asked for nothing.
      Object.assign(known, answers)

      // The identity of the operator is the one of the session of the
      // client of Azure, and the deployment writes its secrets with
      // it: a wizard that asks every question before it says that the
      // identity is missing has wasted the answers of the operator.
      const identity = known.operator_principal_id ?? ''
      if (declaredDeployment.has('operator_principal_id') && identity === '') {
        if (input.globals.dryRun) {
          // A dry run signs nobody in, and the identity it cannot read
          // is a note: the deployment that follows needs it.
          notes.push(
            'the identity of the operator could not be read: the dry run signs nobody in, and the deployment needs the identity of the operator'
          )
        } else {
          throw new CliFailure(
            'the identity of the operator could not be read: the deployment writes the secrets of the deployment in the vault of the deployment, and the permission to write them is a role of Entra ID: sign in to Azure as the operator of the deployment',
            7,
            'unreachable'
          )
        }
      }
      if (declared.has('operator_principal_id') && identity === '') {
        notes.push(
          'the identity of the operator could not be read: the account of the state keeps the permissions the operator already holds'
        )
      }

      // The values of the deployments that are already there are the
      // defaults of the questions: the operator confirms the answers of
      // a deployment instead of typing them again.
      const existing = await existingOf(stringOf(input.options, 'runtime'), directory)
      const values: Values = { ...known }
      for (const question of questionsOf(provider, known)) {
        const given = answers[question.name]
        if (given !== undefined) {
          values[question.name] = given
          continue
        }
        const fallback = fallbackOf(question.name, values, defaults, existing)
        const offered = offeredOf(question, fallback, defaults)
        const prompt =
          offered !== undefined && offered !== ''
            ? `${question.summary} [${offered}]`
            : question.summary
        const effective =
          offered === undefined ? defaults : { ...defaults, [question.name]: offered }
        values[question.name] = await askOf(question, prompt, known, effective, (text) =>
          input.services.progress(text)
        )
      }

      // The values of the questions the wizard does not ask are the
      // values of the deployment that is already there: the operator
      // set them on purpose, and the wizard does not throw them away.
      // The name of the vault of the deployment is one of them: a
      // deployment that named its vault keeps the name.
      const held = existing.get(values.environment ?? defaults.environment ?? 'production')
      for (const question of provider.questions) {
        if (question.kind !== 'given') continue
        if (values[question.name] !== undefined) continue
        const value = held?.[question.name]
        if (value !== undefined && value !== '') values[question.name] = value
      }

      const problems = problemsOf(provider.questions, values)
      if (problems.length > 0) {
        throw new CliFailure(
          `the deployment is not ready: ${problems.join(', ')}`,
          8,
          'invalid_values'
        )
      }

      const environment = values.environment ?? defaults.environment ?? 'production'
      const runtime = runtimeOf(input, directory, environment)
      const file = join(runtime, VALUES)
      const relative = runtime.startsWith(process.cwd())
        ? runtime.slice(process.cwd().length + 1)
        : runtime
      // The values of the deployment that are already there: a
      // deployment that is already there is the default of the
      // questions, and the file that holds it is left alone when the
      // operator chose the same values.
      const previous = await previousOf(file)
      const collected = collectedOf(provider, values)
      const same = previous !== undefined && sameValues(collected, previous)

      // A dry run writes nothing: it tells the operator what the
      // deployment would do, and it stops there. It signs nobody in
      // either: a dry run that opens a browser is not a dry run.
      if (input.globals.dryRun) {
        return {
          value: {
            provider: provider.name,
            directory,
            runtime,
            values,
            account: signIn.account ?? '',
            written: previous === undefined,
            same,
          },
          lines: [
            '',
            'the deployment goes on:',
            ...stepsOf().map((step, index) => `  ${index + 1}. ${step}`),
            ...reviewLines(provider, values),
          ],
          message:
            previous === undefined
              ? `the values of the deployment would be written in ${relative}/${VALUES}`
              : same
                ? `the values of the deployment are already there: ${relative}/${VALUES}`
                : `the values of the deployment would be written over ${relative}/${VALUES}`,
        }
      }

      // The values of a deployment are the ones the operator chose: a
      // wizard that overwrites them without asking loses the answers
      // of a deployment that is already there. The values that are
      // there are the answers of an earlier run, and the operator says
      // whether they are replaced.
      if (previous === undefined) {
        await mkdir(runtime, { recursive: true })
        await writeFile(file, valuesFile(provider, values))
      } else if (!same) {
        if (input.options.force !== true) {
          await confirmValues(file, input.globals.yes)
        }
        await writeFile(file, valuesFile(provider, values))
      }
      const written =
        previous !== undefined && same
          ? `the values of the deployment are already there: ${relative}/${VALUES}`
          : `the values of the deployment are written in ${relative}/${VALUES}`

      // The answers of the operator are told before the deployment
      // goes on: the deployment takes minutes, and an answer that is
      // wrong is caught before the minutes and not after them.
      for (const line of reviewLines(provider, values)) input.services.progress(line)
      input.services.progress('')

      // The deployment goes on: the wizard wrote the values, and the
      // tool writes the place where the state lives, the plan and the
      // deployment.
      input.services.progress(written)
      // The tool was checked before the questions: the dry run is the
      // only way to reach this line without a tool, and the dry run
      // stops above.
      const tool = checked.tool ?? (await toolOf(input))
      const addresses = declared.has(ADDRESSES)
        ? await askAddresses(input.environment, answers, notes, (text) =>
            input.services.progress(text)
          )
        : []
      const bootstrapValues = bootstrapVariables(values, defaults, addresses, declared)
      const place = await bootstrapPlace(
        {
          provider,
          port: tool,
          // The bootstrap runs in the directory of the files of the
          // deployment: the state of the bootstrap is written there,
          // and not in the checkout of the templates.
          directory: await bootstrapWorkspaceOf(bootstrap, runtime, notes),
          // The place has no file of values: the tool is told the
          // values of the place one by one.
          file: '',
          variables: bootstrapValues,
          region: values.location,
          yes: input.globals.yes,
          purged,
          tell: (text) => input.services.progress(text),
        },
        bootstrapValues
      )
      input.services.progress('the place where the state of the deployment lives is created')
      if (!place.created) {
        notes.push('the place where the state of the deployment lives was already there')
      }
      const backend = join(runtime, BACKEND)
      await writeFile(backend, `${place.backendConfig}\n`)
      input.services.progress(
        `the configuration of the backend of the state is written in ${shownOf(backend)}`
      )

      const state = await tool.initialize(directory, { backendConfig: backend })
      input.services.progress('the templates of the deployment are initialized')
      if (!state.read) {
        // The state of the deployment could not be read: the plan
        // that follows is the plan of a deployment whose state is
        // empty, and the resources of the deployment that are already
        // there are not in it. The operator is told before the plan is
        // written, and the question of the plan names it again.
        notes.push(
          `the state of the deployment could not be read: ${state.reason ?? 'the tool refused'}: the plan that follows is the plan of a deployment whose state is empty`
        )
      }

      // The plan is written, the operator answers about it, and the
      // plan is applied. A resource that a failed apply left in the
      // cloud is not in the state of the deployment, and the next
      // apply refuses to create it again: the CLI writes it in the
      // state and runs the plan again.
      // The plan is run again after a recovery, and a recovery may
      // need a plan of its own to be tried: the loop is long enough
      // for the names the recovery frees.
      let attempts = 2
      let last: unknown
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let plan: InfrastructurePlan
        try {
          plan = await tool.plan(directory, { varFile: file, planFile: join(runtime, PLAN) })
        } catch (error) {
          // The state of the deployment is locked: a run that was
          // killed left its lock behind it. The operator says whether
          // that run is still there, and the plan is written again
          // when the lock is freed.
          const unlocked = await unlockState(
            tool,
            directory,
            { varFile: file },
            error,
            input.globals.yes,
            (text) => input.services.progress(text)
          )
          if (!unlocked) throw error
          plan = await tool.plan(directory, { varFile: file, planFile: join(runtime, PLAN) })
        }
        // The system of the provider is checked before the plan is
        // applied: the delegation of the zone of the names is written at
        // the registrar by the operator, and an apply that binds the
        // names without it fails in the cloud with a reason that names
        // the symptom and not the cause.
        await checkedBefore(provider, tool, directory, backend, values, (text) =>
          input.services.progress(text)
        )
        // The plan is what the operator answers about: it is shown
        // before the question, and the question names what the plan
        // does, counted.
        const value = {
          provider: provider.name,
          directory,
          runtime,
          values,
          account: signIn.account ?? '',
          summary: plan.summary,
          changes: plan.changes,
          drift: plan.drift,
        }

        if (changesNothing(plan)) {
          // The deployment is applied and nothing changed, and the
          // binding of the system of the provider is written anyway:
          // the binding of a name waits for the records of DNS of the
          // name, and the records of a name are not always in place
          // when the deployment goes on.
          const bound = await boundAfter(provider, tool, directory, backend, values, file, (text) =>
            input.services.progress(text)
          )
          return {
            value,
            lines: bound,
            message: 'the deployment is already what it should be',
          }
        }

        // The plan is what the operator answers about: it is shown
        // before the question, whatever the format of the answer is. A
        // reader that answers about a plan it has not seen answers
        // blind, and the format of the answer says nothing about what
        // the reader is shown.
        await confirm(
          state.read
            ? questionOf(plan)
            : `the state of the deployment is empty: ${questionOf(plan)}`,
          input.globals.yes,
          process.stdin,
          process.stderr,
          planContext(
            plan,
            input.globals.output === 'table' && !input.globals.quiet,
            input.globals.yes
          ),
          (text) => input.services.progress(text)
        )
        try {
          const applied = await tool.apply(directory, plan)
          // The deployment is applied, and the system of the provider
          // is told what it needs after the apply: the certificate of
          // the public names is one of those things.
          const bound = await boundAfter(provider, tool, directory, backend, values, file, (text) =>
            input.services.progress(text)
          )
          return {
            value: {
              ...value,
              summary: applied.summary,
              applied: applied.applied,
            },
            // The answer of the command is what the apply did, and
            // not the plan that was shown before the question: a plan
            // that is told after the apply reads as a plan that is
            // still to come.
            lines: [
              '',
              appliedOf(applied.summary),
              '',
              ...tableOfChanges(applied.applied),
              ...bound,
            ],
            message: 'the deployment is applied',
          }
        } catch (error) {
          last = error
          const recovered = await recoverLeftover(
            {
              provider,
              port: tool,
              directory,
              file,
              region: values.location,
              yes: input.globals.yes,
              purged,
              tell: (text) => input.services.progress(text),
            },
            error
          )
          if (recovered === undefined) throw error
          notes.push(recovered.note)
          if (recovered.purged !== undefined) purged.push(recovered.purged)
          if (recovered.values !== undefined) {
            // The name of the resource of the deployment changed: the
            // values are written again, and the plan is run with them.
            Object.assign(values, recovered.values)
            await writeFile(file, valuesFile(provider, values))
            attempts = attempts + 1
          }
        }
      }
      // The recovery freed what it could, and the plan was run again,
      // and the tool refused it again. The refusal carries what the
      // tool said: the reason of the failure of the deployment is the
      // reason the tool gave, and not the summary of the recovery.
      const reason = last instanceof CliFailure ? last.message : String(last ?? 'the tool refused')
      throw new CliFailure(
        reason,
        1,
        'apply_failed',
        undefined,
        'the plan was run again after the recovery, and the tool refused it again: read the plan of the deployment with "platformctl infra plan"'
      )
    },
  }
}

/** The group of the wizard of a deployment. */
export const deployGroup: GroupSpec = {
  name: 'deploy',
  summary: 'the deployment of the platform',
  description:
    'The wizard collects the values of a deployment, signs the operator in to the system of the provider, writes the file of the values, and goes on with the deployment: it creates the place where the state lives, it initializes the templates, and it applies the plan once the operator confirms it.',
  commands: [deployCommand(azureProvider())],
}
