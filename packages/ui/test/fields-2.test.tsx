import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import { fieldText } from '../src/fields/edit.ts'
import { fieldValue } from '../src/fields/edit.ts'
import { isWide } from '../src/fields/edit.ts'
import { describeField } from '../src/fields/resolve.ts'
import type { Field } from '../src/fields/field.ts'
import { column, named } from './fields-helpers.tsx'

/**
 * A field, in the form.
 */

describe('A field, in the form', () => {
  test('the form holds a value as text, and a document as a document', () => {
    expect(fieldText(named('words'), 42)).toBe('42')
    expect(fieldText(named('title'), null)).toBe('')
    expect(fieldText(describeField(column('jsonb')), { a: 1 })).toBe('{\n  "a": 1\n}')
  })

  test('nothing typed is nothing stored, but a required text may be the empty text', () => {
    expect(fieldValue(named('words'), '')).toEqual({ value: null })
    expect(fieldValue(named('title'), '')).toEqual({ value: '' })
    expect(fieldValue(describeField(column('text')), '')).toEqual({ value: null })
  })

  test('a number that is not one is refused before the database is asked', () => {
    expect(fieldValue(named('words'), ' 12 ')).toEqual({ value: '12' })
    expect(fieldValue(named('words'), '1.5')).toEqual({ error: 'A whole number' })
    const price = describeField(column('numeric'))
    expect(fieldValue(price, '1.5')).toEqual({ value: '1.5' })
    expect(fieldValue(price, 'cheap')).toEqual({ error: 'A number' })
  })

  test('prose is kept as it was typed, and everything else is trimmed', () => {
    expect(fieldValue(named('title'), ' Two spaces ')).toEqual({ value: ' Two spaces ' })
    expect(fieldValue(named('id'), ' 0d1f ')).toEqual({ value: '0d1f' })
    expect(fieldValue(named('search'), ' a:1 ')).toEqual({ value: 'a:1' })
  })

  test('a document is read as JSON, and a yes or no as itself', () => {
    const document = describeField(column('jsonb'))
    expect(fieldValue(document, '{"a":1}')).toEqual({ value: { a: 1 } })
    expect(fieldValue(document, '{a}')).toEqual({ error: 'Not valid JSON' })
    const flag = describeField(column('boolean'))
    expect(fieldValue(flag, 'true')).toEqual({ value: true })
    expect(fieldValue(flag, 'false')).toEqual({ value: false })
  })

  test('a field takes the whole width when it holds more than a line', () => {
    expect(isWide(describeField(column('jsonb')), '')).toBe(true)
    expect(isWide(describeField(column('text', 'summary')), '')).toBe(true)
    expect(isWide(named('title'), 'short')).toBe(false)
    expect(isWide(named('title'), 'x'.repeat(61))).toBe(true)
    // A choice is one of a few words, however long the words are.
    expect(isWide(named('status'), 'x'.repeat(61))).toBe(false)
  })

  test('each type has the input that changes it', () => {
    const input = (field: Field, text = '') => {
      const Input = field.type.Input
      return render(
        <Input
          field={field}
          id="field"
          text={text}
          onChange={() => {}}
          disabled={false}
          creating={false}
          wide={isWide(field, text)}
        />
      )
    }
    expect(input(named('title'))).toContain('<input')
    expect(input(describeField(column('text', 'body')))).toContain('<textarea')
    expect(input(describeField(column('jsonb')))).toContain('<textarea')
    expect(input(describeField(column('date')))).toContain('type="date"')
    expect(input(named('words'))).toContain('inputmode="numeric"')
    const status = input(named('status'), 'draft')
    expect(status).toContain('<select')
    expect(status).toContain('published')
    expect(input(describeField(column('boolean')))).toContain('<select')
  })
})
