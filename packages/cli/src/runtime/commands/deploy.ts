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
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { CommandInput, CommandResult, CommandSpec, GroupSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import { ask, confirm } from '../../app/prompt'
import { CliFailure } from '../../domains/failure'
import { changesNothing, type InfrastructurePort, questionOf } from '../../domains/infrastructure'
import {
  answerOf,
  defaultsOf,
  type DeploymentProvider,
  problemsOf,
  questionsOf,
  valuesFile,
  type Values,
} from '../../domains/deployment'
import { azureProvider } from '../../platform/azure'
import { isAddress, publicAddressOf, rangeOf, servicesOf } from '../../platform/address'
import { digestOf, tagOf } from '../../platform/registry'
import { type Release, releaseOf } from '../../platform/release'
import { VERSION } from '../../runtime/version'
import { linesOfPlan, toolOf } from './infrastructure'

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
  if (named) return resolve(named)
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, DEFAULT_DIRECTORY)
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return resolve(DEFAULT_DIRECTORY)
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
  if (named) return resolve(named)
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
    files.push(join(resolve(named), VALUES))
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
    content = await readFile(resolve(named), 'utf8')
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
 * The steps of a deployment, as a dry run tells them.
 *
 * The wizard writes the values; the state of the deployment, the
 * configuration of the backend and the plan belong to the tool, and the
 * steps say which command writes which one.
 *
 * @param directory the directory of the templates.
 * @param runtime the directory of the files of the deployment.
 * @param values the values the wizard collected.
 */
function stepsOf(directory: string, runtime: string, values: Values): string[] {
  const prefix = values.name_prefix ?? 'platform'
  const environment = values.environment ?? 'production'
  const shown = shownOf(runtime)
  const templates = shownOf(directory)
  return [
    '1. create the place where the state of the deployment lives:',
    `     tofu -chdir=${templates}/bootstrap init`,
    `     tofu -chdir=${templates}/bootstrap apply -var name_prefix=${prefix} -var environment=${environment}`,
    '2. write the configuration of the backend of the state:',
    `     tofu -chdir=${templates}/bootstrap output -raw backend_config_hcl > ${shown}/backend.hcl`,
    '3. initialize the templates of the deployment:',
    `     tofu -chdir=${templates} init -backend-config=${relative(directory, join(runtime, 'backend.hcl'))}`,
    '4. read the plan of the deployment:',
    `     platformctl infra plan --directory ${templates} --runtime ${shown}`,
    '5. apply the deployment:',
    `     platformctl infra apply --directory ${templates} --runtime ${shown}`,
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
 * @param environment the environment of the process.
 * @param answers the answers the operator gave in a file.
 * @param notes what the operator is told about the reading of the address.
 */
async function askAddresses(
  environment: Readonly<Record<string, string | undefined>>,
  answers: Values,
  notes: string[]
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
  let answer: string
  try {
    answer = await ask(question)
  } catch (error) {
    // Nobody can answer the question: the address that was read is the
    // answer, and the operator is told which one it is.
    if (fallback !== undefined && error instanceof CliFailure && error.code === 'not_answered') {
      notes.push(`the addresses that reach the account of the state are ${fallback}`)
      return [fallback]
    }
    throw error
  }
  const ranges = addressesOf(answer, fallback)
  return noted(ranges, notes)
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
  }
  const taken: Record<string, string> = {}
  for (const [name, value] of Object.entries(wanted)) {
    if (!declared.has(name)) continue
    taken[name] = value
  }
  return taken
}

/**
 * The release of the platform the deployment runs.
 *
 * The release carries the digest of every image it published. A release
 * that cannot be read is not a failure: the wizard asks the operator
 * for the digests, and says why it asks.
 *
 * @param input what the command received.
 */
async function readRelease(input: CommandInput): Promise<Release | undefined> {
  const named = stringOf(input.options, 'release')
  const version = named ?? VERSION
  try {
    return await releaseOf(version)
  } catch (error) {
    // A release the reader named is not there: that is a failure, and
    // the message says why. The release of the CLI is the default, and
    // a build that was never released asks for the digests.
    if (named !== undefined) throw error
    return undefined
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
 * @param defaults the values of the example of the templates.
 */
async function readClientImage(defaults: Readonly<Values>): Promise<string | undefined> {
  const reference = defaults.postgres_client_image
  if (!reference) return undefined
  const tag = tagOf(reference)
  if (!tag) return undefined
  const name = reference.split('@')[0]!.split(':')[0]!
  const repository = name.includes('/') ? name : `library/${name}`
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
  /** The region the deployment runs in. */
  readonly region?: string
  /** True when the operator has already said yes to everything. */
  readonly yes: boolean
  /** The names the recovery has already freed. */
  readonly purged: readonly string[]
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
  if (provider.leftoverOf === undefined) return undefined
  if (!(error instanceof CliFailure)) return undefined
  const reason = error.message
  if (!/already exists|alreadyexists|already in use/i.test(reason)) return undefined
  const address = addressOf(reason)
  if (address === undefined) return undefined
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
        process.stdout
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
        process.stdout
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
      await port.import(directory, address, id, { varFile: file })
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
 * The command of a provider of the infrastructure of a deployment.
 *
 * @param provider the provider of the deployment.
 */
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
          'the release of the platform the deployment runs: a version, or "latest". The default is the version of the CLI',
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

      // The sign in comes first: the facts the provider reads answer
      // some of the questions, and the operator does not type them.
      const answers = await answersOf(input)
      const notes: string[] = []
      // The names the recovery freed: the cloud frees a name a little
      // after the resource that held it is purged.
      const purged: string[] = []

      // The digests of the images come from the release of the
      // platform: a deployment pins the digest of the image it runs,
      // and the digest of a release does not move. The release is read
      // before the provider is asked for a session: a release that is
      // not there is a failure that no browser has to be open for.
      const release = await readRelease(input)
      const known: Values = {}

      // The provider is asked for a session after the release: the
      // facts of the provider answer the questions that the release
      // does not.
      const signIn = await provider.signIn(ask)
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
        const prompt =
          fallback !== undefined && fallback !== ''
            ? `${question.summary} [${fallback}]`
            : question.summary
        const answer = await ask(prompt)
        const effective =
          fallback === undefined ? defaults : { ...defaults, [question.name]: fallback }
        values[question.name] = answerOf(question, known, effective, answer)
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
      await mkdir(runtime, { recursive: true })
      const file = join(runtime, VALUES)
      // The values of a deployment are the ones the operator chose: a
      // wizard that overwrites them without asking loses the answers
      // of a deployment that is already there.
      if (existsSync(file) && input.options.force !== true) {
        throw new CliFailure(
          `the values of the deployment are already there: ${file}. Pass --force to write them again.`,
          5,
          'already_there'
        )
      }
      await writeFile(file, valuesFile(provider, values))

      const relative = runtime.startsWith(process.cwd())
        ? runtime.slice(process.cwd().length + 1)
        : runtime
      const written = `the values of the deployment are written in ${relative}/${VALUES}`

      // A dry run applies nothing: it writes the values, tells the
      // operator the steps the deployment takes, and stops there.
      if (input.globals.dryRun) {
        return {
          value: {
            provider: provider.name,
            directory,
            runtime,
            values,
            account: signIn.account ?? '',
          },
          lines: [
            signIn.message,
            ...notes,
            '',
            written,
            '',
            ...stepsOf(directory, runtime, values),
          ],
          message: written,
        }
      }

      // The deployment goes on: the wizard wrote the values, and the
      // tool writes the place where the state lives, the plan and the
      // deployment.
      const port = await toolOf(input)
      const bootstrap = bootstrapOf(directory)
      if (!existsSync(bootstrap)) {
        throw new CliFailure(
          `the templates of the deployment hold no bootstrap: the place where the state of the deployment lives cannot be created: ${bootstrap}`,
          4,
          'not_found'
        )
      }
      const declared = await declaredVariablesOf(bootstrap)
      const declaredDeployment = await declaredVariablesOf(directory)
      const identity = values.operator_principal_id ?? ''
      if (declaredDeployment.has('operator_principal_id') && identity === '') {
        throw new CliFailure(
          'the identity of the operator could not be read: the deployment writes the secrets of the deployment in the vault of the deployment, and the permission to write them is a role of Entra ID: sign in to Azure as the operator of the deployment',
          7,
          'unreachable'
        )
      }
      const addresses = declared.has(ADDRESSES)
        ? await askAddresses(input.environment, answers, notes)
        : []
      if (declared.has('operator_principal_id') && identity === '') {
        notes.push(
          'the identity of the operator could not be read: the account of the state keeps the permissions the operator already holds'
        )
      }
      const place = await port.bootstrap(
        bootstrap,
        bootstrapVariables(values, defaults, addresses, declared)
      )
      if (!place.created) {
        notes.push('the place where the state of the deployment lives was already there')
      }
      const backend = join(runtime, BACKEND)
      await writeFile(backend, `${place.backendConfig}\n`)

      await port.initialize(directory, { backendConfig: backend })

      // The plan is written, the operator answers about it, and the
      // plan is applied. A resource that a failed apply left in the
      // cloud is not in the state of the deployment, and the next
      // apply refuses to create it again: the CLI writes it in the
      // state and runs the plan again.
      // The plan is run again after a recovery, and a recovery may
      // need a plan of its own to be tried: the loop is long enough
      // for the names the recovery frees.
      let attempts = 2
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const plan = await port.plan(directory, { varFile: file, planFile: join(runtime, PLAN) })
        const lines = [
          signIn.message,
          ...notes,
          '',
          written,
          'the place where the state of the deployment lives is created',
          `the configuration of the backend of the state is written in ${shownOf(backend)}`,
          'the templates of the deployment are initialized',
          '',
          ...linesOfPlan(plan),
        ]
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
          return { value, lines, message: 'the deployment is already what it should be' }
        }

        // The plan is what the operator answers about: it is shown
        // before the question, and the question names what the plan
        // does, counted.
        await confirm(
          questionOf(plan),
          input.globals.yes,
          process.stdin,
          process.stdout,
          input.globals.output === 'table' && !input.globals.quiet ? lines : []
        )
        try {
          const applied = await port.apply(directory, plan)
          return {
            value: {
              ...value,
              summary: applied.summary,
              applied: applied.applied,
            },
            lines,
            message: 'the deployment is applied',
          }
        } catch (error) {
          const recovered = await recoverLeftover(
            {
              provider,
              port,
              directory,
              file,
              region: values.location,
              yes: input.globals.yes,
              purged,
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
      throw new CliFailure(
        'the deployment was not applied: the resource that is already there was written in the state, and the plan is run again',
        1,
        'apply_failed'
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
