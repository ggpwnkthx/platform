import { describe, expect, test } from 'bun:test'
import type { Catalog } from '@platform/core'
import { resolveFields } from '../src/fields/resolve.ts'
import { catalog } from './newsroom-catalog.ts'
import { drawnValue, filterOf } from '../src/content/query.ts'

const fieldsOf = (table: string) => resolveFields(catalog, 'newsroom', table)

describe('the relations of a collection', () => {
  test('a collection holds its columns, and the rows that point at it', () => {
    const fields = fieldsOf('articles')
    const title = fields.find((f) => f.name === 'title')!
    expect(title.column?.type).toBe('text')
    expect(title.virtual).toBe(false)
    // The corrections of an article: rows that point at it.
    const children = fields.find((f) => f.link?.kind === 'children')!
    expect(children.name).toBe('corrections')
    expect(children.virtual).toBe(true)
    expect(children.column).toBe(null)
    expect(children.link?.path).toEqual({
      kind: 'rows',
      schema: 'newsroom',
      table: 'corrections',
      fk: 'article',
      target: 'id',
      target_column: 'id',
      target_schema: 'newsroom',
      target_table: 'corrections',
    })
  })

  test('a collection holds the rows it is linked to, through a join table', () => {
    const links = fieldsOf('articles').find((f) => f.link?.kind === 'links')!
    expect(links.name).toBe('tags')
    expect(links.virtual).toBe(true)
    expect(links.link?.path).toEqual({
      kind: 'rows',
      schema: 'newsroom',
      table: 'article_tags',
      fk: 'article',
      target: 'tag',
      target_column: 'id',
      target_schema: 'newsroom',
      target_table: 'tags',
      payload: [],
    })
    // And the other side of the same join is a link of its own.
    const back = fieldsOf('tags').find((f) => f.link?.kind === 'links')!
    expect(back.name).toBe('articles')
    expect(back.link?.path.fk).toBe('tag')
    expect(back.link?.path.target).toBe('article')
  })

  test('a field type claims the field it fits', () => {
    const fields = fieldsOf('articles')
    expect(fields.find((f) => f.name === 'title')?.type.name).toBe('text')
    expect(fields.find((f) => f.link?.kind === 'links')?.type.name).toBe('links')
    expect(fields.find((f) => f.link?.kind === 'children')?.type.name).toBe('children')
  })

  test('a relation of rows is not in the grid, and is in the form and the filters', () => {
    for (const field of fieldsOf('articles').filter((f) => f.virtual)) {
      expect(field.views.list).toBe('hide')
      expect(field.views.filter).toBe('show')
    }
  })

  test('a join table is a collection like any other', () => {
    const fields = fieldsOf('article_tags')
    expect(fields.find((f) => f.name === 'article')?.relation?.target_table).toBe('articles')
    expect(fields.find((f) => f.name === 'tag')?.relation?.target_table).toBe('tags')
  })

  test('a relation does not take the name of a column', () => {
    const withColumn: Catalog = {
      ...catalog,
      columns: [
        ...catalog.columns,
        {
          ...catalog.columns[0]!,
          table: 'articles',
          name: 'tags',
          position: 9,
          type: 'text',
          identity: null,
        },
      ],
    }
    const fields = resolveFields(withColumn, 'newsroom', 'articles')
    expect(fields.filter((f) => f.name.startsWith('tags'))).toHaveLength(2)
    expect(fields.find((f) => f.name === 'tags')?.column?.type).toBe('text')
    expect(fields.find((f) => f.name === 'tags_2')?.link?.kind).toBe('links')
  })
})

describe('a condition on a relation, as the address carries it', () => {
  const byName = Object.fromEntries(fieldsOf('articles').map((f) => [f.name, f]))

  test('the ids that were picked are the condition', () => {
    const filter = filterOf(new URLSearchParams('f.tags=has_any.one,two'), byName)
    expect(filter.tags).toEqual({ op: 'has_any', value: ['one', 'two'] })
  })

  test('a condition on one row is one id', () => {
    const filter = filterOf(new URLSearchParams('f.tags=eq.one'), byName)
    expect(filter.tags).toEqual({ op: 'eq', value: 'one' })
  })

  test('a condition on a column is left alone', () => {
    const filter = filterOf(new URLSearchParams('f.title=contains.river'), byName)
    expect(filter.title).toEqual({ op: 'contains', value: 'river' })
  })
})

describe('a relation read as rows, as it is drawn', () => {
  const byName = Object.fromEntries(fieldsOf('articles').map((f) => [f.name, f]))
  const links = byName.tags!
  const title = byName.title!

  test('the rows it is linked to are drawn, and not the ids the form holds', () => {
    const rows = [{ id: 'one', label: 'Politics' }]
    const drawn = drawnValue(links, { tags: rows }, { tags: ['one'] })
    expect(drawn).toBe(rows)
  })

  test('a column is drawn as the form holds it', () => {
    expect(drawnValue(title, { tags: [] }, { title: 'A story' })).toBe('A story')
  })

  test('a relation with no rows drawn is drawn as nothing', () => {
    expect(drawnValue(links, {}, { tags: [] })).toEqual([])
  })
})
