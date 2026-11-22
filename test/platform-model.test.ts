import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  alice,
  aliceId,
  as,
  deny,
  field,
  owner,
  role,
  runAll,
  setup,
  teardown,
  w,
} from './platform-world.ts'
import { applyModel } from '../packages/cli/src/model.ts'
import { collectionStatements } from '../packages/ui/src/model/statements.ts'
import { fieldStatements } from '../packages/ui/src/model/statements.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import * as pageAccess from '../packages/data/src/access/query.ts'
import * as pageCatalog from '../packages/data/src/catalog/query.ts'
import * as pageIdentity from '../packages/data/src/identity/query.ts'
import * as pageWrites from '../packages/data/src/content/write.ts'
import { refusal } from './page.ts'

/**
 * The model of a collection: its fields, its relations, and what holds them true.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('modeling and integrity', () => {
  test('runtime modeling uses caller rights and native checks', async () => {
    const tasks = await collectionStatements('newsroom', 'tasks', '', [
      field({ name: 'title', required: true, maxLength: 20 }),
      field({ name: 'status', default: 'draft', choices: ['draft', 'done'] }),
    ])
    await as('owner', (db) => runAll(db, tasks))
    const hacked = await collectionStatements('newsroom', 'hacked', '', [])
    expect(await as('alice', (db) => refusal(runAll(db, hacked)))).toBe('42501')
    await deny(
      owner,
      "INSERT INTO newsroom.tasks(title) VALUES ('abcdefghijklmnopqrstuvwxyz')",
      '23514'
    )
    expect(
      await as('owner', (db) =>
        refusal(pageWrites.insertRecord(db, 'newsroom', 'tasks', { title: 'x', status: 'invalid' }))
      )
    ).toBe('23514')
  })
  test('failed model transaction leaves no table behind', async () => {
    const statements = await collectionStatements('newsroom', 'invalid_model', '', [
      field({ name: 'repeat' }),
      field({ name: 'repeat' }),
    ])
    expect(await as('owner', (db) => refusal(runAll(db, statements)))).toBe('42701')
    expect(
      (await owner.query("SELECT to_regclass('newsroom.invalid_model') AS t")).rows[0].t
    ).toBeNull()
  })
  test('adding fields requires native DDL rights', async () => {
    const due = await fieldStatements('newsroom', 'tasks', field({ name: 'due', type: 'date' }))
    await as('owner', (db) => runAll(db, due))
    const oops = await fieldStatements('newsroom', 'tasks', field({ name: 'oops' }))
    expect(await as('alice', (db) => refusal(runAll(db, oops)))).toBe('42501')
  })
  test('catalog reports database column rights', async () => {
    const catalog = await as('alice', pageCatalog.catalog)
    const fields = catalog.columns.filter((f) => f.schema === 'newsroom' && f.table === 'articles')
    expect(fields.some((f) => f.name === 'title' && f.can_select)).toBe(true)
    // A column without a right is listed, and PostgreSQL's answer says it may not be read.
    expect(fields.find((f) => f.name === 'secret')).toMatchObject({
      can_select: false,
      can_insert: false,
      can_update: false,
    })
    expect(catalog.tables.some((t) => t.schema === 'private_area')).toBe(false)
    // PostgreSQL grants USAGE on public to every role; the catalog lists workspaces, and
    // public is not one.
    expect(catalog.schemas.some((s) => s.name === 'public')).toBe(false)
  })
  test('the catalog answers who owns what, as PostgreSQL does', async () => {
    const ownerCatalog = await as('owner', pageCatalog.catalog)
    const aliceCatalog = await as('alice', pageCatalog.catalog)
    const owned = (catalog: typeof ownerCatalog) =>
      catalog.tables.find((t) => t.schema === 'newsroom' && t.name === 'articles')
    // The owner of the collection may alter it, grant on it and write its policies.
    expect(owned(ownerCatalog)?.can_alter).toBe(true)
    // A reader of it may not: PostgreSQL gives ALTER to the owner alone.
    expect(owned(aliceCatalog)?.can_alter).toBe(false)
    expect(ownerCatalog.schemas.find((s) => s.name === 'newsroom')?.can_alter).toBe(true)
  })
  test('the identity answers what the reader may make and administer', async () => {
    const me = await as('owner', pageIdentity.identity)
    expect(me.can_create_workspace).toBe(true)
    expect(me.is_operator).toBe(false)
    // An operator may administer every role: the platform's own answer.
    await w.admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
    try {
      expect((await as('owner', pageIdentity.identity)).is_operator).toBe(true)
    } finally {
      await w.admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
    }
  })
  test('the roles answer who may admit others to them', async () => {
    const roles = await as('alice', pageAccess.roles)
    expect(roles.roles.every((r) => r.admits !== undefined)).toBe(true)
    // Alice belongs to the writers, but holds no admin option on them.
    expect(roles.roles.find((r) => r.name === role('writer'))?.admits).toBe(false)
    // PostgreSQL's ADMIN OPTION is what lets her admit others.
    await w.admin.query(
      `GRANT ${ident(role('writer'))} TO ${ident(role('alice'))} WITH ADMIN OPTION`
    )
    try {
      const withOption = await as('alice', pageAccess.roles)
      expect(withOption.roles.find((r) => r.name === role('writer'))?.admits).toBe(true)
    } finally {
      await w.admin.query(
        `REVOKE ADMIN OPTION FOR ${ident(role('writer'))} FROM ${ident(role('alice'))} CASCADE`
      )
    }
    // An operator may administer every role.
    await w.admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
    try {
      const operator = await as('owner', pageAccess.roles)
      expect(operator.roles.every((r) => r.admits)).toBe(true)
    } finally {
      await w.admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
    }
  })
  test('bundled CRM model imports twice with real foreign keys', async () => {
    const model = JSON.parse(
      readFileSync(new URL('../deploy/models/crm.json', import.meta.url), 'utf8')
    )
    await applyModel(owner, model)
    await applyModel(owner, model)
    const fk = await owner.query(
      "SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='crm' AND c.contype='f'"
    )
    expect(fk.rows[0].n).toBeGreaterThan(10)
    const tables = await owner.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='crm'"
    )
    expect(tables.rows[0].n).toBe(model.collections.length)
  })
  test('a version-guarded update detects a lost update atomically', async () => {
    const v = Number(
      (await alice.query('SELECT version FROM newsroom.articles WHERE id=$1', [aliceId])).rows[0]
        .version
    )
    await as('alice', async (db) => {
      const update = (title: string) =>
        pageWrites.updateRecord(db, 'newsroom', 'articles', aliceId, { title }, v)
      expect(await update('Revised')).toBe(1)
      // The row now carries the next version: the same guard touches nothing.
      expect(await update('Lost update')).toBe(0)
    })
    expect(
      (await alice.query('SELECT title FROM newsroom.articles WHERE id=$1', [aliceId])).rows[0]
        .title
    ).toBe('Revised')
  })
})
