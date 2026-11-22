import { describe, expect, test } from 'bun:test'
import {
  alsoHeld,
  granteesOf,
  groupsOf,
  heldBy,
  holdOf,
  reachesMore,
  throughOf,
  wantedOf,
} from '../src/access/model.ts'
import { policyReaches } from '../src/access/policies/draft.ts'
import { sameWanted, toggleField } from '../src/access/grants/wishes.ts'
import { names, grants, member, policy } from './access-helpers.tsx'

/**
 * What an ACL says each role holds, and where a role’s reach comes from.
 */

describe('What an ACL says each role holds', () => {
  test('a privilege is held on the whole collection, on some fields, or not at all', () => {
    const reader = heldBy(grants, 'articles', 'reader')
    expect(holdOf(reader.SELECT)).toBe('some')
    expect(holdOf(reader.UPDATE)).toBe('none')
    expect(wantedOf(reader.SELECT)).toEqual(['id', 'title'])
    const writer = heldBy(grants, 'articles', 'writer')
    expect(holdOf(writer.SELECT)).toBe('all')
    expect(wantedOf(writer.DELETE)).toBe('all')
    expect(alsoHeld(writer)).toEqual(['TRUNCATE'])
  })

  test('the roles a collection names leave its owner out, and put everyone first', () => {
    expect(granteesOf(grants, 'articles', 'editors')).toEqual(['PUBLIC', 'reader', 'writer'])
  })

  test('a field given to a list is added to it, and one taken from the whole leaves the rest', () => {
    expect(toggleField(['id'], 'SELECT', 'title', true, names)).toEqual(['id', 'title'])
    expect(toggleField('none', 'UPDATE', 'title', true, names)).toEqual(['title'])
    expect(toggleField('all', 'SELECT', 'internal_notes', false, names)).toEqual([
      'id',
      'title',
      'status',
    ])
    expect(toggleField(['id'], 'SELECT', 'id', false, names)).toBe('none')
    // The whole collection already covers the field, and DELETE has no fields to speak of.
    expect(toggleField('all', 'SELECT', 'title', true, names)).toBe('all')
    expect(toggleField('all', 'DELETE', 'title', false, names)).toBe('all')
  })

  test('two wishes are the same whatever order their fields are in', () => {
    expect(sameWanted(['id', 'title'], ['title', 'id'])).toBe(true)
    expect(sameWanted(['id'], 'all')).toBe(false)
    expect(sameWanted('none', 'none')).toBe(true)
  })
})
describe('Where a role’s reach comes from', () => {
  const memberships = [
    member('reader', 'alice@example.com'),
    member('desk', 'alice@example.com', false),
    member('writer', 'reader'),
  ]

  test('a role inherits from its groups and theirs, and not through a membership without INHERIT', () => {
    expect(groupsOf('alice@example.com', memberships)).toEqual(['reader', 'writer'])
  })

  test('its reach on a collection comes through the groups the ACL names, and everyone', () => {
    expect(throughOf('alice@example.com', 'articles', grants, memberships)).toEqual([
      'reader',
      'writer',
      'PUBLIC',
    ])
    expect(throughOf('PUBLIC', 'articles', grants, memberships)).toEqual([])
  })

  test('a role reaches more than its own grants when a group gives it more', () => {
    expect(reachesMore('all', 'some')).toBe(true)
    expect(reachesMore('some', 'some')).toBe(false)
  })

  test('a policy applies by name, through a group, or to everyone', () => {
    expect(policyReaches(policy, 'reader', [])).toBe(true)
    expect(policyReaches(policy, 'alice@example.com', ['reader'])).toBe(true)
    expect(policyReaches(policy, 'writer', [])).toBe(false)
    expect(policyReaches({ ...policy, roles: ['public'] }, 'writer', [])).toBe(true)
  })
})
