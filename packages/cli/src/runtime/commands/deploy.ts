/**
 * The wizard of a deployment.
 *
 * The deployment of the platform is written in OpenTofu, and the values
 * of a deployment name one deployment. The wizard signs the operator in
 * to the system of the provider, asks the questions the provider
 * declares, writes the file of the values, and tells the operator what
 * to do next.
 *
 * The wizard writes one file: the file of the values, in the directory
 * of the deployment. The state of the deployment, the plan and the
 * configuration of the backend belong to the tool, and the wizard
 * writes none of them.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { CommandInput, CommandResult, CommandSpec, GroupSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import { ask } from '../../app/prompt'
import { CliFailure } from '../../domains/failure'
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
import { digestOf, tagOf } from '../../platform/registry'
import { type Release, releaseOf } from '../../platform/release'
import { VERSION } from '../../runtime/version'

/** The directory of the templates, when the reader names none. */
const DEFAULT_DIRECTORY = join('deploy', 'tofu', 'azure')

/** The name of the file of the values of the deployment. */
const VALUES = 'terraform.tfvars'

/** The name of the example of the values of the templates. */
const EXAMPLE = 'terraform.tfvars.example'

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
 * The steps the operator takes after the wizard.
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
 * The release of the platform the deployment runs.
 *
 * The release carries the digest of every image it published. A release
 * that cannot be read is not a failure: the wizard asks the operator
 * for the digests, and says why it asks.
 *
 * @param input what the command received.
 */
async function readRelease(input: CommandInput): Promise<Release | undefined> {
  const version = stringOf(input.options, 'release') ?? VERSION
  try {
    return await releaseOf(version)
  } catch {
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
 * The command of a provider of the infrastructure of a deployment.
 *
 * @param provider the provider of the deployment.
 */
export function deployCommand(provider: DeploymentProvider): CommandSpec {
  return {
    name: provider.name,
    summary: `prepare a deployment on ${provider.summary}`,
    description:
      'The wizard signs the operator in to the system of the provider, asks the questions the deployment needs, writes the file of the values, and tells the operator what to do next.',
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
        summary: 'the release of the platform the deployment runs',
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
      const signIn = await provider.signIn(ask)
      const answers = await answersOf(input)
      const notes: string[] = []

      // The digests of the images come from the release of the
      // platform: a deployment pins the digest of the image it runs,
      // and the digest of a release does not move.
      const known: Values = { ...signIn.facts }
      const release = await readRelease(input)
      if (release === undefined) {
        notes.push(
          'the release of the platform could not be read: the digests of the images are asked'
        )
      } else {
        Object.assign(known, release.images)
        notes.push(`the digests of the images come from the release ${release.tag}`)
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
      // the answers of a file are the answers of the operator.
      const values: Values = { ...known }
      for (const question of questionsOf(provider, known)) {
        const given = answers[question.name]
        if (given !== undefined) {
          values[question.name] = given
          continue
        }
        const fallback = defaults[question.name]
        const prompt =
          fallback !== undefined && fallback !== ''
            ? `${question.summary} [${fallback}]`
            : question.summary
        const answer = await ask(prompt)
        values[question.name] = answerOf(question, known, defaults, answer)
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
      return {
        value: {
          provider: provider.name,
          directory,
          runtime,
          values,
          account: signIn.account ?? '',
        },
        lines: [signIn.message, ...notes, '', ...stepsOf(directory, runtime, values)],
        message: `the values of the deployment are written in ${relative}/${VALUES}`,
      }
    },
  }
}

/** The group of the wizard of a deployment. */
export const deployGroup: GroupSpec = {
  name: 'deploy',
  summary: 'the deployment of the platform',
  description:
    'The wizard collects the values of a deployment, signs the operator in to the system of the provider, and writes the file of the values.',
  commands: [deployCommand(azureProvider())],
}
