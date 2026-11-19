import { describe, expect, test } from 'bun:test'
import {
  customViews,
  everyView,
  indexViews,
  inFilter,
  inList,
  inRecord,
  isLocked,
  parseViews,
  validViewName,
  viewsEqual,
  viewsOf,
  viewsValue,
} from '../src/metadata/views.ts'

/**
 * Where a field appears. A field is a column in the records grid, an input in the record form
 * and a column in the filter builder, and it may say which of those it belongs to.
 */

const rows = [
  {
    scope: 'field' as const,
    schema_name: 'newsroom',
    table_name: 'articles',
    column_name: 'title',
    key: 'views',
    value: { list: 'show', record: 'readonly', filter: 'hide' },
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

describe('Where a field appears', () => {
  test('a field without a saying appears everywhere', () => {
    expect(parseViews(undefined)).toEqual(everyView)
    expect(parseViews(null)).toEqual(everyView)
    expect(parseViews('show')).toEqual(everyView)
    expect(parseViews([{ list: 'hide' }])).toEqual(everyView)
  })

  test('a saying is read as it was written', () => {
    expect(parseViews({ list: 'hide', record: 'readonly', filter: 'show' })).toEqual({
      list: 'hide',
      record: 'readonly',
      filter: 'show',
    })
  })

  test('a situation that is not named keeps the saying of every field', () => {
    expect(parseViews({ list: 'hide' })).toEqual({ list: 'hide', record: 'show', filter: 'show' })
  })

  test('a saying that cannot be read is ignored', () => {
    expect(parseViews({ list: 'perhaps', record: 3 })).toEqual(everyView)
  })

  test('a yes and a no are read as shown and hidden', () => {
    expect(parseViews({ list: false, filter: true })).toEqual({
      list: 'hide',
      record: 'show',
      filter: 'show',
    })
  })

  test('only the record can be locked', () => {
    expect(parseViews({ list: 'readonly', filter: 'readonly' })).toEqual({
      list: 'show',
      record: 'show',
      filter: 'show',
    })
    expect(parseViews({ record: 'readonly' }).record).toBe('readonly')
  })

  test('every field’s saying is filed by the column it names', () => {
    const index = indexViews(rows)
    expect(viewsOf(index, 'title')).toEqual({ list: 'show', record: 'readonly', filter: 'hide' })
    // A field whose other metadata says nothing about where it appears appears everywhere.
    expect(viewsOf(index, 'summary')).toEqual(everyView)
    expect(viewsOf(index, 'nowhere')).toEqual(everyView)
  })

  test('a field is in the list, in the record and in the filters, or in none of them', () => {
    const hidden = { list: 'hide', record: 'hide', filter: 'hide' } as const
    expect(inList(everyView)).toBe(true)
    expect(inRecord(everyView)).toBe(true)
    expect(inFilter(everyView)).toBe(true)
    expect(inList(hidden)).toBe(false)
    expect(inRecord(hidden)).toBe(false)
    expect(inFilter(hidden)).toBe(false)
  })

  test('a field shown and locked is still shown', () => {
    const views = parseViews({ record: 'readonly' })
    expect(inRecord(views)).toBe(true)
    expect(isLocked(views)).toBe(true)
    expect(isLocked(everyView)).toBe(false)
  })

  test('a saying is written as the three situations', () => {
    expect(viewsValue({ list: 'show', record: 'readonly', filter: 'hide' })).toEqual({
      list: 'show',
      record: 'readonly',
      filter: 'hide',
    })
  })

  test('a view of the owner’s own is kept as it was said', () => {
    const views = parseViews({ list: 'hide', export: 'show', print: 'readonly' })
    expect(views.export).toBe('show')
    expect(views.print).toBe('readonly')
    expect(customViews(views)).toEqual({ export: 'show', print: 'readonly' })
    // The three the interface draws are not views of the owner’s own.
    expect(customViews(everyView)).toEqual({})
  })

  test('a saying of the owner’s own is written back as it was read', () => {
    const views = parseViews({ list: 'hide', record: 'show', filter: 'hide', export: 'show' })
    expect(viewsValue(views)).toEqual({
      list: 'hide',
      record: 'show',
      filter: 'hide',
      export: 'show',
    })
  })

  test('a view of the owner’s own may be locked as well as hidden', () => {
    expect(parseViews({ export: 'readonly' }).export).toBe('readonly')
    expect(parseViews({ export: 'hide' }).export).toBe('hide')
  })

  test('a view of the owner’s own that cannot be read is ignored', () => {
    expect(parseViews({ export: 'perhaps' }).export).toBeUndefined()
    expect(customViews(parseViews({ export: 'perhaps' }))).toEqual({})
  })

  test('a view is named by letters, digits, underscores and dashes', () => {
    expect(validViewName('export')).toBe(true)
    expect(validViewName('print_sheet')).toBe(true)
    expect(validViewName('print-sheet')).toBe(true)
    expect(validViewName('2nd')).toBe(false)
    expect(validViewName('a b')).toBe(false)
    expect(validViewName('')).toBe(false)
    expect(validViewName('drop;')).toBe(false)
  })

  test('two sayings are the same saying, whatever order they were said in', () => {
    const one = parseViews({ list: 'hide', export: 'show', print: 'hide' })
    const other = parseViews({ print: 'hide', export: 'show', list: 'hide' })
    expect(viewsEqual(one, other)).toBe(true)
    expect(viewsEqual(one, parseViews({ list: 'hide', export: 'hide' }))).toBe(false)
    expect(
      viewsEqual(everyView, parseViews({ list: 'show', record: 'show', filter: 'show' }))
    ).toBe(true)
  })
})
