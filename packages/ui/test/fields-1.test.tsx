import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import { Value } from '../src/fields/renderers/renderers.tsx'
import { describeField } from '../src/fields/resolve.ts'
import { column, named } from './fields-helpers.tsx'

/**
 * A field, drawn.
 */

describe('A field, drawn', () => {
  test('a choice is a chip in the grid and the choice itself in the record', () => {
    const inList = render(<Value value="published" field={named('status')} situation="list" />)
    const inRecord = render(<Value value="published" field={named('status')} situation="record" />)
    expect(inList).toContain('class="choice choice-3"')
    expect(inRecord).toContain('value-choice')
  })

  test('a relation is drawn by the name of the row it points at', () => {
    const id = '0d1f2e3c-4b5a-6978-8796-a5b4c3d2e1f0'
    const inList = render(
      <Value value={id} field={named('author')} situation="list" label="Ada Lovelace" />
    )
    expect(inList).toContain('Ada Lovelace')
    expect(inList).toContain(`title="${id}"`)
    const inRecord = render(
      <Value value={id} field={named('author')} situation="record" label="Ada Lovelace" />
    )
    expect(inRecord).toContain('Ada Lovelace')
    expect(inRecord).toContain(id)
  })

  test('a relation the reader may not read by name is drawn by its id', () => {
    const id = '0d1f2e3c-4b5a-6978-8796-a5b4c3d2e1f0'
    const html = render(<Value value={id} field={named('author')} situation="list" />)
    expect(html).toContain('0d1f2e3c…')
  })

  test('a filter is drawn as the record is', () => {
    const html = render(
      <Value value={true} field={describeField(column('boolean'))} situation="filter" />
    )
    expect(html).toContain('Yes')
  })

  test('the renderer a field names draws its values, in the situation it names', () => {
    const long = 'A headline that runs on and on, well past the forty characters kept'
    const inList = render(<Value value={long} field={named('title')} situation="list" />)
    const inRecord = render(<Value value={long} field={named('title')} situation="record" />)
    expect(inList).toContain('…')
    expect(inRecord).not.toContain('…')
  })

  test('numbers are set to the right, and nothing else is', () => {
    expect(named('words').type.numeric).toBe(true)
    expect(named('title').type.numeric).toBeFalsy()
    expect(named('author').type.numeric).toBeFalsy()
  })
})
