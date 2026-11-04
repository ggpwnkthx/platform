/**
 * The help of the CLI.
 *
 * The help is written for the reader of a terminal: it names the
 * commands, the groups, the options and the examples, and it is laid
 * out in columns that line up, because a help that does not line up is
 * a help that has to be read twice.
 */

import type { CommandSpec, GroupSpec, OptionSpec } from './commands'

/** The options every command shares. */
export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'output',
    short: 'o',
    kind: 'string',
    summary: 'the format of the answer',
    placeholder: 'json|yaml|table',
    default: 'table',
  },
  { name: 'quiet', short: 'q', kind: 'boolean', summary: 'print the names of the things only' },
  { name: 'verbose', kind: 'boolean', summary: 'print the details of the calls' },
  { name: 'color', kind: 'boolean', summary: 'print the answer in colour' },
  {
    name: 'profile',
    short: 'p',
    kind: 'string',
    summary: 'the profile of the deployment',
    placeholder: 'name',
  },
  {
    name: 'dry-run',
    kind: 'boolean',
    summary: 'print the request that would be sent, and send nothing',
  },
  { name: 'yes', short: 'y', kind: 'boolean', summary: 'do not ask the reader to confirm' },
  { name: 'request-id', kind: 'string', summary: 'the id of the request' },
  { name: 'version', kind: 'boolean', summary: 'print the version of the CLI' },
  { name: 'help', short: 'h', kind: 'boolean', summary: 'print this help' },
]

/** The width of a column of the help, at most. */
const MAX_WIDTH = 30

/**
 * The help of the CLI.
 *
 * @param groups the groups of the commands.
 * @param commands the commands of the root.
 * @param name the name of the program.
 */
export function helpOf(
  groups: readonly GroupSpec[],
  commands: readonly CommandSpec[] = [],
  name = 'platformctl'
): string {
  const lines: string[] = [
    `${name} — the command line of the platform.`,
    '',
    'The CLI is a client of the gateway, Access and Data, and it decides nothing.',
    '',
    'Usage:',
    `  ${name} <command> [options]`,
    `  ${name} <group> <command> [options]`,
    `  ${name} help [<group> [<command>]]`,
    '',
  ]
  if (commands.length > 0) {
    lines.push('Commands:')
    lines.push(...rowsOf(commands.map((command) => [command.name, command.summary] as const)))
    lines.push('')
  }
  lines.push('Groups:')
  lines.push(...rowsOf(groups.map((group) => [group.name, group.summary] as const)))
  lines.push('')
  lines.push('Options:')
  lines.push(...optionLines(GLOBAL_OPTIONS))
  lines.push('')
  lines.push(`Run \`${name} <group> --help\` for the commands of a group.`)
  lines.push(`Run \`${name} <command> --help\` for the details of a command.`)
  return lines.join('\n')
}

/**
 * The help of a group.
 *
 * @param group the group of the commands.
 * @param name the name of the program.
 */
export function helpOfGroup(group: GroupSpec, name = 'platformctl'): string {
  const lines: string[] = [`${group.name} — ${group.summary}`, '']
  if (group.description) {
    lines.push(group.description, '')
  }
  lines.push('Commands:')
  lines.push(...rowsOf(group.commands.map((command) => [command.name, command.summary] as const)))
  lines.push('')
  lines.push('Options:')
  lines.push(...optionLines(GLOBAL_OPTIONS))
  lines.push('')
  lines.push(`Run \`${name} ${group.name} <command> --help\` for the details of a command.`)
  return lines.join('\n')
}

/**
 * The help of a command.
 *
 * @param group the group of the command.
 * @param command the command.
 * @param name the name of the program.
 */
export function helpOfCommand(
  group: GroupSpec,
  command: CommandSpec,
  name = 'platformctl'
): string {
  const lines: string[] = [`${group.name} ${command.name} — ${command.summary}`, '']
  if (command.description) {
    lines.push(command.description, '')
  }
  lines.push('Usage:', `  ${usageOf(group, command, name)}`, '')
  if (command.arguments && command.arguments.length > 0) {
    lines.push('Arguments:')
    lines.push(
      ...rowsOf(
        command.arguments.map((argument) => {
          const word = argument.required ? `<${argument.name}>` : `[${argument.name}]`
          return [word, argument.summary] as const
        })
      )
    )
    lines.push('')
  }
  if (command.options && command.options.length > 0) {
    lines.push('Options:')
    lines.push(...optionLines(command.options))
    lines.push('')
  }
  if (command.examples && command.examples.length > 0) {
    lines.push('Examples:')
    for (const example of command.examples) {
      lines.push(`  ${example}`)
    }
    lines.push('')
  }
  lines.push('Options of the CLI:')
  lines.push(...optionLines(GLOBAL_OPTIONS))
  return lines.join('\n')
}

/**
 * The help of a command of the root.
 *
 * A command of the root has no group, and its name is the name of the
 * command itself.
 *
 * @param command the command.
 * @param name the name of the program.
 */
export function helpOfRootCommand(command: CommandSpec, name = 'platformctl'): string {
  const lines: string[] = [`${command.name} — ${command.summary}`, '']
  if (command.description) {
    lines.push(command.description, '')
  }
  lines.push('Usage:', `  ${usageOf(undefined, command, name)}`, '')
  if (command.arguments && command.arguments.length > 0) {
    lines.push('Arguments:')
    lines.push(
      ...rowsOf(
        command.arguments.map((argument) => {
          const word = argument.required ? `<${argument.name}>` : `[${argument.name}]`
          return [word, argument.summary] as const
        })
      )
    )
    lines.push('')
  }
  if (command.options && command.options.length > 0) {
    lines.push('Options:')
    lines.push(...optionLines(command.options))
    lines.push('')
  }
  if (command.examples && command.examples.length > 0) {
    lines.push('Examples:')
    for (const example of command.examples) {
      lines.push(`  ${example}`)
    }
    lines.push('')
  }
  lines.push('Options of the CLI:')
  lines.push(...optionLines(GLOBAL_OPTIONS))
  return lines.join('\n')
}

/**
 * The way a command is called.
 *
 * @param group the group of the command, when it has one.
 * @param command the command.
 * @param name the name of the program.
 */
export function usageOf(
  group: GroupSpec | undefined,
  command: CommandSpec,
  name = 'platformctl'
): string {
  const words = [name]
  if (group) words.push(group.name)
  words.push(command.name)
  for (const argument of command.arguments ?? []) {
    words.push(argument.required ? `<${argument.name}>` : `[${argument.name}]`)
  }
  words.push('[options]')
  return words.join(' ')
}

/**
 * The lines of the options of a command.
 *
 * @param specs the options of the command.
 */
export function optionLines(specs: readonly OptionSpec[]): string[] {
  return rowsOf(
    specs.map((spec) => {
      const short = spec.short ? `-${spec.short}, ` : '    '
      const placeholder = spec.placeholder ? ` <${spec.placeholder}>` : ''
      const left = `${short}--${spec.name}${placeholder}`
      const choices =
        spec.choices && spec.choices.length > 0 ? ` (one of ${spec.choices.join(', ')})` : ''
      const defaultValue = spec.default ? ` (default: ${spec.default})` : ''
      return [left, `${spec.summary}${choices}${defaultValue}`] as const
    })
  )
}

/**
 * The lines of a list of things whose first column is a name.
 *
 * The width of the column is the width of the longest name, up to a
 * limit: a column that is too wide pushes the text of every line far
 * to the right, and the reader has to hunt for it.
 *
 * @param rows the names and what they say.
 */
function rowsOf(rows: readonly (readonly [string, string])[]): string[] {
  if (rows.length === 0) return []
  const width = Math.min(MAX_WIDTH, Math.max(...rows.map(([left]) => left.length)))
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd())
}
