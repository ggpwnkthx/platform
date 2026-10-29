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
        throw new CliFailure(`the option ${name} is not one of this command`, 2, 'unknown_option')
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
        throw new CliFailure(`the option -${short} is not one of this command`, 2, 'unknown_option')
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
      options[spec.name] = value
      continue
    }
    positionals.push(word)
  }

  return { positionals, options }
}
