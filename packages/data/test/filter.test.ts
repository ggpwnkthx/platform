import { describe, expect, test } from 'bun:test'
import { conditionClause, likePattern, parseFilter, predicate } from '../src/index.ts'

describe('The filter of a record query', () => {
  test('a plain value is an equality', () => {
    const filter = parseFilter({ status: 'draft' })
    expect(filter).toEqual({ status: { op: 'eq', value: 'draft' } })
  })

  test('a condition may name its operator', () => {
    const filter = parseFilter({ views: { op: 'gte', value: 10 } })
    expect(filter).toEqual({ views: { op: 'gte', value: 10 } })
  })

  test('an unknown operator is refused rather than guessed at', () => {
    expect(() => parseFilter({ status: { op: 'like', value: 'x' } })).toThrow(
      'Unknown filter operator: like'
    )
  })
})

describe('The clause of one condition', () => {
  const quoted = (column: string) => `"${column}"`

  test('an equality binds its value', () => {
    const clause = conditionClause(quoted('status'), { op: 'eq', value: 'draft' })
    expect(clause.sql).toBe('"status" IS NOT DISTINCT FROM $1')
    expect(clause.values).toEqual(['draft'])
  })

  test('a text operator matches case-insensitively and escapes the wildcards', () => {
    const clause = conditionClause(quoted('title'), { op: 'contains', value: 'a%b_c' })
    expect(clause.sql).toContain('ILIKE')
    expect(clause.values).toEqual(['%a\\%b\\_c%'])
  })

  test('the pattern of a text operator is the one it promises', () => {
    expect(likePattern('contains', 'x')).toBe('%x%')
    expect(likePattern('starts_with', 'x')).toBe('x%')
    expect(likePattern('ends_with', 'x')).toBe('%x')
  })

  test('a comparison binds its value', () => {
    expect(conditionClause(quoted('views'), { op: 'gte', value: 10 }).sql).toBe('"views" >= $1')
    expect(conditionClause(quoted('views'), { op: 'lt', value: 10 }).sql).toBe('"views" < $1')
  })

  test('a list binds one value per element', () => {
    const clause = conditionClause(quoted('status'), { op: 'in', value: ['a', 'b'] })
    expect(clause.sql).toBe('"status" IN ($1, $2)')
    expect(clause.values).toEqual(['a', 'b'])
  })

  test('an empty list matches everything rather than nothing', () => {
    expect(conditionClause(quoted('status'), { op: 'in', value: [] }).sql).toBe('TRUE')
  })

  test('an empty check needs no value', () => {
    expect(conditionClause(quoted('status'), { op: 'is_null', value: null }).values).toEqual([])
    expect(conditionClause(quoted('status'), { op: 'not_null', value: null }).sql).toBe(
      '"status" IS NOT NULL'
    )
  })
})

describe('The predicate of a whole query', () => {
  test('no filter and no search is no predicate', () => {
    const where = predicate({}, '', ['title'])
    expect(where.sql).toBe('')
    expect(where.values).toEqual([])
  })

  test('the conditions are joined and their values numbered in order', () => {
    const where = predicate(
      { status: { op: 'eq', value: 'draft' }, views: { op: 'gte', value: 10 } },
      '',
      ['title']
    )
    expect(where.sql).toBe('WHERE "status" IS NOT DISTINCT FROM $1 AND "views" >= $2')
    expect(where.values).toEqual(['draft', 10])
  })

  test('the search reads every column the reader may see', () => {
    const where = predicate({}, 'north', ['title', 'body'])
    expect(where.sql).toBe(
      'WHERE (CAST("title" AS TEXT) ILIKE $1 ESCAPE \'\\\' OR CAST("body" AS TEXT) ILIKE $1 ESCAPE \'\\\')'
    )
    expect(where.values).toEqual(['%north%'])
  })

  test('a search without a column to read is no search', () => {
    expect(predicate({}, 'north', []).sql).toBe('')
  })
})
