import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import { parseRenderers } from '@platform/vocabulary'
import { Value } from '../src/fields/renderers/renderers.tsx'
import { field } from './renderers-helpers.tsx'

/**
 * A value drawn, and a number drawn.
 */

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
