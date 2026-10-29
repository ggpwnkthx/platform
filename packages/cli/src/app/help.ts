/**
 * The help of the CLI.
 *
 * The help is written for the reader of a terminal: it names the groups,
 * the commands and the options, and it shows an example of every
 * command that does something another command cannot do.
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
  { name: 'help', short: 'h', kind: 'boolean', summary: 'print this help' },
]

/**
 * The help of the CLI.
 *
 * @param groups the groups of the commands.
 * @param name the name of the program.
 */
export function helpOf(groups: readonly GroupSpec[], name = 'platformctl'): string {
  const lines: string[] = [
    `${name} — the command line of the platform.`,
    '',
    'The CLI is a client of the gateway, Access and Data, and it decides nothing.',
    '',
    'Usage:',
    `  ${name} <group> <command> [options]`,
    `  ${name} <group> <command> --help`,
    '',
    'Groups:',
  ]
  for (const group of groups) {
    lines.push(`  ${group.name.padEnd(14)} ${group.summary}`)
  }
  lines.push('')
  lines.push('Options:')
  lines.push(...optionLines(GLOBAL_OPTIONS))
  lines.push('')
  lines.push('Run `platformctl <group> --help` for the commands of a group.')
  return lines.join('\n')
}

/**
 * The help of a group.
 *
 * @param group the group of the commands.
 */
export function helpOfGroup(group: GroupSpec): string {
  const lines: string[] = [`${group.name} — ${group.summary}`, '']
  if (group.description) {
    lines.push(group.description, '')
  }
  lines.push('Commands:')
  for (const command of group.commands) {
    lines.push(`  ${command.name.padEnd(18)} ${command.summary}`)
  }
  lines.push('', 'Options:')
  lines.push(...optionLines(GLOBAL_OPTIONS))
  return lines.join('\n')
}

/**
 * The help of a command.
 *
 * @param group the group of the command.
 * @param command the command.
 */
export function helpOfCommand(group: GroupSpec, command: CommandSpec): string {
  const usage = usageOf(group, command)
  const lines: string[] = [`${group.name} ${command.name} — ${command.summary}`, '']
  if (command.description) {
    lines.push(command.description, '')
  }
  lines.push('Usage:', `  ${usage}`, '')
  if (command.arguments && command.arguments.length > 0) {
    lines.push('Arguments:')
    for (const argument of command.arguments) {
      const name = argument.required ? argument.name : `[${argument.name}]`
      lines.push(`  ${name.padEnd(20)} ${argument.summary}`)
    }
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
 */
export function helpOfRootCommand(command: CommandSpec): string {
  const lines: string[] = [`${command.name} — ${command.summary}`, '']
  if (command.description) {
    lines.push(command.description, '')
  }
  lines.push('Usage:', `  ${command.name} [options]`, '')
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
 * @param group the group of the command.
 * @param command the command.
 */
export function usageOf(group: GroupSpec, command: CommandSpec): string {
  const words = [group.name, command.name]
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
function optionLines(specs: readonly OptionSpec[]): string[] {
  return specs.map((spec) => {
    const short = spec.short ? `-${spec.short}, ` : '    '
    const placeholder = spec.placeholder ? ` <${spec.placeholder}>` : ''
    const name = `${short}--${spec.name}${placeholder}`
    const defaultValue = spec.default ? ` (default: ${spec.default})` : ''
    return `  ${name.padEnd(28)} ${spec.summary}${defaultValue}`
  })
}
