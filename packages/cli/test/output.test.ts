import { describe, expect, test } from 'bun:test'
import { render, yamlOf } from '../src/app/output'
import type { GlobalOptions } from '../src/app/commands'

const TABLE: GlobalOptions = {
  output: 'table',
  quiet: false,
  verbose: false,
  color: false,
  dryRun: false,
  yes: false,
  help: false,
}

describe('the answer of a command', () => {
  test('the json of the answer is the answer', () => {
    expect(render({ a: 1 }, { ...TABLE, output: 'json' })).toBe('{\n  "a": 1\n}')
  })

  test('the yaml of the answer holds the same facts', () => {
    expect(yamlOf({ name: 'acme', count: 2 })).toBe('name: acme\ncount: 2\n')
  })

  test('the yaml of a list holds a dash for every entry', () => {
    expect(yamlOf({ items: ['a', 'b'] })).toBe('items:\n  - a\n  - b\n')
  })

  test('a list of records is a table', () => {
    const lines = render(
      [
        { id: 'one', name: 'first' },
        { id: 'two', name: 'second' },
      ],
      TABLE
    ).split('\n')
    expect(lines[0]).toBe('id   name')
    expect(lines[1]).toBe('one  first')
  })

  test('one thing is a list of facts', () => {
    expect(render({ status: 'ok', count: 3 }, TABLE)).toBe('status: ok\ncount: 3')
  })

  test('the quiet answer holds the names of the things only', () => {
    expect(render([{ id: 'one', name: 'first' }], { ...TABLE, quiet: true })).toBe('one')
  })

  test('the lines of a command are printed when it has them', () => {
    expect(render({ ignored: true }, TABLE, ['the revision 4'])).toBe('the revision 4')
  })

  test('an empty list is nothing to print', () => {
    expect(render([], TABLE)).toBe('')
  })
})
