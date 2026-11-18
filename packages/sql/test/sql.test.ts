import { describe, expect, test } from 'bun:test'
import {
  columnSql,
  constraintName,
  defaultLiteral,
  ident,
  InvalidName,
  literal,
  qualified,
  role,
  systemFields,
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
