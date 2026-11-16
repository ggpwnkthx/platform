/**
 * The permissions of a tenant, described once.
 *
 * Every page that shows a permission and every form that chooses one
 * reads the same entry: the test holds what the entry says of a key the
 * console knows, of a capability of the deployment, and of a key nobody
 * describes.
 */

import { describe, expect, test } from 'bun:test'
import type { Grant, Role } from '../src/domains/access'
import {
  capabilitiesOf,
  permissionCatalogOf,
  permissionEntryOf,
  permissionFamiliesOf,
} from '../src/domains/operators'

const role = (key: string, permissions: string[]): Role =>
  ({ key, permissions, roles: [] }) as unknown as Role

const capabilities = capabilitiesOf([
  {
    label: 'Articles',
    permissions: {
      read: ['content.reader', 'content.editor'],
      create: ['content.editor'],
      update: ['content.editor'],
      delete: [],
    },
  },
] as never)

const roles = [
  role('editor', ['content.editor', 'files.write']),
  role('root', ['console.platform']),
]
const context = { roles, capabilities }

describe('the permissions of a tenant', () => {
  test('a key the console knows says what it opens and where it is read', () => {
    expect(permissionEntryOf('console.admin', context)).toEqual({
      key: 'console.admin',
      family: 'console',
      opens: 'Opens the administration of the tenant: users, groups, roles, rights.',
      source: 'console',
      reach: 'tenant',
      platform: false,
      roles: [],
    })
    expect(permissionEntryOf('data.model.read', context)).toMatchObject({
      source: 'data',
      reach: 'workspace',
    })
    expect(permissionEntryOf('console.platform', context)).toMatchObject({
      platform: true,
      roles: ['root'],
    })
  })

  test('a capability of the deployment is said by the collections it opens', () => {
    expect(permissionEntryOf('content.editor', context)).toMatchObject({
      opens: 'Opens the reading of Articles and the writing of Articles.',
      source: 'deployment',
      reach: 'workspace',
      roles: ['editor'],
    })
    // Without the answer of Data, the key is one nobody describes.
    expect(permissionEntryOf('content.editor', { roles })).toMatchObject({
      opens: null,
      source: 'tenant',
      reach: null,
    })
  })

  test('a key of the tenant is described by nobody', () => {
    expect(permissionEntryOf('files.write', context)).toMatchObject({
      family: 'files',
      opens: null,
      source: 'tenant',
      reach: null,
      roles: ['editor'],
    })
  })

  test('the catalog lists what is fixed, what the deployment names and what the tenant wrote', () => {
    const grants = [{ permission: 'files.read' }] as unknown as Grant[]
    const keys = permissionCatalogOf(grants, context).map((entry) => entry.key)
    // A capability no role and no right names yet is listed all the same.
    expect(keys).toContain('content.reader')
    expect(keys).toContain('files.read')
    expect(keys).toContain('files.write')
    expect(keys).toContain('console.admin')
    expect(keys).toEqual([...keys].sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('the entries are grouped by family, in the order of the families', () => {
    const families = permissionFamiliesOf(permissionCatalogOf([], context))
    expect(families.map((family) => family.family)).toEqual(['console', 'content', 'data', 'files'])
    expect(families[1]?.entries.map((entry) => entry.key)).toEqual([
      'content.editor',
      'content.reader',
    ])
  })
})
