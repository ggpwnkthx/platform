import { describe, expect, test } from 'bun:test'
import { fieldTypeNamed } from '../src/fields/registry.ts'
import { fieldTypeFor } from '../src/fields/registry.ts'
import { registerFieldType } from '../src/fields/registry.ts'
import { describeField } from '../src/fields/resolve.ts'
import { resolveFields } from '../src/fields/resolve.ts'
import { column, relation, catalog, fields, named } from './fields-helpers.tsx'

/**
 * The fields of a collection, and the type of a field.
 */

describe('The fields of a collection', () => {
  test('every column of the collection is a field, in the database’s own order', () => {
    expect(fields.map((field) => field.name)).toEqual([
      'id',
      'title',
      'status',
      'author',
      'words',
      'search',
      'updated_at',
    ])
  })

  test('a field is read by the name its owner gave it, or by its own', () => {
    expect(named('title').label).toBe('Headline')
    expect(named('title').named).toBe(true)
    expect(named('words').label).toBe('words')
    expect(named('words').named).toBe(false)
  })

  test('a field carries what it says of itself, and the default where it says nothing', () => {
    expect(named('title').views.record).toBe('readonly')
    expect(named('title').hasViews).toBe(true)
    expect(named('title').renderers.list).toEqual({ renderer: 'truncate', options: {} })
    expect(named('words').views).toEqual({ list: 'show', record: 'show', filter: 'show' })
    expect(named('words').hasViews).toBe(false)
    expect(named('words').renderers).toEqual({})
  })

  test('a field knows what the database says of its column', () => {
    expect(named('status').choices).toEqual(['draft', 'published'])
    expect(named('author').relation?.target_table).toBe('authors')
    expect(named('search').computed).toBe(true)
    expect(named('updated_at').system).toBe(true)
    expect(named('title').system).toBe(false)
  })

  test('before its metadata is read, a field is what it is without a saying', () => {
    const bare = resolveFields(catalog, 'newsroom', 'articles')
    expect(bare.find((field) => field.name === 'title')?.label).toBe('title')
    expect(bare.every((field) => !field.hasViews)).toBe(true)
  })
})

describe('The type of a field', () => {
  test('the kind of value a column holds says what type of field it is', () => {
    expect(named('title').type.name).toBe('text')
    expect(named('words').type.name).toBe('integer')
    expect(named('id').type.name).toBe('uuid')
    expect(named('updated_at').type.name).toBe('moment')
    expect(describeField(column('jsonb')).type.name).toBe('json')
    expect(describeField(column('numeric(10,2)')).type.name).toBe('number')
    expect(describeField(column('boolean')).type.name).toBe('boolean')
  })

  test('a column chosen from a list is a choice, and one that points at a row is a relation', () => {
    expect(named('status').type.name).toBe('choice')
    // A foreign key is a uuid, and it is a relation before it is a uuid.
    expect(named('author').type.name).toBe('relation')
  })

  test('a type the platform has no drawing for is still a field', () => {
    expect(named('search').type.name).toBe('other')
  })

  test('a type of the installation’s own takes the columns it claims', () => {
    registerFieldType({
      ...fieldTypeNamed('text')!,
      name: 'email',
      label: 'Email address',
      claims: (facts) => (facts.column.type === 'public.email' ? 15 : 0),
    })
    const facts = { relation: null, choices: null }
    expect(fieldTypeFor({ ...facts, column: column('public.email'), kind: 'other' }).name).toBe(
      'email'
    )
    // It claims nothing else: a text is still a text.
    expect(fieldTypeFor({ ...facts, column: column('text'), kind: 'text' }).name).toBe('text')
    // And a stronger claim still wins: a relation is a relation, whatever its type.
    expect(
      fieldTypeFor({ column: column('public.email'), kind: 'other', relation, choices: null }).name
    ).toBe('relation')
  })
})
