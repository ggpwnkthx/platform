/**
 * The permissions the console knows the meaning of, and what a right
 * opens where it holds.
 *
 * The console reads its own keys about the tenant itself, on its own
 * route, and Data reads its keys about a workspace. A right that holds
 * where its key is never read opens nothing, and Access accepts it
 * without a word: the test holds what the console says before the
 * operator grants it.
 */

import { describe, expect, test } from 'bun:test'
import {
  CONSOLE_KEYS,
  DATA_KEYS,
  effectOf,
  familyOf,
  isPlatformKey,
  KNOWN_PERMISSIONS,
  knownPermission,
  whereOf,
} from '../src/domains/operators'

const WS = '11111111-1111-4111-8111-111111111111'
const ADMIN = [
  'console.admin',
  'console.status',
  'data.audit.read',
  'data.model.read',
  'data.model.write',
  'data.workspace.create',
]

describe('the permissions the console knows', () => {
  test('it knows the keys of the console and the keys Data fixes in its code', () => {
    expect(KNOWN_PERMISSIONS.map((permission) => permission.key).sort()).toEqual(
      [...Object.values(CONSOLE_KEYS), ...Object.values(DATA_KEYS)].sort()
    )
  })

  test("a capability of the platform is marked as the platform's", () => {
    for (const permission of KNOWN_PERMISSIONS) {
      expect(permission.platform).toBe(isPlatformKey(permission.key))
    }
    expect(knownPermission('console.platform')?.platform).toBe(true)
  })

  test('a key of the deployment is not one of them', () => {
    expect(knownPermission('content.read')).toBeNull()
    expect(knownPermission('console.admin')?.reach).toBe('tenant')
    expect(knownPermission('data.model.write')?.reach).toBe('workspace')
  })

  test('the family of a key is what comes before its first dot', () => {
    expect(familyOf('content.read')).toBe('content')
    expect(familyOf('data.model.write')).toBe('data')
    expect(familyOf('superuser')).toBe('superuser')
  })
})

describe('where a right holds', () => {
  test('no workspace is every workspace, the slug of the tenant is the tenant itself', () => {
    expect(whereOf(null, 'acme')).toBe('all')
    expect(whereOf('acme', 'acme')).toBe('tenant')
    expect(whereOf(WS, 'acme')).toBe('one')
  })
})

describe('what a right opens where it holds', () => {
  const keysOf = (effect: ReturnType<typeof effectOf>) => ({
    opens: effect.opens.map((entry) => entry.key),
    inert: effect.inert.flatMap((entry) => entry.keys),
  })

  test('on the tenant itself, the keys of the console open and the keys of a workspace do not', () => {
    const effect = effectOf(ADMIN, { where: 'tenant', routeId: null }, 'console')
    expect(keysOf(effect)).toEqual({
      opens: ['console.admin', 'console.status', 'data.workspace.create'],
      inert: ['data.audit.read', 'data.model.read', 'data.model.write'],
    })
    // One sentence for one reason, whatever the number of keys it names.
    expect(effect.inert.map((entry) => entry.why)).toEqual([
      'data.audit.read, data.model.read and data.model.write are read on a workspace: on the tenant itself they open nothing.',
    ])
  })

  test('on one workspace, it is the other way round', () => {
    const effect = effectOf(ADMIN, { where: 'one', routeId: null }, 'console')
    expect(keysOf(effect)).toEqual({
      opens: ['data.audit.read', 'data.model.read', 'data.model.write'],
      inert: ['console.admin', 'console.status', 'data.workspace.create'],
    })
    expect(effect.inert.map((entry) => entry.why)).toEqual([
      'console.admin, console.status and data.workspace.create are read on the tenant itself: on one workspace they open nothing.',
    ])
  })

  test('on every workspace, every key opens what it opens', () => {
    const effect = effectOf(ADMIN, { where: 'all', routeId: null }, 'console')
    expect(effect.inert).toEqual([])
    expect(effect.opens).toHaveLength(6)
  })

  test('a key of the console opens nothing on another route', () => {
    const effect = effectOf(['console.admin'], { where: 'tenant', routeId: 'data-api' }, 'console')
    expect(effect.opens).toEqual([])
    expect(effect.inert[0]?.why).toBe(
      'console.admin is read on the route console: on the route data-api it opens nothing.'
    )
    const onItsRoute = effectOf(
      ['console.admin'],
      { where: 'tenant', routeId: 'console' },
      'console'
    )
    expect(onItsRoute.inert).toEqual([])
  })

  test('a key of Data opens nothing on the route of the console', () => {
    const effect = effectOf(['data.model.read'], { where: 'one', routeId: 'console' }, 'console')
    expect(effect.inert.map((entry) => entry.keys)).toEqual([['data.model.read']])
    const onData = effectOf(['data.model.read'], { where: 'one', routeId: 'data-api' }, 'console')
    expect(onData.inert).toEqual([])
  })

  test('the creation of a workspace is read on two routes: a right limited to one opens nothing', () => {
    for (const routeId of ['console', 'data-api']) {
      const effect = effectOf(['data.workspace.create'], { where: 'tenant', routeId }, 'console')
      expect(effect.opens).toEqual([])
      expect(effect.inert[0]?.why).toContain('limited to one route')
    }
  })

  test('two reasons are two sentences, each naming its keys', () => {
    const effect = effectOf(ADMIN, { where: 'tenant', routeId: 'data-api' }, 'console')
    expect(effect.opens).toEqual([])
    expect(effect.inert.map((entry) => entry.keys)).toEqual([
      ['console.admin', 'console.status'],
      ['data.audit.read', 'data.model.read', 'data.model.write'],
      ['data.workspace.create'],
    ])
    expect(effect.inert[0]?.why).toBe(
      'console.admin and console.status are read on the route console: on the route data-api they open nothing.'
    )
  })

  test('the keys of the deployment are counted, and nothing is said of them', () => {
    const effect = effectOf(
      ['content.read', 'content.write', 'content.read', 'console.status'],
      { where: 'all', routeId: null },
      'console'
    )
    expect(effect.others).toBe(2)
    expect(effect.opens.map((entry) => entry.key)).toEqual(['console.status'])
  })
})
