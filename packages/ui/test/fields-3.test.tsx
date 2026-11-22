import { describe, expect, test } from 'bun:test'
import { filterStart } from '../src/fields/edit.ts'
import { filterValue } from '../src/fields/edit.ts'
import { placeholderOf } from '../src/fields/inputs.tsx'
import { knownFieldTypes } from '../src/fields/registry.ts'
import { describeField } from '../src/fields/resolve.ts'
import type { Field } from '../src/fields/field.ts'
import type { InputProps } from '../src/fields/field.ts'
import { column, named } from './fields-helpers.tsx'

/**
 * A field in the filters, and the types the interface holds.
 */

describe('A field, in the filters', () => {
  test('each type offers the operators that make sense for it', () => {
    expect(named('title').type.filter.operators).toContain('contains')
    expect(named('words').type.filter.operators).toContain('gte')
    expect(named('words').type.filter.operators).not.toContain('contains')
    expect(named('status').type.filter.operators).toEqual([
      'eq',
      'neq',
      'in',
      'not_in',
      'is_null',
      'not_null',
    ])
    expect(describeField(column('boolean')).type.filter.operators).toEqual([
      'eq',
      'is_null',
      'not_null',
    ])
  })

  test('a condition starts with a value the type can offer', () => {
    expect(filterStart(named('status'))).toBe('draft')
    // The builder shows true, so true is what it holds.
    expect(filterStart(describeField(column('boolean')))).toBe('true')
    expect(filterStart(named('title'))).toBe('')
  })

  test('a condition carries the value its type reads from what was typed', () => {
    const flag = describeField(column('boolean'))
    expect(filterValue(flag, 'eq', 'true')).toBe(true)
    expect(filterValue(flag, 'eq', 'false')).toBe(false)
    expect(filterValue(named('title'), 'contains', 'news')).toBe('news')
    expect(filterValue(named('status'), 'in', 'draft, published,')).toEqual(['draft', 'published'])
    expect(filterValue(named('title'), 'is_null', 'ignored')).toBeNull()
  })
})

describe('The types the interface holds', () => {
  test('every type it holds is named, and the text type is one of them', () => {
    const names = knownFieldTypes().map((type) => type.name)
    expect(names).toContain('text')
    expect(new Set(names).size).toBe(names.length)
  })

  test('an empty input says what the database will write, or what the type expects', () => {
    const withDefault = {
      ...named('title'),
      column: { ...named('title').column, default: "'draft'::text" },
    }
    const input = (field: Field, creating: boolean): InputProps => ({
      field,
      id: `field-${field.name}`,
      text: '',
      onChange: () => {},
      disabled: false,
      creating,
      wide: false,
    })
    expect(placeholderOf(input(withDefault, true))).toBe('Default: draft')
    // What is stored is not what a new record starts with.
    expect(placeholderOf(input(withDefault, false), 'A title')).toBe('A title')
    expect(placeholderOf(input(named('title'), true), 'A title')).toBe('A title')
  })
})
