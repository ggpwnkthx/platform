import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { alice, as, deny, owner, role, setup, teardown, w } from './platform-world.ts'
import { hardenSql } from '../packages/cli/src/harden.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import * as pageAccess from '../packages/data/src/access/query.ts'

/**
 * The role catalogs: what the database shows of a role, and what it hides.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('role catalogs', () => {
  test('a caller sees their own roles and memberships, and nobody else’s', async () => {
    const data = await as('alice', pageAccess.roles)
    const names = data.roles.map((r) => r.name)
    expect(names).toContain(role('alice'))
    expect(names).toContain(role('writer'))
    expect(names).not.toContain(role('bob'))
    expect(names).not.toContain(role('owner'))
    expect(data.memberships.length).toBeGreaterThan(0)
    expect(data.memberships.every((m) => m.member === role('alice'))).toBe(true)
    expect(data.memberships.some((m) => m.role === role('reader'))).toBe(true)
    const bobs = await as('bob', pageAccess.roles)
    expect(bobs.memberships.every((m) => m.member === role('bob'))).toBe(true)
    expect(bobs.roles.map((r) => r.name)).not.toContain(role('alice'))
  })
  test('an operator sees every membership, because it administers roles', async () => {
    await w.admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
    try {
      const data = await as('owner', pageAccess.roles)
      expect(data.roles.map((r) => r.name)).toContain(role('bob'))
      expect(data.memberships.some((m) => m.member === role('bob'))).toBe(true)
    } finally {
      await w.admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
    }
  })
  test('the platform answers membership questions without exposing the catalog', async () => {
    const answered = await alice.query(
      'SELECT platform.is_member($1,$2) AS mine, platform.is_member($3,$2) AS theirs',
      [role('alice'), role('writer'), role('bob')]
    )
    expect(answered.rows[0]).toEqual({ mine: true, theirs: false })
    const attributes = await alice.query('SELECT * FROM platform.role_attributes($1)', [
      role('alice'),
    ])
    expect(attributes.rows[0]).toMatchObject({ name: role('alice'), login: true })
    expect(
      (await alice.query('SELECT * FROM platform.role_attributes($1)', [role('bob')])).rows
    ).toEqual([])
  })
  test('hardening hides the role catalogs from ordinary connections', async () => {
    await w.admin.query(hardenSql('strict'))
    try {
      await deny(alice, 'SELECT * FROM pg_auth_members')
      await deny(alice, 'SELECT rolname FROM pg_roles')
      // The caller still learns what PostgreSQL itself tells them about their own rights.
      expect(
        (await alice.query("SELECT pg_has_role($1,'USAGE') AS ok", [role('writer')])).rows[0].ok
      ).toBe(true)
      expect(
        (await alice.query('SELECT * FROM information_schema.applicable_roles')).rows.length
      ).toBeGreaterThan(0)
      // The page answers the same question, from the platform's own filtered view.
      const data = await as('alice', pageAccess.roles)
      expect(data.roles.map((r) => r.name)).toContain(role('alice'))
      expect(data.memberships.every((m) => m.member === role('alice'))).toBe(true)
      // An operator keeps the catalog.
      await w.admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
      try {
        expect(
          (await owner.query('SELECT count(*)::int AS n FROM pg_auth_members')).rows[0].n
        ).toBeGreaterThan(0)
      } finally {
        await w.admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
      }
    } finally {
      await w.admin.query(hardenSql('restore'))
    }
    expect(
      (await alice.query('SELECT count(*)::int AS n FROM pg_auth_members')).rows[0].n
    ).toBeGreaterThan(0)
  })
})
