import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import type { ColumnInfo } from '../src/catalog/types.ts'
import {
  type FieldRenderers,
  indexRenderers,
  noRenderers,
  parseRenderers,
  renderersEqual,
  renderersOf,
  renderersValue,
  validRendererName,
} from '../src/metadata/renderers.ts'
import {
  Value,
  appliesTo,
  knownRenderers,
  registerRenderer,
  rendererNamed,
  renderersFor,
  resolveRenderer,
} from '../src/fields/renderers.tsx'
import { describeField } from '../src/fields/resolve.ts'

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

describe('The renderers the platform holds', () => {
  test('there is a renderer that draws every value', () => {
    const fallback = resolveRenderer('text', 'list', undefined)
    expect(fallback.name).toBe('default')
  })

  test('the renderer a field names is the one that draws its values', () => {
    const renderers = parseRenderers({ list: 'truncate' })
    expect(resolveRenderer('text', 'list', renderers).name).toBe('truncate')
    // The saying is of one situation: the record is drawn as the platform draws it.
    expect(resolveRenderer('text', 'record', renderers).name).toBe('default')
  })

  test('a renderer that does not exist draws nothing', () => {
    const renderers = parseRenderers({ list: 'no-such-renderer' })
    expect(resolveRenderer('text', 'list', renderers).name).toBe('default')
  })

  test('a renderer that does not fit the kind of value draws nothing', () => {
    const renderers = parseRenderers({ list: 'bar' })
    // A bar is of a number: a text is drawn as the platform draws it.
    expect(resolveRenderer('text', 'list', renderers).name).toBe('default')
    expect(resolveRenderer('number', 'list', renderers).name).toBe('bar')
  })

  test('the renderers offered are the ones that fit the kind of value', () => {
    const numbers = renderersFor('number', 'list').map((one) => one.name)
    expect(numbers).toContain('bar')
    expect(numbers).not.toContain('json')
    const texts = renderersFor('text', 'list').map((one) => one.name)
    expect(texts).toContain('link')
    expect(texts).not.toContain('bar')
  })

  test('a renderer of the installation’s own may be added', () => {
    registerRenderer({
      name: 'shout',
      label: 'In capitals',
      kinds: ['text'],
      situations: [],
      render: () => null,
    })
    expect(rendererNamed('shout')).not.toBeNull()
    expect(knownRenderers().map((one) => one.name)).toContain('shout')
    const renderers = parseRenderers({ list: 'shout' })
    expect(resolveRenderer('text', 'list', renderers).name).toBe('shout')
  })

  test('a renderer draws only where it may', () => {
    const paragraph = rendererNamed('paragraph')!
    expect(appliesTo(paragraph, 'text', 'record')).toBe(true)
    // A paragraph is of a value that has paragraphs: not of a number.
    expect(appliesTo(paragraph, 'number', 'record')).toBe(false)
  })
})

/** A column of the kind a test needs. */
function column(type: string, name = 'value'): ColumnInfo {
  return {
    schema: 'newsroom',
    table: 'articles',
    name,
    position: 1,
    type,
    required: false,
    default: null,
    comment: null,
    generated: null,
    identity: null,
    can_select: true,
    can_insert: true,
    can_update: true,
  }
}

/** A field of the kind a test needs, and what it says of how its values are drawn. */
const field = (type: string, renderers?: FieldRenderers) =>
  describeField(column(type), { renderers })

describe('A value, drawn', () => {
  test('a uuid is eight characters in the grid and whole in the record', () => {
    const uuid = '0d1f2e3c-4b5a-6978-8796-a5b4c3d2e1f0'
    const inList = render(<Value value={uuid} field={field('uuid')} situation="list" />)
    const inRecord = render(<Value value={uuid} field={field('uuid')} situation="record" />)
    expect(inList).toContain('>0d1f2e3c<')
    expect(inRecord).toContain(uuid)
  })

  test('a moment is shortened to the minute in the grid and whole in the record', () => {
    const moment = '2026-11-18 16:42:07+00'
    const inList = render(
      <Value value={moment} field={field('timestamp with time zone')} situation="list" />
    )
    const inRecord = render(
      <Value value={moment} field={field('timestamp with time zone')} situation="record" />
    )
    expect(inList).toContain('2026-11-18 16:42')
    expect(inList).not.toContain('16:42:07')
    expect(inRecord).toContain('2026-11-18 16:42:07+00')
  })

  test('a document is a line in the grid and a document in the record', () => {
    const document = { title: 'A headline', tags: ['one', 'two'] }
    const inList = render(<Value value={document} field={field('jsonb')} situation="list" />)
    const inRecord = render(<Value value={document} field={field('jsonb')} situation="record" />)
    expect(inList).not.toContain('\n')
    expect(inRecord).toContain('&quot;title&quot;')
    expect(inRecord).toContain('one')
  })

  test('a null is drawn as null, whatever the saying', () => {
    const html = render(
      <Value
        value={null}
        field={field('text', parseRenderers({ list: 'truncate' }))}
        situation="list"
      />
    )
    expect(html).toContain('null')
  })

  test('a number is written in digits in the grid and marked in the record', () => {
    const inList = render(<Value value={1234567} field={field('integer')} situation="list" />)
    const inRecord = render(<Value value={1234567} field={field('integer')} situation="record" />)
    expect(inList).toContain('1234567')
    expect(inRecord).toContain('1,234,567')
  })

  test('the renderer the field names is the one that draws the value', () => {
    const html = render(
      <Value
        value={'A headline that runs on'}
        field={field(
          'text',
          parseRenderers({ list: { renderer: 'truncate', options: { length: 8 } } })
        )}
        situation="list"
      />
    )
    expect(html).toContain('A headli…')
    // The whole of it is in the hint, so the reader may read it without opening the record.
    expect(html).toContain('title="A headline that runs on"')
  })

  test('a link is drawn as a link', () => {
    const html = render(
      <Value
        value="example.com/story"
        field={field(
          'text',
          parseRenderers({
            record: { renderer: 'link', options: { href: 'https://news.example.com/{value}' } },
          })
        )}
        situation="record"
      />
    )
    expect(html).toContain('href="https://news.example.com/example.com%2Fstory"')
  })

  test('a link the browser may not follow is drawn as text', () => {
    const html = render(
      <Value
        value="story"
        field={field(
          'text',
          parseRenderers({
            record: { renderer: 'link', options: { href: 'javascript:alert(1)' } },
          })
        )}
        situation="record"
      />
    )
    expect(html).not.toContain('href=')
    expect(html).toContain('story')
  })

  test('a value the renderer does not fit is drawn as the platform draws it', () => {
    const html = render(
      <Value
        value="a headline"
        field={field('text', parseRenderers({ list: 'bar' }))}
        situation="list"
      />
    )
    expect(html).toContain('a headline')
    expect(html).not.toContain('value-bar')
  })
})

describe('A number, drawn', () => {
  test('a decimal keeps its places', () => {
    const html = render(<Value value="12.50" field={field('numeric')} situation="record" />)
    expect(html).toContain('12.50')
  })

  test('a large number is marked, and a small one is left alone', () => {
    expect(render(<Value value="1234567" field={field('integer')} situation="record" />)).toContain(
      '1,234,567'
    )
    expect(render(<Value value="42" field={field('integer')} situation="record" />)).toContain('42')
  })
})
