/**
 * The dispatcher of the CLI.
 *
 * The dispatcher reads the words of the reader, finds the command they
 * name, and answers. It is the only place that knows how a command is
 * found, and it is a pure function of the words and of the registry:
 * the tests of the CLI prove what it answers without a network.
 */

import { CliFailure, type ExitCode } from '../domains/failure'
import { parseArguments } from './args'
import type {
  CommandInput,
  CommandSpec,
  GroupSpec,
  GlobalOptions,
  Options,
  Services,
} from './commands'
import { GLOBAL_OPTIONS, helpOf, helpOfCommand, helpOfGroup, helpOfRootCommand } from './help'
import { render } from './output'

/** What the CLI needs to answer. */
export interface CliRuntime {
  /** The name of the program. */
  readonly name: string
  /** The commands of the root of the CLI. */
  readonly commands: readonly CommandSpec[]
  /** The groups of the commands. */
  readonly groups: readonly GroupSpec[]
  /** The environment of the process. */
  readonly environment: Readonly<Record<string, string | undefined>>
  /** The ports of a command. */
  readonly services: (globals: GlobalOptions) => Services
  /** The profile of the deployment a command works on. */
  readonly contextOf: (profile?: string) => Promise<CommandInput['context']>
  /** The stream the answer is written on. */
  readonly out: (text: string) => void
  /** The stream the failures are written on. */
  readonly err: (text: string) => void
}

/** The options of the CLI that take no value. */
const BOOLEAN_OPTIONS = new Set(['quiet', 'verbose', 'color', 'dry-run', 'yes', 'help'])

/** The options of the CLI that take a value. */
const VALUE_OPTIONS = new Set(['output', 'profile', 'request-id'])

/**
 * The words of the reader that are not options.
 *
 * The scan is lenient: an option the scan does not know may take a
 * value, and the value is the word that follows it. The scan is only
 * used to find the group and the command, and the real reading of the
 * words happens once the command is known.
 *
 * @param argv the words of the reader.
 */
export function scanWords(argv: readonly string[]): readonly string[] {
  const words: string[] = []
  const rest = [...argv]
  while (rest.length > 0) {
    const token = rest.shift()!
    if (token === '--') {
      words.push(...rest)
      break
    }
    if (token.startsWith('--')) {
      const name = token.slice(2).split('=')[0]!
      if (token.includes('=')) continue
      if (BOOLEAN_OPTIONS.has(name)) continue
      if (VALUE_OPTIONS.has(name)) {
        rest.shift()
        continue
      }
      const next = rest[0]
      if (next !== undefined && !next.startsWith('-')) rest.shift()
      continue
    }
    if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
      const short = token.slice(1).split('=')[0]!
      if (!token.includes('=') && (short === 'o' || short === 'p')) rest.shift()
      continue
    }
    words.push(token)
  }
  return words
}

/**
 * Runs the CLI.
 *
 * @param runtime what the CLI needs to answer.
 * @param argv the words of the reader.
 */
export async function run(runtime: CliRuntime, argv: readonly string[]): Promise<ExitCode> {
  const words = scanWords(argv)
  const first = words[0]

  if (first === undefined) {
    runtime.out(helpOf(runtime.groups))
    return 0
  }

  if (first === 'help') {
    runtime.out(helpFor(runtime, words.slice(1)))
    return 0
  }

  const rootCommand = runtime.commands.find((command) => command.name === first)
  if (rootCommand) {
    return execute(runtime, rootCommand, argv, 1)
  }

  const group = runtime.groups.find((candidate) => candidate.name === first)
  if (!group) {
    throw new CliFailure(
      `the command "${first}" is not one of the CLI: run ${runtime.name} help for the list`,
      2,
      'unknown_command'
    )
  }
  if (words.length === 1) {
    runtime.out(helpOfGroup(group))
    return 2
  }
  const found = findOf(group, words.slice(1))
  if (!found) {
    throw new CliFailure(
      `the command "${group.name} ${words[1] ?? ''}" is not one of the group: run ${runtime.name} ${group.name} --help`,
      2,
      'unknown_command'
    )
  }
  return execute(runtime, found.command, argv, found.skip + 1)
}

/**
 * The command of a group that the words of the reader name.
 *
 * A command may be named by several words: `access tenants list` is one
 * command, and not three.
 *
 * @param group the group of the commands.
 * @param words the words that follow the name of the group.
 */
function findOf(
  group: GroupSpec,
  words: readonly string[]
): { command: CommandSpec; skip: number } | undefined {
  for (let length = Math.min(3, words.length); length >= 1; length -= 1) {
    const name = words.slice(0, length).join(' ')
    const command = group.commands.find((candidate) => candidate.name === name)
    if (command) return { command, skip: length }
  }
  return undefined
}

/**
 * The help of a group, or of a command.
 *
 * @param runtime what the CLI needs to answer.
 * @param words the words that name what the reader asks for.
 */
function helpFor(runtime: CliRuntime, words: readonly string[]): string {
  const groupName = words[0]
  if (groupName === undefined) return helpOf(runtime.groups)
  const group = runtime.groups.find((candidate) => candidate.name === groupName)
  if (!group) {
    const command = runtime.commands.find((candidate) => candidate.name === groupName)
    if (command) {
      const owner = runtime.groups.find((candidate) =>
        candidate.commands.some((entry) => entry.name === command.name)
      )
      if (owner) return helpOfCommand(owner, command)
    }
    return helpOf(runtime.groups)
  }
  const found = findOf(group, words.slice(1))
  if (!found) return helpOfGroup(group)
  return helpOfCommand(group, found.command)
}

/**
 * Reads the words of a command and answers it.
 *
 * @param runtime what the CLI needs to answer.
 * @param command the command the reader named.
 * @param argv the words of the reader.
 * @param skip the number of the words that name the command itself.
 */
async function execute(
  runtime: CliRuntime,
  command: CommandSpec,
  argv: readonly string[],
  skip: number
): Promise<ExitCode> {
  const specs = [...GLOBAL_OPTIONS, ...(command.options ?? [])]
  const parsed = parseArguments(argv, specs)
  const globals = globalsOf(parsed.options, runtime.environment)

  if (globals.help) {
    const owner = runtime.groups.find((group) =>
      group.commands.some((entry) => entry.name === command.name)
    )
    runtime.out(owner ? helpOfCommand(owner, command) : helpOfRootCommand(command))
    return 0
  }

  const positionals = parsed.positionals.slice(skip)
  const missing = (command.arguments ?? []).filter(
    (argument, index) => argument.required && positionals[index] === undefined
  )
  if (missing.length > 0) {
    throw new CliFailure(
      `the argument ${missing[0]!.name} is needed: run ${runtime.name} ${command.name} --help`,
      2,
      'missing_argument'
    )
  }

  const context = await runtime.contextOf(stringOption(parsed.options, 'profile'))
  const services = runtime.services(globals)
  const input: CommandInput = {
    args: positionals,
    options: parsed.options,
    context,
    environment: runtime.environment,
    globals,
    services,
  }
  const result = await command.run(input)
  if (result.message) runtime.out(result.message)
  const text = render(result.value, globals, result.lines)
  if (text !== '') runtime.out(text)
  return result.exit ?? 0
}

/**
 * The options of the CLI, once the words are read.
 *
 * @param options the options of the words.
 * @param environment the environment of the process.
 */
export function globalsOf(
  options: Options,
  environment: Readonly<Record<string, string | undefined>>
): GlobalOptions {
  const format = stringOption(options, 'output') ?? 'table'
  if (format !== 'json' && format !== 'yaml' && format !== 'table') {
    throw new CliFailure(
      `the format ${format} is not one of json, yaml and table`,
      2,
      'invalid_format'
    )
  }
  const color = options.color === undefined ? Boolean(process.stdout.isTTY) : options.color === true
  return {
    output: format,
    quiet: options.quiet === true,
    verbose: options.verbose === true,
    color: color && process.env.NO_COLOR === undefined,
    dryRun: options['dry-run'] === true,
    yes: options.yes === true,
    requestId: stringOption(options, 'request-id') ?? environment.PLATFORMCTL_REQUEST_ID,
    help: options.help === true,
  }
}

/**
 * The value of an option, as a string.
 *
 * @param options the options of the words.
 * @param name the name of the option.
 */
export function stringOption(options: Options, name: string): string | undefined {
  const value = options[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[value.length - 1]
  return undefined
}
