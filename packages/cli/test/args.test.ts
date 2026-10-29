import { describe, expect, test } from 'bun:test'
import { parseArguments } from '../src/app/args'
import { CliFailure } from '../src/domains/failure'

const SPECS = [
  { name: 'output', short: 'o', kind: 'string' as const, summary: 'the format' },
  { name: 'quiet', short: 'q', kind: 'boolean' as const, summary: 'the names only' },
  { name: 'subject', kind: 'string' as const, summary: 'the subject' },
  { name: 'member', kind: 'list' as const, summary: 'the members' },
]

describe('the words of the reader', () => {
  test('a word that is not an option is an argument', () => {
    const parsed = parseArguments(['notes', '42'], SPECS)
    expect(parsed.positionals).toEqual(['notes', '42'])
    expect(parsed.options).toEqual({})
  })

  test('an option takes the word that follows it', () => {
    const parsed = parseArguments(['--subject', 'alice'], SPECS)
    expect(parsed.options.subject).toBe('alice')
    expect(parsed.positionals).toEqual([])
  })

  test('an option takes the value it carries', () => {
    const parsed = parseArguments(['--output=json'], SPECS)
    expect(parsed.options.output).toBe('json')
  })

  test('a flag is true, and its opposite is false', () => {
    expect(parseArguments(['--quiet'], SPECS).options.quiet).toBe(true)
    expect(parseArguments(['--no-quiet'], SPECS).options.quiet).toBe(false)
  })

  test('a short option is the long one', () => {
    expect(parseArguments(['-o', 'yaml'], SPECS).options.output).toBe('yaml')
    expect(parseArguments(['-q'], SPECS).options.quiet).toBe(true)
  })

  test('an option that is given twice keeps the last one', () => {
    expect(parseArguments(['--subject', 'a', '--subject', 'b'], SPECS).options.subject).toBe('b')
  })

  test('a list keeps every value it is given', () => {
    const parsed = parseArguments(['--member', 'a', '--member', 'b'], SPECS)
    expect(parsed.options.member).toEqual(['a', 'b'])
  })

  test('the words after the separator are arguments', () => {
    const parsed = parseArguments(['--', '--subject', 'alice'], SPECS)
    expect(parsed.positionals).toEqual(['--subject', 'alice'])
  })

  test('an option that is not one of the command is refused', () => {
    try {
      parseArguments(['--nope'], SPECS)
      throw new Error('the option was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).exit).toBe(2)
    }
  })

  test('an option that needs a value and has none is refused', () => {
    try {
      parseArguments(['--subject'], SPECS)
      throw new Error('the option was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).exit).toBe(2)
    }
  })
})
