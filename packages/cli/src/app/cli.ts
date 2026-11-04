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
import { beginningOf, closestOf } from './suggest'

/** What the CLI needs to answer. */
export interface CliRuntime {
  /** The name of the program. */
  readonly name: string
  /** The version of the program, when it is known. */
  readonly version?: string
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
const BOOLEAN_OPTIONS = new Set(['quiet', 'verbose', 'color', 'dry-run', 'yes', 'help', 'version'])

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

  if (wantsVersion(argv)) {
    runtime.out(runtime.version ? `${runtime.name} ${runtime.version}` : runtime.name)
    return 0
  }

  if (first === undefined) {
    runtime.out(helpOf(runtime.groups, runtime.commands, runtime.name))
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
    throw unknownCommand(runtime, first)
  }
  const rest = words.slice(1)
  if (rest.length === 0) {
    runtime.out(helpOfGroup(group, runtime.name))
    return wantsHelp(argv) ? 0 : 2
  }
  if (rest[0] === 'help') {
    runtime.out(helpOfGroup(group, runtime.name))
    return 0
  }
  const found = findOf(group, rest)
  if (!found) {
    throw unknownCommandOfGroup(runtime, group, rest)
  }
  return execute(runtime, found.command, argv, found.skip + 1)
}

/**
 * The refusal of a word that names no command of the CLI.
 *
 * The refusal names the command that is the closest to the word the
 * reader typed: a reader who typed a word that is near a command knows
 * what they meant.
 *
 * @param runtime what the CLI needs to answer.
 * @param word the word of the reader.
 */
function unknownCommand(runtime: CliRuntime, word: string): CliFailure {
  const candidates = [
    ...runtime.commands.map((command) => command.name),
    ...runtime.groups.map((group) => group.name),
  ]
  const closest = closestOf(word, candidates)
  const hint = closest
    ? `did you mean "${closest}"?`
    : `run ${runtime.name} help for the list of the commands`
  return new CliFailure(
    `the command "${word}" is not one of the CLI`,
    2,
    'unknown_command',
    undefined,
    hint
  )
}

/**
 * The refusal of a word that names no command of a group.
 *
 * The refusal names the commands that begin with what the reader typed
 * when there are some: the reader was reaching for one of them.
 *
 * @param runtime what the CLI needs to answer.
 * @param group the group the reader was in.
 * @param words the words of the reader.
 */
function unknownCommandOfGroup(
  runtime: CliRuntime,
  group: GroupSpec,
  words: readonly string[]
): CliFailure {
  const candidates = group.commands.map((command) => command.name)
  const typed = words.join(' ')
  const beginnings = beginningOf(words, candidates)
  const closest = beginnings.length === 0 ? closestOf(typed, candidates) : undefined
  const outside =
    closest === undefined
      ? closestOf(typed, [
          ...runtime.commands.map((command) => command.name),
          ...runtime.groups.map((candidate) => candidate.name),
        ])
      : undefined
  const hint =
    beginnings.length > 0
      ? `did you mean one of ${beginnings.map((name) => `"${group.name} ${name}"`).join(', ')}?`
      : closest
        ? `did you mean "${group.name} ${closest}"?`
        : outside
          ? `did you mean "${outside}"?`
          : `run ${runtime.name} ${group.name} --help for the list of the commands`
  return new CliFailure(
    `the command "${group.name} ${typed}" is not one of the group`,
    2,
    'unknown_command',
    undefined,
    hint
  )
}

/**
 * True when the reader asks for the version of the program.
 *
 * @param argv the words of the reader.
 */
function wantsVersion(argv: readonly string[]): boolean {
  return argv.includes('--version')
}

/**
 * True when the reader asks for the help.
 *
 * @param argv the words of the reader.
 */
function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h')
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
  if (groupName === undefined) return helpOf(runtime.groups, runtime.commands, runtime.name)
  const group = runtime.groups.find((candidate) => candidate.name === groupName)
  if (!group) {
    const command = runtime.commands.find((candidate) => candidate.name === groupName)
    if (command) {
      const owner = runtime.groups.find((candidate) =>
        candidate.commands.some((entry) => entry.name === command.name)
      )
      if (owner) return helpOfCommand(owner, command, runtime.name)
    }
    return helpOf(runtime.groups, runtime.commands, runtime.name)
  }
  const found = findOf(group, words.slice(1))
  if (!found) return helpOfGroup(group, runtime.name)
  return helpOfCommand(group, found.command, runtime.name)
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
  const owner = runtime.groups.find((group) =>
    group.commands.some((entry) => entry.name === command.name)
  )
  const path = owner ? `${owner.name} ${command.name}` : command.name

  if (globals.help) {
    runtime.out(
      owner ? helpOfCommand(owner, command, runtime.name) : helpOfRootCommand(command, runtime.name)
    )
    return 0
  }

  const positionals = parsed.positionals.slice(skip)
  const missing = (command.arguments ?? []).filter(
    (argument, index) => argument.required && positionals[index] === undefined
  )
  if (missing.length > 0) {
    throw new CliFailure(
      `the argument <${missing[0]!.name}> is needed`,
      2,
      'missing_argument',
      undefined,
      `run ${runtime.name} ${path} --help`
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
  const noColor = environment.NO_COLOR ?? process.env.NO_COLOR
  return {
    output: format,
    quiet: options.quiet === true,
    verbose: options.verbose === true,
    color: color && noColor === undefined,
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
