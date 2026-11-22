import { describe, expect, test } from 'bun:test'
import { options } from '../src/options.ts'

/**
 * The options the operator's commands take, read by node's own parser: the same everywhere,
 * and the same as in every other tool that speaks them.
 */
describe('the options a command is given', () => {
  test('are read the way node reads them: --name=value and --name value alike', () => {
    const { values, rest } = options(['--dir=examples/newsroom', '--port', '8080'], {
      dir: { type: 'string' },
      port: { type: 'string' },
    })
    expect(values).toEqual({ dir: 'examples/newsroom', port: '8080' })
    expect(rest).toEqual([])
  })

  test('a flag is there or is not', () => {
    const { values } = options(['--dry-run'], { 'dry-run': { type: 'boolean' } })
    expect(values).toEqual({ 'dry-run': true })
    const { values: without } = options([], { 'dry-run': { type: 'boolean' } })
    expect(without).toEqual({ 'dry-run': false })
  })

  test('an option the command does not know is refused by name', () => {
    expect(() => options(['--bogus'], { dir: { type: 'string' } })).toThrow(
      'Unknown option: --bogus'
    )
  })

  test('an option given twice is refused, and not read as the last one', () => {
    expect(() =>
      options(['--engine=docker', '--engine=podman'], { engine: { type: 'string' } })
    ).toThrow('Repeated --engine')
  })

  test('an option with no value is refused', () => {
    expect(() => options(['--dir='], { dir: { type: 'string' } })).toThrow('--dir needs a value')
    expect(() => options(['--dir'], { dir: { type: 'string' } })).toThrow('--dir needs a value')
  })

  test('what is left is given back as it was written, for another program', () => {
    const { values, rest } = options(
      ['-f', 'relay', '--namespace', 'team'],
      { namespace: { type: 'string' } },
      { unknown: 'keep', positionals: 'keep' }
    )
    expect(values).toEqual({ namespace: 'team' })
    expect(rest).toEqual(['-f', 'relay'])
  })

  test('arguments a command has no use for are refused', () => {
    expect(() => options(['local'], { dir: { type: 'string' } })).toThrow(
      'Unexpected argument: local'
    )
    expect(() => options(['one', 'two'], { dir: { type: 'string' } })).toThrow(
      'Unexpected arguments: one two'
    )
  })
})
