import { describe, expect, test } from 'bun:test'
import {
  type FieldMetadata,
  nextSortOf,
  pageUrl,
  readPageQuery,
  readValues,
} from '../src/domains/data'

const field = (name: string, type: string, extra: Partial<FieldMetadata> = {}): FieldMetadata => ({
  name,
  type,
  required: false,
  nullable: true,
  ...extra,
})

const FIELDS = [
  field('title', 'string', { nullable: false }),
  field('count', 'integer'),
  field('amount', 'decimal'),
  field('done', 'boolean'),
  field('at', 'timestamp'),
  field('meta', 'json'),
  field('secret', 'string'),
]
const WRITABLE = ['title', 'count', 'amount', 'done', 'at', 'meta']

describe('the values of a form', () => {
  test('a creation carries the typed values of the filled fields', () => {
    const read = readValues({
      fields: FIELDS,
      writable: WRITABLE,
      form: {
        title: 'Hello',
        count: '42',
        amount: '3.50',
        done: 'true',
        at: '2026-10-21T16:00',
        meta: '{"a":1}',
        secret: 'not writable',
      },
    })
    expect(read.problems).toEqual([])
    expect(read.values).toEqual({
      title: 'Hello',
      count: 42,
      amount: '3.50',
      done: true,
      at: '2026-10-21T16:00:00.000Z',
      meta: { a: 1 },
    })
  })

  test('an empty control is left out of a creation', () => {
    const read = readValues({ fields: FIELDS, writable: WRITABLE, form: { count: '', done: '' } })
    expect(read.values).toEqual({})
  })

  test('a value that cannot be converted is a problem, and nothing is sent', () => {
    const read = readValues({
      fields: FIELDS,
      writable: WRITABLE,
      form: { count: '4.2', amount: 'ten', meta: '[', at: 'yesterday' },
    })
    expect(read.problems.map((problem) => problem.field).sort()).toEqual([
      'amount',
      'at',
      'count',
      'meta',
    ])
  })

  test('an update carries what changed, and clears what may be cleared', () => {
    const read = readValues({
      fields: FIELDS,
      writable: WRITABLE,
      form: { title: 'Hello', count: '', amount: '3.50', done: 'false' },
      original: { id: 'r', version: 1, title: 'Hello', count: 7, amount: '3.50', done: true },
    })
    expect(read.values).toEqual({ count: null, done: false })
  })
})

describe('the query of a list', () => {
  test('the url is the state of the page', () => {
    const query = readPageQuery(
      new URLSearchParams({
        q: 'launch',
        filter: '{"status":{"_eq":"draft"}}',
        sort: '-title',
        limit: '50',
      })
    )
    expect(query.problem).toBeNull()
    expect(query.list).toEqual({
      limit: 50,
      search: 'launch',
      filter: { status: { _eq: 'draft' } },
      sort: ['-title'],
    })
    expect(pageUrl('/c', query, { cursor: 'abc' })).toBe(
      '/c?q=launch&filter=%7B%22status%22%3A%7B%22_eq%22%3A%22draft%22%7D%7D&sort=-title&limit=50&cursor=abc'
    )
  })

  test('a filter that is not json is named, and not sent', () => {
    const query = readPageQuery(new URLSearchParams({ filter: '{nope' }))
    expect(query.problem).toBe('the filter is not json')
    expect(query.list.filter).toBeUndefined()
  })

  test('a size of a page out of bounds is the default', () => {
    expect(readPageQuery(new URLSearchParams({ limit: '1000' })).limit).toBe(25)
  })

  test('a column sorts up, then down, then not', () => {
    const none = readPageQuery(new URLSearchParams())
    expect(nextSortOf(none, 'title')).toBe('title')
    expect(nextSortOf(readPageQuery(new URLSearchParams({ sort: 'title' })), 'title')).toBe(
      '-title'
    )
    expect(nextSortOf(readPageQuery(new URLSearchParams({ sort: '-title' })), 'title')).toBe('')
  })
})
