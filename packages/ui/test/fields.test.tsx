import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import type { Catalog, ColumnInfo } from '@platform/data'
import { fieldText, fieldValue, filterStart, filterValue, isWide } from '../src/fields/edit.ts'
import { placeholderOf } from '../src/fields/inputs.tsx'
import {
  fieldTypeFor,
  fieldTypeNamed,
  knownFieldTypes,
  registerFieldType,
} from '../src/fields/registry.ts'
import { Value } from '../src/fields/renderers.tsx'
import { describeField, resolveFields } from '../src/fields/resolve.ts'
import type { Field, InputProps } from '../src/fields/types.ts'

/**
 * What a field is. A field's type owns everything the interface does with it — the cell, the
 * value, the input and the filter — and the type follows from what the database says of the
 * column, so no page asks what kind of column it is drawing.
 */

/** A column of the kind a test needs. */
function column(type: string, name = 'value', more: Partial<ColumnInfo> = {}): ColumnInfo {
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
    ...more,
  }
}

const relation = {
  schema: 'newsroom',
  table: 'articles',
  column: 'author',
  target_schema: 'newsroom',
  target_table: 'authors',
  on_delete: 'r',
}

const catalog: Catalog = {
  schemas: [],
  tables: [],
  columns: [
    column('uuid', 'id'),
    column('text', 'title', { required: true }),
    column('text', 'status'),
    column('uuid', 'author'),
    column('integer', 'words'),
    column('tsvector', 'search', { generated: 's' }),
    column('timestamp with time zone', 'updated_at'),
    // Another collection's column of the same name is not this collection's field.
    { ...column('text', 'title'), table: 'authors' },
  ],
  relations: [relation],
  constraints: [
    {
      schema: 'newsroom',
      table: 'articles',
      name: 'articles_status_check',
      type: 'c',
      definition: "CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))",
      columns: ['status'],
    },
  ],
  types: [],
}

const metadata = [
  { column_name: 'title', key: 'display_name', value: ' Headline ' },
  { column_name: 'title', key: 'renderers', value: { list: 'truncate' } },
  { column_name: 'title', key: 'views', value: { list: 'show', record: 'readonly' } },
  { column_name: 'words', key: 'purpose', value: 'How long it is' },
  // A saying about a collection names no column, and is no field's.
  { column_name: null, key: 'display_name', value: 'Articles' },
].map((row) => ({
  scope: 'field' as const,
  schema_name: 'newsroom',
  table_name: 'articles',
  ...row,
}))

const fields = resolveFields(catalog, 'newsroom', 'articles', metadata)
const named = (name: string): Field => fields.find((field) => field.name === name)!

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
