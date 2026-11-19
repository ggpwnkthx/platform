import { describe, expect, test } from 'bun:test'
import {
  indexRenderers,
  noRenderers,
  parseRenderers,
  renderersEqual,
  renderersOf,
  renderersValue,
  validRendererName,
} from '../src/index.ts'

/**
 * How a field's values are drawn. A value is not one thing drawn one way: the same field is
 * a cell in the records grid, a value in the record form and a value in the filter builder,
 * and each of those may want a different drawing.
 */

const rows = [
  {
    scope: 'field' as const,
    schema_name: 'newsroom',
    table_name: 'articles',
    column_name: 'title',
    key: 'renderers',
    value: {
      list: 'truncate',
      record: { renderer: 'template', options: { template: '» {value}' } },
    },
  },
  {
    scope: 'field' as const,
    schema_name: 'newsroom',
    table_name: 'articles',
    column_name: 'summary',
    key: 'display_name',
    value: 'Summary',
  },
]

describe('How a field’s values are drawn', () => {
  test('a field that says nothing is drawn as the platform draws it', () => {
    expect(parseRenderers(undefined)).toEqual({})
    expect(parseRenderers(null)).toEqual({})
    expect(parseRenderers('truncate')).toEqual({})
    expect(parseRenderers([{ list: 'truncate' }])).toEqual({})
  })

  test('a renderer is named by its name, or by its name and its options', () => {
    expect(parseRenderers({ list: 'truncate' })).toEqual({
      list: { renderer: 'truncate', options: {} },
    })
    expect(parseRenderers({ list: { renderer: 'truncate', options: { length: 20 } } })).toEqual({
      list: { renderer: 'truncate', options: { length: 20 } },
    })
  })

  test('a saying that cannot be read is ignored', () => {
    expect(parseRenderers({ list: { renderer: 3 } }).list).toBeUndefined()
    expect(parseRenderers({ list: { renderer: 'drop; table' } }).list).toBeUndefined()
    expect(parseRenderers({ list: '' }).list).toBeUndefined()
  })

  test('a renderer the platform does not hold is kept as it was said', () => {
    // The installation may add one of its own; the saying is not lost while it waits.
    expect(parseRenderers({ list: 'shout' }).list).toEqual({ renderer: 'shout', options: {} })
  })

  test('every field’s saying is filed by the column it names', () => {
    const index = indexRenderers(rows)
    expect(renderersOf(index, 'title').list).toEqual({ renderer: 'truncate', options: {} })
    expect(renderersOf(index, 'title').record?.options).toEqual({ template: '» {value}' })
    expect(renderersOf(index, 'summary')).toEqual(noRenderers)
    expect(renderersOf(index, 'nowhere')).toEqual(noRenderers)
  })

  test('a saying is written back as it was read', () => {
    const renderers = parseRenderers({
      list: 'truncate',
      record: { renderer: 'template', options: { template: '» {value}' } },
    })
    expect(renderersValue(renderers)).toEqual({
      list: 'truncate',
      record: { renderer: 'template', options: { template: '» {value}' } },
    })
  })

  test('two sayings are the same saying, whatever order they were said in', () => {
    const one = parseRenderers({ list: 'truncate', record: 'text' })
    const other = parseRenderers({ record: 'text', list: 'truncate' })
    expect(renderersEqual(one, other)).toBe(true)
    expect(renderersEqual(one, parseRenderers({ list: 'truncate' }))).toBe(false)
  })

  test('a renderer is named by letters, digits, underscores and dashes', () => {
    expect(validRendererName('truncate')).toBe(true)
    expect(validRendererName('print_sheet')).toBe(true)
    expect(validRendererName('2nd')).toBe(false)
    expect(validRendererName('a b')).toBe(false)
    expect(validRendererName('')).toBe(false)
  })
})
