/**
 * The ability of the caller.
 *
 * The ability is the drawing of what the services answered: the scope
 * of the operator for the console, and the metadata of Data
 * for a collection. The test holds the two rules that matter: the
 * console holds no wildcard, and the ability never allows less than
 * the services allow.
 */

import { describe, expect, test } from 'bun:test'
import {
  ACTIONS,
  administersOwnTenant,
  abilityFor,
  allowanceOf,
  collectionAbility,
  collectionAccessOf,
  CONSOLE_ACTIONS,
  CONSOLE_SUBJECT,
  consoleAbility,
  consoleCapabilitiesOf,
  permissionOf,
  reasonOf,
  SUBJECTS,
  tenantOf,
  WORKSPACE_PARTS,
  workspaceAbility,
  workspaceCapabilitiesOf,
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

describe('the ability of an operator', () => {
  const nobody = consoleAbility(scopeOf('acme', [], credentials))
  const tenant = consoleAbility(scopeOf('acme', ['console.admin'], credentials))
  const platform = consoleAbility(scopeOf('acme', ['console.platform'], credentials))

  test('an operator of a tenant reaches the tenant of its slug, and no other', () => {
    expect(tenant.can(ACTIONS.administer, tenantOf('acme'))).toBe(true)
    expect(tenant.can(ACTIONS.administer, tenantOf('globex'))).toBe(false)
    expect(reasonOf(tenant, ACTIONS.administer, tenantOf('globex'))).toContain(
      'opens the tenant acme and no other'
    )
    // Asked about tenants as a kind, the answer is whether it reaches one.
    expect(tenant.can(ACTIONS.administer, SUBJECTS.tenant)).toBe(true)
  })

  test('an operator of the platform reaches every tenant', () => {
    expect(platform.can(ACTIONS.administer, tenantOf('acme'))).toBe(true)
    expect(platform.can(ACTIONS.administer, tenantOf('globex'))).toBe(true)
  })

  test('a caller who holds nothing reaches none, and is told which key it needs', () => {
    expect(nobody.can(ACTIONS.administer, SUBJECTS.tenant)).toBe(false)
    expect(nobody.can(ACTIONS.administer, tenantOf('acme'))).toBe(false)
    expect(reasonOf(nobody, ACTIONS.administer, tenantOf('acme'))).toContain('console.admin')
    expect(nobody.can(ACTIONS.give, permissionOf('content.read'))).toBe(false)
  })

  test("what is the platform's is the operator of the platform's: a tenant, its flags, a vouched route", () => {
    for (const [action, subject] of [
      [ACTIONS.create, SUBJECTS.tenant],
      [ACTIONS.flag, SUBJECTS.tenant],
      [ACTIONS.vouch, SUBJECTS.route],
    ] as const) {
      expect(platform.can(action, subject)).toBe(true)
      expect(tenant.can(action, subject)).toBe(false)
      expect(reasonOf(tenant, action, subject)).toContain('console.platform')
      expect(nobody.can(action, subject)).toBe(false)
    }
  })

  test('an operator of a tenant gives every permission but a capability of the platform', () => {
    expect(tenant.can(ACTIONS.give, permissionOf('content.read'))).toBe(true)
    expect(tenant.can(ACTIONS.give, permissionOf('console.admin'))).toBe(true)
    expect(tenant.can(ACTIONS.give, permissionOf('console.platform'))).toBe(false)
    expect(reasonOf(tenant, ACTIONS.give, permissionOf('console.platform'))).toBe(
      'console.platform is a capability of the platform, and it is not yours to give: only an operator who holds it gives it.'
    )
    expect(platform.can(ACTIONS.give, permissionOf('console.platform'))).toBe(true)
  })

  test('the key of the platform without the credential of the platform gives nothing of the platform', () => {
    const unarmed = consoleAbility(
      scopeOf('acme', ['console.platform'], { platform: null, tenants: credentials.tenants })
    )
    expect(unarmed.can(ACTIONS.administer, tenantOf('acme'))).toBe(true)
    expect(unarmed.can(ACTIONS.administer, tenantOf('globex'))).toBe(false)
    expect(unarmed.can(ACTIONS.give, permissionOf('console.platform'))).toBe(false)
    expect(unarmed.can(ACTIONS.create, SUBJECTS.tenant)).toBe(false)
  })

  test('the creation of a workspace is its own right', () => {
    const creator = consoleAbility(scopeOf('acme', ['data.workspace.create'], credentials))
    expect(creator.can(ACTIONS.create, SUBJECTS.workspace)).toBe(true)
    expect(creator.can(ACTIONS.administer, SUBJECTS.tenant)).toBe(false)
    expect(tenant.can(ACTIONS.create, SUBJECTS.workspace)).toBe(false)
    expect(reasonOf(tenant, ACTIONS.create, SUBJECTS.workspace)).toContain('data.workspace.create')
  })

  test('the console holds no wildcard for an operator either', () => {
    expect(platform.can('manage', SUBJECTS.tenant)).toBe(false)
    expect(platform.can(ACTIONS.administer, 'all')).toBe(false)
    expect(platform.can(ACTIONS.give, SUBJECTS.route)).toBe(false)
  })

  test('the capabilities of a caller are its ability, read aloud', () => {
    const list = consoleCapabilitiesOf(tenant, 'acme')
    expect(list.map((entry) => [entry.key, entry.allowance.allowed])).toEqual([
      ['console.admin', true],
      ['console.platform', false],
      ['console.status', false],
      ['data.workspace.create', false],
    ])
    expect(list[0]?.label).toBe('Administer the tenant acme')
    expect(list[1]?.allowance.reason).toContain('console.platform')
  })
})

describe('the ability on a workspace', () => {
  const { model, audit } = WORKSPACE_PARTS

  test('the keys of the access context open the model and the audit', () => {
    const reader = workspaceAbility({ keys: ['content.read', 'data.model.read'] })
    expect(reader.can('read', model)).toBe(true)
    expect(reader.can('update', model)).toBe(false)
    expect(reader.can('read', audit)).toBe(false)
    const writer = workspaceAbility({ keys: ['data.model.write', 'data.audit.read'] })
    // The key that changes the model reads it too: Data says so.
    expect(writer.can('read', model)).toBe(true)
    expect(writer.can('update', model)).toBe(true)
    expect(writer.can('read', audit)).toBe(true)
  })

  test('a refusal names the key that is missing', () => {
    const nobody = workspaceAbility({ keys: ['content.read'] })
    expect(reasonOf(nobody, 'read', model)).toContain('data.model.read or data.model.write')
    expect(reasonOf(nobody, 'update', model)).toContain('data.model.write')
    expect(reasonOf(nobody, 'read', audit)).toContain('data.audit.read')
    expect(allowanceOf(nobody, 'read', audit).allowed).toBe(false)
  })

  test('a context that could not be read closes nothing: the ability is an upper bound', () => {
    const unknown = workspaceAbility({ keys: null })
    expect(unknown.can('read', model)).toBe(true)
    expect(unknown.can('update', model)).toBe(true)
    expect(unknown.can('read', audit)).toBe(true)
  })

  test('what Data answered about the model counts more than the keys', () => {
    const served = workspaceAbility({ keys: [], model: 'read' })
    expect(served.can('read', model)).toBe(true)
    expect(served.can('update', model)).toBe(false)
    const writable = workspaceAbility({ keys: [], model: 'write' })
    expect(writable.can('update', model)).toBe(true)
    const refused = workspaceAbility({ keys: ['data.model.write'], model: 'refused' })
    expect(refused.can('read', model)).toBe(false)
    expect(refused.can('update', model)).toBe(false)
  })

  test('a refusal of Data that the keys do not explain is said as the refusal of Data', () => {
    // Access holds the key and Data refused all the same: the reason
    // does not say that Access gives nothing.
    const refused = workspaceAbility({ keys: ['data.model.write'], model: 'refused' })
    expect(reasonOf(refused, 'read', model)).toContain('Data refuses you the data model')
    expect(reasonOf(refused, 'read', model)).not.toContain('Access gives you neither')
    // The keys could not be read, and Data served the model to be read only.
    const readOnly = workspaceAbility({ keys: null, model: 'read' })
    expect(reasonOf(readOnly, 'update', model)).toContain('to be read, and not to be changed')
    const noAudit = workspaceAbility({ keys: ['data.audit.read'], audit: false })
    expect(reasonOf(noAudit, 'read', audit)).toContain('Data refuses you the audit')
  })

  test('what Data answered about the audit counts more than the keys', () => {
    expect(workspaceAbility({ keys: [], audit: true }).can('read', audit)).toBe(true)
    expect(workspaceAbility({ keys: ['data.audit.read'], audit: false }).can('read', audit)).toBe(
      false
    )
  })

  test('the capabilities of a workspace are its ability, read aloud', () => {
    const list = workspaceCapabilitiesOf(workspaceAbility({ keys: ['data.model.read'] }))
    expect(list.map((entry) => [entry.label, entry.allowance.allowed])).toEqual([
      ['Read the data model', true],
      ['Change the data model', false],
      ['Read the audit', false],
    ])
  })

  test('the parts of a workspace are not collections: no collection takes their name', () => {
    // The key of a collection is letters, digits and underscores.
    for (const name of [...Object.values(WORKSPACE_PARTS), ...Object.values(SUBJECTS)]) {
      expect(/^[a-z][a-z0-9_]{0,62}$/.test(name)).toBe(false)
    }
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

describe('the reasons of a refusal', () => {
  const field = (name: string) => ({ name, type: 'string', required: false, nullable: true })
  const posts = collection({
    actions: ['read', 'update'],
    readableFields: ['title', 'status'],
    writableFields: ['title'],
    fields: [field('title'), field('status'), field('secret')],
  })

  test('an action the metadata does not name says so, and an allowed one says nothing', () => {
    const ability = collectionAbility(posts)
    expect(reasonOf(ability, 'read', 'posts')).toBeNull()
    expect(reasonOf(ability, 'delete', 'posts')).toBe(
      "Data's policies do not let you delete records of Posts."
    )
    expect(reasonOf(ability, 'create', 'posts', 'title')).toContain('create records of Posts')
  })

  test('a field says whether it is hidden or fixed, and the action stays allowed', () => {
    const ability = collectionAbility(posts)
    expect(ability.can('update', 'posts')).toBe(true)
    expect(reasonOf(ability, 'update', 'posts', 'title')).toBeNull()
    expect(reasonOf(ability, 'update', 'posts', 'status')).toContain('do not let you change')
    expect(reasonOf(ability, 'read', 'posts', 'secret')).toContain('hide this field')
  })

  test('a refusal of the console names the key it needs', () => {
    const ability = consoleAbility(scopeOf('acme', [], credentials))
    expect(reasonOf(ability, CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toContain('console.admin')
    const operator = consoleAbility(scopeOf('acme', ['console.admin'], credentials))
    expect(reasonOf(operator, CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)).toBeNull()
    expect(reasonOf(operator, CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)).toContain(
      'console.platform'
    )
  })

  test('the grid of a collection holds every action and every field', () => {
    const access = collectionAccessOf(posts)
    expect(access.actions.read.allowed).toBe(true)
    expect(access.actions.delete).toEqual({
      allowed: false,
      reason: "Data's policies do not let you delete records of Posts.",
    })
    expect(
      access.fields.map((f) => [f.name, f.read.allowed, f.create.allowed, f.update.allowed])
    ).toEqual([
      ['title', true, false, true],
      ['status', true, false, false],
      ['secret', false, false, false],
    ])
  })
})
