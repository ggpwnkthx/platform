import { describe, expect, test } from 'bun:test'
import {
  columnSql,
  constraintName,
  defaultLiteral,
  fieldRenderersStatement,
  fieldTarget,
  fieldsViewsStatement,
  fieldViewsStatement,
  ident,
  InvalidName,
  literal,
  qualified,
  role,
  systemFields,
  typeSql,
} from '../src/index.ts'

describe('the SQL the platform writes', () => {
  test('quotes identifiers without treating names as SQL', () => {
    expect(ident('a"; DROP TABLE x;--')).toBe('"a""; DROP TABLE x;--"')
    expect(() => ident('a\0b')).toThrow()
    expect(() => ident('é'.repeat(32))).toThrow()
    expect(() => ident('')).toThrow()
  })
  test('names a schema, a table and a role', () => {
    expect(qualified('newsroom', 'articles')).toBe('"newsroom"."articles"')
    expect(role('alice@example.com')).toBe('"alice@example.com"')
  })
  test('DDL literals handle quotes and backslashes', () => {
    expect(literal("a\\'; DROP TABLE x;--")).toBe("E'a\\\\''; DROP TABLE x;--'")
    expect(literal({ a: 1 })).toBe(`E'{"a":1}'`)
    expect(literal(42)).toBe('42')
    expect(literal(true)).toBe('TRUE')
    expect(literal(null)).toBe('NULL')
    expect(() => literal('\0')).toThrow()
  })
  test('a default is read as its column’s type', () => {
    expect(defaultLiteral('integer', '42', 'count')).toBe('42')
    expect(defaultLiteral('boolean', 'true', 'active')).toBe('TRUE')
    expect(defaultLiteral('text', 'draft', 'status')).toBe("E'draft'")
    expect(() => defaultLiteral('integer', 'many', 'count')).toThrow(InvalidName)
    expect(() => defaultLiteral('boolean', 'yes', 'active')).toThrow(InvalidName)
    expect(defaultLiteral('text', '', 'note')).toBe('')
  })
  test('a column carries its type, its constraints and its checks', () => {
    expect(columnSql({ name: 'title', type: 'text' })).toBe('"title" text')
    expect(
      columnSql({
        name: 'title',
        type: 'text',
        required: true,
        unique: true,
        default: "E'draft'",
        maxLength: 120,
        choices: ['draft', 'published'],
        min: 1,
        max: 9,
      })
    ).toBe(
      `"title" text DEFAULT E'draft' NOT NULL UNIQUE CHECK (char_length("title") <= 120) ` +
        `CHECK ("title" IN (E'draft', E'published')) CHECK ("title" >= 1) CHECK ("title" <= 9)`
    )
  })
  test('a relation’s column is a uuid', () => {
    expect(columnSql({ name: 'author', type: 'uuid' })).toBe('"author" uuid')
  })
  test('a type of the database is written as a name, qualified with its schema', () => {
    expect(typeSql('text')).toBe('text')
    expect(typeSql('public.geometry')).toBe('"public"."geometry"')
    expect(typeSql('geometry')).toBe('"geometry"')
    expect(columnSql({ name: 'shape', type: 'public.geometry' })).toBe(
      '"shape" "public"."geometry"'
    )
  })
  test('a type carries the modifiers it takes', () => {
    expect(typeSql('public.geometry', ['Point', '4326'])).toBe('"public"."geometry"("Point", 4326)')
    expect(
      columnSql({ name: 'shape', type: 'public.geometry', modifiers: ['Point', '4326'] })
    ).toBe('"shape" "public"."geometry"("Point", 4326)')
    expect(columnSql({ name: 'name', type: 'character varying', modifiers: ['255'] })).toBe(
      '"name" "character varying"(255)'
    )
  })
  test('a type of the database is given a default as a literal', () => {
    expect(defaultLiteral('public.geometry', 'POINT(0 0)', 'shape')).toBe("E'POINT(0 0)'")
  })
  test('every field is given its own views', () => {
    const statement = fieldViewsStatement(fieldTarget('newsroom', 'articles', 'title'))
    expect(statement).toContain(`'field'`)
    expect(statement).toContain(`'views'`)
    expect(statement).toContain('"list"')
    expect(statement).toContain('"record"')
    expect(statement).toContain('"filter"')
  })
  test('a view of the owner’s own is laid over the default', () => {
    const statement = fieldViewsStatement(fieldTarget('newsroom', 'articles', 'title'), {
      export: 'hide',
    })
    expect(statement).toContain('"list":"show"')
    expect(statement).toContain('"export":"hide"')
  })
  test('a mode the platform does not know is refused', () => {
    expect(() =>
      fieldViewsStatement(fieldTarget('newsroom', 'articles', 'title'), { export: 'perhaps' })
    ).toThrow(InvalidName)
  })
  test('several fields are given their views in one statement', () => {
    const statement = fieldsViewsStatement([
      fieldTarget('newsroom', 'articles', 'id'),
      fieldTarget('newsroom', 'articles', 'title'),
    ])
    expect(statement.split('\n').filter((line) => line.trim().startsWith('('))).toHaveLength(2)
    expect(statement).toContain('ON CONFLICT')
  })
  test('a field may say how its values are drawn', () => {
    const statement = fieldRenderersStatement(fieldTarget('newsroom', 'articles', 'title'), {
      list: 'truncate',
      record: { renderer: 'template', options: { template: '» {value}' } },
    })
    expect(statement).toContain(`'renderers'`)
    expect(statement).toContain('"list":"truncate"')
    expect(statement).toContain('"record":{"renderer":"template"')
  })
  test('a field that says nothing of its drawing is drawn as the platform draws it', () => {
    const statement = fieldRenderersStatement(fieldTarget('newsroom', 'articles', 'title'))
    expect(statement).toContain(`'renderers'`)
    expect(statement).toContain('{}')
  })
  test('the columns every collection is made with are named once', () => {
    expect(systemFields).toContain('created_by')
    expect(systemFields).toHaveLength(6)
  })
  test('a relation’s constraint carries the same name wherever it is built', async () => {
    const name = await constraintName('articles', 'author')
    expect(name).toMatch(/^fk_[0-9a-f]{24}$/)
    expect(await constraintName('articles', 'author')).toBe(name)
    expect(await constraintName('articles', 'editor')).not.toBe(name)
  })
})
