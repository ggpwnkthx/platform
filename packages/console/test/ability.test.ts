/**
 * The ability of the caller.
 *
 * The ability is the drawing of what the services answered: the scope
 * of the operator for the console, and the metadata of the data service
 * for a collection. The test holds the two rules that matter: the
 * console holds no wildcard, and the ability never allows less than
 * the services allow.
 */

import { describe, expect, test } from 'bun:test'
import {
  administersOwnTenant,
  abilityFor,
  collectionAbility,
  CONSOLE_ACTIONS,
  CONSOLE_SUBJECT,
  consoleAbility,
} from '../src/domains/ability'
import type { CollectionMetadata } from '../src/domains/data'
import { scopeOf } from '../src/domains/operators'

const credentials = {
  platform: 'the-platform-token-0001',
  tenants: { acme: 'the-acme-token-00001' },
}

const collection = (extra: Partial<CollectionMetadata> = {}): CollectionMetadata => ({
  key: 'posts',
  label: 'Posts',
  schemaVersion: '1',
  actions: ['read'],
  readableFields: ['id', 'title'],
  writableFields: [],
  filterableFields: ['id', 'title'],
  fields: [],
  relations: [],
  ...extra,
})

describe('the ability of the console', () => {
  test('a caller who holds nothing may do nothing', () => {
    const ability = consoleAbility(scopeOf('acme', [], credentials))
    expect(ability.can(CONSOLE_ACTIONS.status, CONSOLE_SUBJECT)).toBe(false)
    expect(ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toBe(false)
    expect(ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)).toBe(false)
  })

  test('an operator of a tenant administers its own tenant and not the platform', () => {
    const ability = consoleAbility(scopeOf('acme', ['console.admin'], credentials))
    expect(ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toBe(true)
    expect(ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)).toBe(false)
    expect(administersOwnTenant(ability)).toBe(true)
  })

  test('an operator of the platform administers every tenant', () => {
    const ability = consoleAbility(scopeOf('acme', ['console.platform'], credentials))
    expect(ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toBe(true)
    expect(ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)).toBe(true)
    expect(administersOwnTenant(ability)).toBe(false)
  })

  test('the status of the services is its own right', () => {
    const ability = consoleAbility(scopeOf('acme', ['console.status'], credentials))
    expect(ability.can(CONSOLE_ACTIONS.status, CONSOLE_SUBJECT)).toBe(true)
    expect(ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toBe(false)
  })

  test('the rules of the console and the rules of a collection live together', () => {
    const ability = abilityFor(
      scopeOf('acme', ['console.admin'], credentials),
      collection({ actions: ['read', 'create'], writableFields: ['title'] })
    )
    expect(ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toBe(true)
    expect(ability.can('read', 'posts')).toBe(true)
    expect(ability.can('create', 'posts')).toBe(true)
    expect(ability.can('delete', 'posts')).toBe(false)
  })
})

describe('the ability of a collection', () => {
  test('the actions of the metadata are the actions of the ability', () => {
    const ability = collectionAbility(
      collection({ actions: ['read', 'create', 'update', 'delete'] })
    )
    expect(ability.can('read', 'posts')).toBe(true)
    expect(ability.can('create', 'posts')).toBe(true)
    expect(ability.can('update', 'posts')).toBe(true)
    expect(ability.can('delete', 'posts')).toBe(true)
  })

  test('an action the metadata does not name is refused', () => {
    const ability = collectionAbility(collection({ actions: ['read'] }))
    expect(ability.can('read', 'posts')).toBe(true)
    expect(ability.can('create', 'posts')).toBe(false)
    expect(ability.can('update', 'posts')).toBe(false)
    expect(ability.can('delete', 'posts')).toBe(false)
  })

  test('a field the metadata does not name is refused', () => {
    const ability = collectionAbility(collection({ actions: ['read'] }))
    expect(ability.can('read', 'posts', 'id')).toBe(true)
    expect(ability.can('read', 'posts', 'title')).toBe(true)
    expect(ability.can('read', 'posts', 'secret')).toBe(false)
  })

  test('a collection that grants no field grants no field', () => {
    const ability = collectionAbility(
      collection({ actions: ['read'], readableFields: [], writableFields: [] })
    )
    expect(ability.can('read', 'posts')).toBe(true)
    expect(ability.can('read', 'posts', 'title')).toBe(false)
  })

  test('another collection is a different subject', () => {
    const ability = collectionAbility(collection({ actions: ['read'] }))
    expect(ability.can('read', 'posts')).toBe(true)
    expect(ability.can('read', 'comments')).toBe(false)
  })

  test('the console holds no wildcard: an action of the library matches nothing', () => {
    const ability = collectionAbility(collection({ actions: ['read'] }))
    // `manage` is the action of the library that matches every action.
    // No rule of the console carries it, and no rule carries a subject
    // of `all`.
    expect(ability.can('manage', 'posts')).toBe(false)
    expect(ability.can('read', 'all')).toBe(false)
  })
})
