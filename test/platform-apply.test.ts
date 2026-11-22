import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { connect, deny, role, setup, teardown, w } from './platform-world.ts'
import { applyManifest } from '../packages/cli/src/apply.ts'
import { parseManifest } from '../packages/cli/src/apply.ts'
import { prefix } from './world.ts'
import { transaction } from '../packages/cli/src/database/db.ts'

/**
 * A manifest applied: what it makes, and what it leaves alone.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('declarative apply', () => {
  const manifest = (ann: object = {}, grant: object = {}) => ({
    format: 1,
    groups: [{ name: role('ap_editors') }],
    users: [
      { name: role('ap_admin'), admin: true },
      { name: role('ap_ann'), groups: [role('ap_editors')], ...ann },
    ],
    workspaces: [
      {
        slug: 'desk',
        owner: role('ap_admin'),
        collections: [
          { name: 'notes', fields: [{ name: 'title', type: 'string', required: true }] },
        ],
        grants: [
          { to: role('ap_editors'), privileges: ['usage'] },
          {
            to: role('ap_editors'),
            collection: 'notes',
            privileges: ['select', 'insert', 'delete'],
            columns: ['id', 'title', 'created_by'],
            ...grant,
          },
        ],
        policies: [
          {
            collection: 'notes',
            name: 'own',
            to: [role('ap_editors')],
            using: 'created_by=session_user',
            check: 'created_by=session_user',
          },
        ],
      },
    ],
  })
  const apply = (raw: unknown) => transaction(w.admin, () => applyManifest(w.admin, raw))
  test('one manifest provisions users, groups, a workspace, grants and policies, and repeats as a no-op', async () => {
    const first = await apply(manifest())
    expect(first.changes).toContain(`create user ${role('ap_ann')}`)
    expect(first.changes).toContain(`create workspace desk owned by ${role('ap_admin')}`)
    expect(first.changes).toContain('create collection desk.notes')
    expect(first.changes).toContain(`make ${role('ap_admin')} an administrator`)
    expect(await apply(manifest())).toMatchObject({ changes: [] })
    const owned = await w.admin.query(
      "SELECT tableowner FROM pg_tables WHERE schemaname='desk' AND tablename='notes'"
    )
    expect(owned.rows[0].tableowner).toBe(role('ap_admin'))
    const ann = await connect('ap_ann')
    try {
      await ann.query("INSERT INTO desk.notes(title) VALUES ('Mine')")
      expect((await ann.query('SELECT title,created_by FROM desk.notes')).rows).toEqual([
        { title: 'Mine', created_by: role('ap_ann') },
      ])
      await deny(ann, 'SELECT version FROM desk.notes')
    } finally {
      await ann.end()
    }
    // The administrator it made manages its own workspace with its own rights.
    const operator = await connect('ap_admin')
    try {
      const mine = { workspaces: manifest().workspaces }
      expect(await transaction(operator, () => applyManifest(operator, mine))).toMatchObject({
        changes: [],
      })
    } finally {
      await operator.end()
    }
  })
  test('a failed manifest changes nothing, and a manifest cannot give anyone a password', async () => {
    const broken = manifest()
    broken.workspaces[0]!.policies[0]!.using = 'no_such_column=session_user'
    broken.users.push({ name: role('ap_ghost'), groups: [] })
    await expect(apply(broken)).rejects.toMatchObject({ code: '42703' })
    const ghost = await w.admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role('ap_ghost')])
    expect(ghost.rowCount).toBe(0)
    const made = await apply({ users: [...manifest().users, { name: role('ap_new') }] })
    expect(made.changes).toEqual([
      `create user ${role('ap_new')}`,
      `add ${role('ap_new')} to platform_users`,
    ])
    await (await connect('ap_new')).end()
    const secrets = await w.admin.query(
      'SELECT count(*)::int AS n FROM pg_authid WHERE rolname LIKE $1 AND rolpassword IS NOT NULL',
      [`${prefix}%`]
    )
    expect(secrets.rows[0].n).toBe(0)
    for (const key of ['password', 'password_env', 'password_file'])
      expect(() => parseManifest({ users: [{ name: 'x', [key]: 'y' }] })).toThrow()
    expect(() => parseManifest({ collections: [] })).toThrow()
  })
  test('revocation, disabling and removal are declared the same way', async () => {
    const revoked = await apply(manifest({}, { privileges: ['insert'], state: 'absent' }))
    expect(revoked.changes).toHaveLength(1)
    const ann = await connect('ap_ann')
    try {
      await deny(ann, "INSERT INTO desk.notes(title) VALUES ('No longer')")
      expect((await ann.query('SELECT title FROM desk.notes')).rowCount).toBe(1)
    } finally {
      await ann.end()
    }
    expect((await apply(manifest({ login: false }))).changes).toContain(
      `disable login of ${role('ap_ann')}`
    )
    await expect(connect('ap_ann')).rejects.toMatchObject({ code: '28000' })
    const gone = await apply({ users: [{ name: role('ap_ann'), state: 'absent' }] })
    expect(gone.changes).toEqual([`drop user ${role('ap_ann')}`])
    expect(() => parseManifest({ users: [{ name: 'platform_core' }] })).not.toThrow()
    await expect(apply({ groups: [{ name: 'platform_core' }] })).rejects.toThrow('reserved')
  })
})
