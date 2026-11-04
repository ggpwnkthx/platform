/**
 * The words of the reader.
 *
 * The CLI reads the words of the reader the way a program reads them:
 * an option is a name and a value, a flag is a name alone, and a word
 * that names nothing is refused with the status of a usage error.
 *
 * The parser is a pure function of the words and of the options the
 * command declares, and it is the function the tests of the CLI prove.
 */

import { CliFailure } from '../domains/failure'
import type { OptionSpec, Options } from './commands'
import { closestOf } from './suggest'

/** The words of the reader, once they are read. */
export interface ParsedArguments {
  /** The words that are not options. */
  readonly positionals: readonly string[]
  /** The options, by their long name. */
  readonly options: Options
}

/**
 * Reads the words of the reader.
 *
 * @param argv the words of the reader.
 * @param specs the options the command declares.
 */
export function parseArguments(
  argv: readonly string[],
  specs: readonly OptionSpec[]
): ParsedArguments {
  const byName = new Map<string, OptionSpec>()
  const byShort = new Map<string, OptionSpec>()
  for (const spec of specs) {
    byName.set(spec.name, spec)
    if (spec.short) byShort.set(spec.short, spec)
  }
  const positionals: string[] = []
  const options: Record<string, string | boolean | string[]> = {}
  let onlyWords = false

  const read = (name: string, inline: string | undefined, rest: string[]): string | undefined => {
    if (inline !== undefined) return inline
    const next = rest.shift()
    if (next === undefined) {
      throw new CliFailure(`the option ${name} needs a value`, 2, 'missing_value')
    }
    return next
  }

  const rest = [...argv]
  while (rest.length > 0) {
    const word = rest.shift()!
    if (onlyWords) {
      positionals.push(word)
      continue
    }
    if (word === '--') {
      onlyWords = true
      continue
    }
    if (word.startsWith('--')) {
      const equals = word.indexOf('=')
      const name = equals >= 0 ? word.slice(2, equals) : word.slice(2)
      const inline = equals >= 0 ? word.slice(equals + 1) : undefined
      if (name.startsWith('no-')) {
        const positive = byName.get(name.slice(3))
        if (positive && positive.kind === 'boolean') {
          options[positive.name] = false
          continue
        }
      }
      const spec = byName.get(name)
      if (!spec) {
        throw unknownOption(name, [...byName.keys()], '--')
      }
      if (spec.kind === 'boolean') {
        options[spec.name] = inline === undefined ? true : inline !== 'false'
        continue
      }
      const value = read(`--${name}`, inline, rest) ?? ''
      if (spec.kind === 'list') {
        const existing = options[spec.name]
        const list = Array.isArray(existing) ? existing : []
        list.push(value)
        options[spec.name] = list
        continue
      }
      checkValue(spec, value, `--${name}`)
      options[spec.name] = value
      continue
    }
    if (word.startsWith('-') && word.length > 1 && !/^-\d/.test(word)) {
      const name = word.slice(1)
      const equals = name.indexOf('=')
      const short = equals >= 0 ? name.slice(0, equals) : name
      const inline = equals >= 0 ? name.slice(equals + 1) : undefined
      const spec = byShort.get(short)
      if (!spec) {
        throw unknownOption(short, [...byShort.keys()], '-')
      }
      if (spec.kind === 'boolean') {
        options[spec.name] = inline === undefined ? true : inline !== 'false'
        continue
      }
      const value = read(`-${short}`, inline, rest) ?? ''
      if (spec.kind === 'list') {
        const existing = options[spec.name]
        const list = Array.isArray(existing) ? existing : []
        list.push(value)
        options[spec.name] = list
        continue
      }
      checkValue(spec, value, `-${short}`)
      options[spec.name] = value
      continue
    }
    positionals.push(word)
  }

  return { positionals, options }
}

/**
 * The refusal of an option the command does not declare.
 *
 * The refusal names the option that is the closest to the one the
 * reader typed: a reader who typed an option that is near another one
 * knows what they meant.
 *
 * @param name the name of the option.
 * @param candidates the names of the options the command declares.
 * @param prefix the dashes the options are written with.
 */
function unknownOption(name: string, candidates: readonly string[], prefix: string): CliFailure {
  const closest = closestOf(name, candidates)
  const message = closest
    ? `the option ${name} is not one of this command: did you mean ${prefix}${closest}?`
    : `the option ${name} is not one of this command`
  return new CliFailure(message, 2, 'unknown_option')
}

/**
 * The refusal of a value an option does not accept.
 *
 * @param spec the option that was given the value.
 * @param value the value that was given.
 * @param written how the option was written.
 */
function checkValue(spec: OptionSpec, value: string, written: string): void {
  if (spec.choices && spec.choices.length > 0 && !spec.choices.includes(value)) {
    throw new CliFailure(
      `the value "${value}" of ${written} is not one of ${spec.choices.join(', ')}`,
      2,
      'invalid_value'
    )
  }
  if (spec.kind === 'number' && !Number.isFinite(Number(value))) {
    throw new CliFailure(`the value "${value}" of ${written} is not a number`, 2, 'invalid_value')
  }
}
