/**
 * The shape of a command.
 *
 * A command of the CLI is a name, a summary and a function. The
 * function receives what the reader wrote, and it answers a value and
 * the lines that are printed. The value is what a script reads, and the
 * lines are what a human reads: they are the same answer, told twice.
 */

import type { Environment, ResolvedContext } from '../domains/context'
import { CliFailure, type ExitCode } from '../domains/failure'
import type {
  BrowserPort,
  CallbackPort,
  CredentialStorePort,
  CryptoPort,
  HttpPort,
  ProfileStorePort,
} from '../domains/contracts'

/**
 * The ports of the CLI, as they are assembled for one command.
 *
 * The ports are assembled per command: a dry run answers with a
 * transport that writes nothing, and a timeout belongs to the shell it
 * runs in.
 */
export interface Services {
  /** The transport of the calls. */
  readonly http: HttpPort
  /** The store of the profiles of the deployments. */
  readonly profiles: ProfileStorePort
  /** The store of the credential of the caller. */
  readonly credentials: CredentialStorePort
  /** The browser of the machine. */
  readonly browser: BrowserPort
  /** The server of the callback of the login. */
  readonly callback: CallbackPort
  /** The randomness of the login. */
  readonly crypto: CryptoPort
  /** The files of the CLI on the machine of the caller. */
  readonly files: {
    /** The file of the profiles of the deployments. */
    readonly profiles: string
    /** The file of the credential of the caller. */
    readonly credentials: string
  }
}

/** The formats of an answer. */
export type OutputFormat = 'json' | 'yaml' | 'table'

/** The kinds of an option. */
export type OptionKind = 'boolean' | 'string' | 'number' | 'list'

/** The declaration of an option of a command. */
export interface OptionSpec {
  /** The name of the option, without the dashes. */
  readonly name: string
  /** The short name of the option, when it has one. */
  readonly short?: string
  /** The kind of the option. */
  readonly kind: OptionKind
  /** What the option does, in one line. */
  readonly summary: string
  /** The name of the value of the option, in the help. */
  readonly placeholder?: string
  /** The value of the option when the reader names none. */
  readonly default?: string
  /** The values the option accepts. */
  readonly choices?: readonly string[]
}

/** The declaration of an argument of a command. */
export interface ArgumentSpec {
  /** The name of the argument. */
  readonly name: string
  /** What the argument is, in one line. */
  readonly summary: string
  /** True when the argument has to be there. */
  readonly required?: boolean
  /** True when the argument takes the rest of the words. */
  readonly variadic?: boolean
}

/** The options of a command, once they are read. */
export type Options = Readonly<Record<string, string | boolean | string[]>>

/** The options every command shares. */
export interface GlobalOptions {
  /** The format of the answer. */
  readonly output: OutputFormat
  /** True when the answer holds nothing but the names of the things. */
  readonly quiet: boolean
  /** True when the answer holds the details of the calls. */
  readonly verbose: boolean
  /** True when the answer holds no colour. */
  readonly color: boolean
  /** True when the command writes nothing. */
  readonly dryRun: boolean
  /** True when the command does not ask the reader to confirm. */
  readonly yes: boolean
  /** The id of the request, when the reader names one. */
  readonly requestId?: string
  /** True when the reader asks for the help of the command. */
  readonly help: boolean
}

/** What a command receives. */
export interface CommandInput {
  /** The words that are not options. */
  readonly args: readonly string[]
  /** The options of the command and of the CLI. */
  readonly options: Options
  /** The deployment the command works on. */
  readonly context: ResolvedContext
  /** The environment of the process. */
  readonly environment: Environment
  /** The options of the CLI. */
  readonly globals: GlobalOptions
  /** The ports of the command. */
  readonly services: Services
}

/** What a command answers. */
export interface CommandResult {
  /** The answer, in the shape a script reads. */
  readonly value: unknown
  /** The lines that are printed, when the command has its own rendering. */
  readonly lines?: readonly string[]
  /** The status the process ends with. */
  readonly exit?: ExitCode
  /** A message that is printed above the answer. */
  readonly message?: string
}

/** A command of the CLI. */
export interface CommandSpec {
  /** The name of the command. */
  readonly name: string
  /** What the command does, in one line. */
  readonly summary: string
  /** What the command does, in more lines. */
  readonly description?: string
  /** The words the command takes. */
  readonly arguments?: readonly ArgumentSpec[]
  /** The options the command takes. */
  readonly options?: readonly OptionSpec[]
  /** The examples of the command. */
  readonly examples?: readonly string[]
  /** The work of the command. */
  readonly run: (input: CommandInput) => Promise<CommandResult>
}

/** A group of commands. */
export interface GroupSpec {
  /** The name of the group. */
  readonly name: string
  /** What the group holds, in one line. */
  readonly summary: string
  /** What the group holds, in more lines. */
  readonly description?: string
  /** The commands of the group. */
  readonly commands: readonly CommandSpec[]
}

/**
 * The value of an option, as a string.
 *
 * @param options the options of the command.
 * @param name the name of the option.
 */
export function stringOf(options: Options, name: string): string | undefined {
  const value = options[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[value.length - 1]
  return undefined
}

/**
 * The value of an option, as a number.
 *
 * @param options the options of the command.
 * @param name the name of the option.
 */
export function numberOf(options: Options, name: string): number | undefined {
  const value = stringOf(options, name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * The value of an option, as a list.
 *
 * @param options the options of the command.
 * @param name the name of the option.
 */
export function listOf(options: Options, name: string): readonly string[] {
  const value = options[name]
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

/**
 * The body of a command, read from a file or from the command line.
 *
 * A command that writes something takes the body of the write from a
 * file, or from the words that follow a `--body` option. The file is
 * the way a body of a record is written, and it is the only way a body
 * of a table of the gateway is written.
 *
 * @param input what the command received.
 * @param option the name of the option that names the body.
 */
export async function bodyOf(input: CommandInput, option = 'body'): Promise<unknown> {
  const path = stringOf(input.options, option)
  const inline = stringOf(input.options, 'data')
  if (path) {
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(path, 'utf8')
    try {
      return JSON.parse(content)
    } catch {
      throw new CliFailure(`the file ${path} does not hold valid json`, 8, 'invalid_file')
    }
  }
  if (inline) {
    try {
      return JSON.parse(inline)
    } catch {
      throw new CliFailure('the body is not valid json', 8, 'invalid_body')
    }
  }
  throw new CliFailure(
    'no body is given: pass --body <file> or --data <json>',
    2,
    'missing_argument'
  )
}
