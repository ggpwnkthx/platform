import { describe, expect, test } from 'bun:test'
import { draftOf } from '../src/access/policies/draft.ts'
import { rowSecurityWords } from '../src/access/policies/card.tsx'
import { articles, policy } from './access-helpers.tsx'

/**
 * A policy as the editor starts from it.
 */

describe('A policy as the editor starts from it', () => {
  test('is the database’s own record, with everyone written as no role at all', () => {
    expect(draftOf(policy)).toEqual({
      schema: 'newsroom',
      table: 'articles',
      name: 'published',
      permissive: true,
      command: 'SELECT',
      roles: ['reader'],
      using: "(status = 'published'::text)",
      check: '',
    })
    expect(draftOf({ ...policy, roles: ['public'] }).roles).toEqual([])
  })

  test('row security is said as what it does to the collection', () => {
    expect(rowSecurityWords(articles, 0)).toContain('nobody but the owner')
    expect(rowSecurityWords({ ...articles, rls: false }, 2)).toContain(
      '2 policies below are not applied'
    )
    expect(rowSecurityWords({ ...articles, rls: false }, 1)).toContain(
      '1 policy below is not applied'
    )
  })
})
