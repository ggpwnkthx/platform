import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { applyManifest, parseManifest } from '../packages/cli/src/apply.ts'
import { ident, literal } from '../packages/sql/src/index.ts'
import { TokenClient, transaction } from '../packages/cli/src/db.ts'
import { hardenSql } from '../packages/cli/src/harden.ts'
import { applyModel } from '../packages/cli/src/model.ts'
import { authenticationProblems, requirePostgres18 } from '../packages/cli/src/requirements.ts'
import {
  collectionStatements,
  emptyField,
  type FieldDraft,
  fieldStatements,
} from '../packages/ui/src/db/model.ts'
import * as page from '../packages/ui/src/db/platform.ts'
import type { Connection } from '../packages/ui/src/pg/wire.ts'
import { startIssuer } from './issuer.ts'
import { openPage, refusal } from './page.ts'

const adminUrl =
  process.env.TEST_ADMIN_URL ?? 'postgres://postgres:test-admin-password@127.0.0.1:54329/postgres'
const url = new URL(adminUrl)
const prefix = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const dbName = `${prefix}_db`
const role = (name: string) => `${prefix}_${name}`
// The test server is started trusting this issuer: see docs/operations.md.
const issuerUrl = process.env.TEST_OIDC_ISSUER ?? 'http://127.0.0.1:54330'
const issuer = startIssuer(issuerUrl)
const roles = [
  'owner',
  'alice',
  'bob',
  'writer',
  'reader',
  'outsider',
  'insert_only',
  'blind',
  'retired',
]
/** Roles that only the declarative apply tests create. */
const applied = ['ap_admin', 'ap_ann', 'ap_editors', 'ap_new']
let root: pg.Client, admin: pg.Client, owner: pg.Client, alice: pg.Client, bob: pg.Client
let aliceId: string, bobId: string
let started = false
/** What the CLI reads from its environment to reach the test database. */
const cliEnv = {
  APP_ENV: 'test',
  OIDC_ISSUER: issuerUrl,
  DATABASE_HOST: url.hostname,
  DATABASE_PORT: url.port || '5432',
  DATABASE_NAME: dbName,
  DATABASE_SSL: process.env.TEST_DATABASE_SSL ?? 'disable',
}
const endpoint = {
  host: url.hostname,
  port: Number(url.port || 5432),
  database: dbName,
  ssl: process.env.TEST_DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : false,
}
/** A direct connection, as psql would make it: the role, and a token that names it. */
async function connect(name: string, token = issuer.mint(role(name))) {
  const q = new TokenClient({ ...endpoint, user: role(name) }, token)
  q.on('error', () => undefined)
  await q.connect()
  return q
}
/** The page's own client, signed in as this person with a token the issuer minted for them. */
const signIn = (name: string, token = issuer.mint(role(name))) =>
  openPage(url, role(name), dbName, token)
/** Runs some work in the page's client as this person, then signs them out. */
async function as<T>(name: string, work: (db: Connection) => Promise<T>): Promise<T> {
  const db = await signIn(name)
  try {
    return await work(db)
  } finally {
    db.close()
  }
}
/** The columns of a collection this reader may read, as the catalog reports them. */
async function readable(db: Connection, schema: string, table: string) {
  const { columns } = await page.catalog(db)
  return columns
    .filter((c) => c.schema === schema && c.table === table && c.can_select)
    .map((c) => c.name)
}
/** One page of records, as the records screen asks for it. */
const records = (db: Connection, table: string, query: Partial<page.RecordQuery> = {}) =>
  page.records(db, {
    schema: 'newsroom',
    table,
    columns: ['id'],
    searchable: [],
    filter: {},
    search: '',
    sort: [],
    limit: 50,
    offset: 0,
    ...query,
  })
/** Runs the statements the model screen shows, in one transaction, as the page does. */
const runAll = (db: Connection, statements: string[]) =>
  page.transaction(db, async () => {
    for (const statement of statements) await db.query(statement)
  })
const field = (draft: Partial<FieldDraft> & Pick<FieldDraft, 'name'>): FieldDraft => ({
  ...emptyField(),
  ...draft,
})
async function deny(q: pg.Client, text: string, code = '42501') {
  try {
    await q.query(text)
    throw new Error('Expected PostgreSQL denial')
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code)
  }
}
beforeAll(async () => {
  root = new pg.Client({ connectionString: adminUrl })
  await root.connect()
  await root.query(`CREATE DATABASE ${ident(dbName)}`)
  started = true
  const dbUrl = new URL(adminUrl)
  dbUrl.pathname = `/${dbName}`
  admin = new pg.Client({ connectionString: dbUrl.toString() })
  await admin.connect()
  await transaction(admin, async () => {
    for (const file of ['0001_native.sql', '0002_harden_catalogs.sql', '0003_metadata.sql'])
      await admin.query(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  })
  for (const n of roles) {
    await admin.query(
      `CREATE ROLE ${ident(role(n))} ${['writer', 'reader'].includes(n) ? 'NOLOGIN' : 'LOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
    )
    await admin.query(`GRANT platform_users TO ${ident(role(n))}`)
  }
  await admin.query(`GRANT CREATE ON DATABASE ${ident(dbName)} TO ${ident(role('owner'))}`)
  await admin.query(
    `GRANT ${ident(role('writer'))},${ident(role('reader'))} TO ${ident(role('alice'))},${ident(role('bob'))}`
  )
  owner = await connect('owner')
  alice = await connect('alice')
  bob = await connect('bob')
  await owner.query(
    "CREATE SCHEMA newsroom; SELECT platform.create_collection('newsroom','articles')"
  )
  await owner.query(
    "ALTER TABLE newsroom.articles ADD COLUMN title text NOT NULL CHECK (char_length(title)<100),ADD COLUMN secret text DEFAULT 'hidden'"
  )
  await owner.query(
    `GRANT USAGE ON SCHEMA newsroom TO ${['writer', 'reader', 'insert_only', 'blind'].map((n) => ident(role(n))).join(',')}`
  )
  await owner.query(
    `GRANT SELECT (id,title,created_by,version) ON newsroom.articles TO ${ident(role('reader'))}`
  )
  await owner.query(
    `GRANT INSERT (title),UPDATE (title),DELETE ON newsroom.articles TO ${ident(role('writer'))}`
  )
  await owner.query(
    `CREATE POLICY own ON newsroom.articles FOR ALL TO ${ident(role('writer'))} USING(created_by=session_user) WITH CHECK(created_by=session_user)`
  )
  await alice.query("INSERT INTO newsroom.articles(title) VALUES ('Alice draft')")
  await bob.query("INSERT INTO newsroom.articles(title) VALUES ('Bob draft')")
  aliceId = (await alice.query('SELECT id FROM newsroom.articles')).rows[0].id
  bobId = (await bob.query('SELECT id FROM newsroom.articles')).rows[0].id
}, 30000)
afterAll(async () => {
  await Promise.all([owner?.end(), alice?.end(), bob?.end(), admin?.end()])
  if (started) {
    await root.query(`DROP DATABASE ${ident(dbName)} WITH(FORCE)`)
    for (const n of [...roles, ...applied])
      await root.query(`DROP ROLE IF EXISTS ${ident(role(n))}`)
  }
  await root?.end()
  issuer.stop()
}, 30000)

describe('native identity', () => {
  test('in the page’s client, session_user and current_user are the authenticated login', async () => {
    const me = await as('alice', page.identity)
    expect(me).toMatchObject({
      username: role('alice'),
      effective_role: role('alice'),
      database: dbName,
      platform_version: '2.1.0',
    })
  })
  test('forged, expired, foreign and NOLOGIN sign-ins are refused at login', async () => {
    const tokenFor = (claims: Record<string, unknown> = {}) => issuer.mint(role('alice'), claims)
    const me = await as('alice', page.identity)
    expect(me.username).toBe(role('alice'))
    for (const token of [
      issuer.mint(role('alice'), {}, issuer.strangerKey()),
      tokenFor({ exp: Math.floor(Date.now() / 1000) - 60 }),
      tokenFor({ iss: 'https://elsewhere.example' }),
      tokenFor({ email: undefined }),
      'not-a-token',
    ])
      expect(await refusal(signIn('alice', token))).toBe('28000')
    // A token for a role that does not exist, and one for a role that may not log in.
    expect(await refusal(signIn('nobody'))).toBe('28000')
    expect(await refusal(signIn('writer'))).toBe('28000')
  })
  test('a token logs in only the role it names', async () => {
    await expect(connect('bob', issuer.mint(role('alice')))).rejects.toMatchObject({
      code: '28000',
    })
    expect(await refusal(signIn('bob', issuer.mint(role('alice'))))).toBe('28000')
    // The administrator's password rule is not a way in for a token, nor for anyone else.
    await expect(
      new TokenClient(
        { ...endpoint, user: decodeURIComponent(url.username) },
        issuer.mint(decodeURIComponent(url.username))
      ).connect()
    ).rejects.toMatchObject({ code: '28000' })
  })
  test('SET ROLE, session authorization and application identity cannot impersonate another user', async () => {
    await as('alice', async (db) => {
      expect(await refusal(page.run(db, `SET ROLE ${ident(role('owner'))}`))).toBe('42501')
      expect(await refusal(page.run(db, `SET SESSION AUTHORIZATION ${ident(role('owner'))}`))).toBe(
        '42501'
      )
    })
    await alice.query(`SET app.user_id=${literal(role('bob'))}`)
    expect((await alice.query('SELECT id FROM newsroom.articles')).rows.map((r) => r.id)).toEqual([
      aliceId,
    ])
    await alice.query('RESET app.user_id')
  })
  test('NOLOGIN immediately prevents the next sign-in of the page’s client', async () => {
    await admin.query(`ALTER ROLE ${ident(role('alice'))} NOLOGIN`)
    try {
      expect(await refusal(signIn('alice'))).toBe('28000')
    } finally {
      await admin.query(`ALTER ROLE ${ident(role('alice'))} LOGIN`)
    }
  })
  test('a role password is not a login', async () => {
    await admin.query(`ALTER ROLE ${ident(role('alice'))} PASSWORD 'a-real-password'`)
    try {
      const q = new pg.Client({ ...endpoint, user: role('alice'), password: 'a-real-password' })
      q.on('error', () => undefined)
      await expect(q.connect()).rejects.toThrow()
      await q.end().catch(() => undefined)
    } finally {
      await admin.query(`ALTER ROLE ${ident(role('alice'))} PASSWORD NULL`)
    }
  })
  test('the server is PostgreSQL 18 and lets people in over the network by token only', async () => {
    await requirePostgres18(admin)
    expect(await authenticationProblems(admin)).toEqual([])
    expect(await authenticationProblems(alice)).toBe('unchecked')
  })
})
describe('native access control', () => {
  test('RLS filters direct SQL and the page’s records identically', async () => {
    const direct = (await alice.query('SELECT id,title,created_by,version FROM newsroom.articles'))
      .rows
    const shown = await as('alice', async (db) =>
      records(db, 'articles', { columns: await readable(db, 'newsroom', 'articles') })
    )
    expect(shown.total).toBe(1)
    expect(shown.rows).toEqual(direct.map((row) => ({ ...row, version: Number(row.version) })))
    expect(direct).toHaveLength(1)
    expect(direct[0].id).toBe(aliceId)
  })
  test('column grants deny projections, predicates, sorts and writes', async () => {
    await deny(alice, 'SELECT secret FROM newsroom.articles')
    await as('alice', async (db) => {
      for (const query of [
        { columns: ['id', 'secret'] },
        { sort: ['secret'] },
        { filter: { secret: { op: 'eq' as const, value: 'hidden' } } },
      ])
        expect(await refusal(records(db, 'articles', query))).toBe('42501')
      await deny(alice, "UPDATE newsroom.articles SET secret='stolen'")
      expect(
        await refusal(page.updateRecord(db, 'newsroom', 'articles', aliceId, { secret: 'stolen' }))
      ).toBe('42501')
      expect(
        await refusal(page.insertRecord(db, 'newsroom', 'articles', { title: 'x', secret: 'x' }))
      ).toBe('42501')
    })
  })
  test('RLS prevents modifying another login’s rows', async () => {
    await as('alice', async (db) => {
      expect(await page.updateRecord(db, 'newsroom', 'articles', bobId, { title: 'Hacked' })).toBe(
        0
      )
      expect(await page.deleteRecord(db, 'newsroom', 'articles', bobId)).toBe(0)
    })
    expect((await bob.query('SELECT title FROM newsroom.articles')).rows[0].title).toBe('Bob draft')
  })
  test('no policy means no rows even with SELECT granted', async () => {
    await owner.query(`GRANT SELECT ON newsroom.articles TO ${ident(role('blind'))}`)
    const q = await connect('blind')
    try {
      expect((await q.query('SELECT * FROM newsroom.articles')).rows).toEqual([])
      const shown = await as('blind', async (db) =>
        records(db, 'articles', { columns: await readable(db, 'newsroom', 'articles') })
      )
      expect(shown).toMatchObject({ rows: [], total: 0 })
    } finally {
      await q.end()
    }
  })
  test('REVOKE changes direct SQL and the page’s client without compiling application policies', async () => {
    await admin.query(`REVOKE ${ident(role('reader'))} FROM ${ident(role('alice'))}`)
    try {
      await deny(alice, 'SELECT title FROM newsroom.articles')
      expect(
        await as('alice', (db) => refusal(records(db, 'articles', { columns: ['title'] })))
      ).toBe('42501')
    } finally {
      await admin.query(`GRANT ${ident(role('reader'))} TO ${ident(role('alice'))}`)
    }
  })
  test('schema boundaries and DDL rights are native', async () => {
    await owner.query('CREATE SCHEMA private_area; CREATE TABLE private_area.keys(secret text)')
    await deny(alice, 'SELECT * FROM private_area.keys')
    await as('alice', async (db) => {
      for (const s of [
        'SELECT * FROM private_area.keys',
        'ALTER TABLE newsroom.articles ADD COLUMN stolen text',
        'CREATE SCHEMA unauthorized',
      ])
        expect(await refusal(page.run(db, s))).toBe('42501')
    })
  })
  test('PostgreSQL ADMIN OPTION controls role delegation', async () => {
    const grant = `GRANT ${ident(role('reader'))} TO ${ident(role('outsider'))}`
    expect(await as('alice', (db) => refusal(page.run(db, grant)))).toBe('42501')
    await admin.query(`GRANT ${ident(role('reader'))} TO ${ident(role('alice'))} WITH ADMIN OPTION`)
    try {
      expect((await as('alice', (db) => page.run(db, grant))).command).toBe('GRANT ROLE')
    } finally {
      await admin.query(
        `REVOKE ADMIN OPTION FOR ${ident(role('reader'))} FROM ${ident(role('alice'))} CASCADE`
      )
      await admin.query(`REVOKE ${ident(role('reader'))} FROM ${ident(role('outsider'))}`)
    }
  })
  test('SQL GRANT immediately opens a projection in the page’s client', async () => {
    await as('owner', (db) =>
      page.run(db, `GRANT SELECT(secret) ON newsroom.articles TO ${ident(role('reader'))}`)
    )
    try {
      const shown = await as('alice', (db) => records(db, 'articles', { columns: ['secret'] }))
      expect(shown.rows).toEqual([{ secret: 'hidden' }])
    } finally {
      await owner.query(`REVOKE SELECT(secret) ON newsroom.articles FROM ${ident(role('reader'))}`)
    }
  })
  test('write-only INSERT never requires or returns hidden SELECT columns', async () => {
    await owner.query(`GRANT INSERT(title) ON newsroom.articles TO ${ident(role('insert_only'))}`)
    await owner.query(
      `CREATE POLICY insert_only ON newsroom.articles FOR INSERT TO ${ident(role('insert_only'))} WITH CHECK(true)`
    )
    await as('insert_only', async (db) => {
      expect(await page.insertRecord(db, 'newsroom', 'articles', { title: 'Write only' })).toBe(1)
      expect(await readable(db, 'newsroom', 'articles')).toEqual([])
      expect(await refusal(records(db, 'articles', { columns: ['id', 'title'] }))).toBe('42501')
    })
  })
})
describe('role catalogs', () => {
  test('a caller sees their own roles and memberships, and nobody else’s', async () => {
    const data = await as('alice', page.roles)
    const names = data.roles.map((r) => r.name)
    expect(names).toContain(role('alice'))
    expect(names).toContain(role('writer'))
    expect(names).not.toContain(role('bob'))
    expect(names).not.toContain(role('owner'))
    expect(data.memberships.length).toBeGreaterThan(0)
    expect(data.memberships.every((m) => m.member === role('alice'))).toBe(true)
    expect(data.memberships.some((m) => m.role === role('reader'))).toBe(true)
    const bobs = await as('bob', page.roles)
    expect(bobs.memberships.every((m) => m.member === role('bob'))).toBe(true)
    expect(bobs.roles.map((r) => r.name)).not.toContain(role('alice'))
  })
  test('an operator sees every membership, because it administers roles', async () => {
    await admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
    try {
      const data = await as('owner', page.roles)
      expect(data.roles.map((r) => r.name)).toContain(role('bob'))
      expect(data.memberships.some((m) => m.member === role('bob'))).toBe(true)
    } finally {
      await admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
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
    await admin.query(hardenSql('strict'))
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
      const data = await as('alice', page.roles)
      expect(data.roles.map((r) => r.name)).toContain(role('alice'))
      expect(data.memberships.every((m) => m.member === role('alice'))).toBe(true)
      // An operator keeps the catalog.
      await admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
      try {
        expect(
          (await owner.query('SELECT count(*)::int AS n FROM pg_auth_members')).rows[0].n
        ).toBeGreaterThan(0)
      } finally {
        await admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
      }
    } finally {
      await admin.query(hardenSql('restore'))
    }
    expect(
      (await alice.query('SELECT count(*)::int AS n FROM pg_auth_members')).rows[0].n
    ).toBeGreaterThan(0)
  })
})
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
        refusal(page.insertRecord(db, 'newsroom', 'tasks', { title: 'x', status: 'invalid' }))
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
    const catalog = await as('alice', page.catalog)
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
    const ownerCatalog = await as('owner', page.catalog)
    const aliceCatalog = await as('alice', page.catalog)
    const owned = (catalog: typeof ownerCatalog) =>
      catalog.tables.find((t) => t.schema === 'newsroom' && t.name === 'articles')
    // The owner of the collection may alter it, grant on it and write its policies.
    expect(owned(ownerCatalog)?.can_alter).toBe(true)
    // A reader of it may not: PostgreSQL gives ALTER to the owner alone.
    expect(owned(aliceCatalog)?.can_alter).toBe(false)
    expect(ownerCatalog.schemas.find((s) => s.name === 'newsroom')?.can_alter).toBe(true)
  })
  test('the identity answers what the reader may make and administer', async () => {
    const me = await as('owner', page.identity)
    expect(me.can_create_workspace).toBe(true)
    expect(me.is_operator).toBe(false)
    // An operator may administer every role: the platform's own answer.
    await admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
    try {
      expect((await as('owner', page.identity)).is_operator).toBe(true)
    } finally {
      await admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
    }
  })
  test('the roles answer who may admit others to them', async () => {
    const roles = await as('alice', page.roles)
    expect(roles.roles.every((r) => r.admits !== undefined)).toBe(true)
    // Alice belongs to the writers, but holds no admin option on them.
    expect(roles.roles.find((r) => r.name === role('writer'))?.admits).toBe(false)
    // PostgreSQL's ADMIN OPTION is what lets her admit others.
    await admin.query(`GRANT ${ident(role('writer'))} TO ${ident(role('alice'))} WITH ADMIN OPTION`)
    try {
      const withOption = await as('alice', page.roles)
      expect(withOption.roles.find((r) => r.name === role('writer'))?.admits).toBe(true)
    } finally {
      await admin.query(
        `REVOKE ADMIN OPTION FOR ${ident(role('writer'))} FROM ${ident(role('alice'))} CASCADE`
      )
    }
    // An operator may administer every role.
    await admin.query(`GRANT platform_admins TO ${ident(role('owner'))}`)
    try {
      const operator = await as('owner', page.roles)
      expect(operator.roles.every((r) => r.admits)).toBe(true)
    } finally {
      await admin.query(`REVOKE platform_admins FROM ${ident(role('owner'))}`)
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
        page.updateRecord(db, 'newsroom', 'articles', aliceId, { title }, v)
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
describe('audit and the page’s client', () => {
  test('SQL and the page’s client both produce revisions stamped with the real login', async () => {
    await alice.query("INSERT INTO newsroom.articles(title) VALUES ('Direct audit')")
    expect(
      await as('alice', (db) =>
        page.insertRecord(db, 'newsroom', 'articles', { title: 'Page audit' })
      )
    ).toBe(1)
    const rows = (
      await owner.query(
        "SELECT actor,after_row FROM platform.activity WHERE table_name='articles' AND after_row->>'title' IN ('Direct audit','Page audit')"
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(
      rows.every((r) => r.actor === role('alice') && r.after_row.created_by === role('alice'))
    ).toBe(true)
    const history = await as('owner', (db) => page.activity(db, { schema: 'newsroom' }))
    expect(history.length).toBeGreaterThan(0)
  })
  test('broad INSERT grants cannot forge system metadata', async () => {
    await owner.query(
      `GRANT INSERT(created_by,updated_by,version) ON newsroom.articles TO ${ident(role('writer'))}`
    )
    try {
      await alice.query(
        'INSERT INTO newsroom.articles(title,created_by,updated_by,version) VALUES($1,$2,$2,999)',
        ['Spoof test', role('bob')]
      )
      const r = (
        await alice.query(
          "SELECT created_by,version FROM newsroom.articles WHERE title='Spoof test'"
        )
      ).rows[0]
      expect(r.created_by).toBe(role('alice'))
      expect(r.version).toBe('1')
    } finally {
      await owner.query(
        `REVOKE INSERT(created_by,updated_by,version) ON newsroom.articles FROM ${ident(role('writer'))}`
      )
    }
  })
  test('readers cannot read full revisions, forge logs or disable audit triggers', async () => {
    expect((await alice.query('SELECT * FROM platform.activity')).rows).toEqual([])
    expect(await as('alice', (db) => page.activity(db, { schema: 'newsroom' }))).toEqual([])
    for (const s of [
      'DELETE FROM platform.activity',
      'TRUNCATE platform.activity',
      "INSERT INTO platform.activity(actor) VALUES('forged')",
      'ALTER TABLE newsroom.articles DISABLE TRIGGER platform_audit',
      "SET session_replication_role='replica'",
    ])
      await deny(alice, s)
  })
  test('rollbacks leave no committed audit entry', async () => {
    await alice.query(
      "BEGIN; INSERT INTO newsroom.articles(title) VALUES ('Rolled back'); ROLLBACK"
    )
    expect(
      (await owner.query("SELECT 1 FROM platform.activity WHERE after_row->>'title'='Rolled back'"))
        .rowCount
    ).toBe(0)
  })
  test('DELETE and TRUNCATE are recorded', async () => {
    await owner.query("SELECT platform.create_collection('newsroom','disposable')")
    await owner.query(
      'INSERT INTO newsroom.disposable DEFAULT VALUES; DELETE FROM newsroom.disposable; TRUNCATE newsroom.disposable'
    )
    const ops = (
      await owner.query(
        "SELECT operation FROM platform.activity WHERE table_name='disposable' ORDER BY id"
      )
    ).rows.map((r) => r.operation)
    expect(ops).toEqual(['INSERT', 'DELETE', 'TRUNCATE'])
  })
  test('SQL accepts one statement and binds values safely', async () => {
    await as('alice', async (db) => {
      expect(await refusal(page.run(db, 'SELECT 1; SELECT 2'))).toBe('42601')
      const r = await db.query('SELECT $1::text AS v', ["'; DROP TABLE newsroom.articles;--"])
      expect(r.rows[0]?.v).toContain('DROP TABLE')
    })
  })
  test('the state of one session never leaks into another', async () => {
    await as('alice', async (db) => {
      await page.run(db, `SET ROLE ${ident(role('reader'))}`)
      expect((await page.identity(db)).effective_role).toBe(role('reader'))
    })
    expect((await as('alice', page.identity)).effective_role).toBe(role('alice'))
  })
})

describe('additional database boundaries', () => {
  test('WITH CHECK rejects inserts and row transitions through SQL and the page’s client', async () => {
    await owner.query(`CREATE POLICY draft_only ON newsroom.articles AS RESTRICTIVE
      FOR ALL TO ${ident(role('writer'))} USING (true) WITH CHECK (title NOT LIKE 'Denied%')`)
    try {
      await deny(alice, "INSERT INTO newsroom.articles(title) VALUES ('Denied SQL')")
      await as('alice', async (db) => {
        expect(
          await refusal(page.insertRecord(db, 'newsroom', 'articles', { title: 'Denied page' }))
        ).toBe('42501')
        expect(
          await refusal(
            page.updateRecord(db, 'newsroom', 'articles', aliceId, { title: 'Denied update' })
          )
        ).toBe('42501')
      })
      expect(
        (await alice.query('SELECT title FROM newsroom.articles WHERE id=$1', [aliceId])).rows[0]
          .title
      ).not.toBe('Denied update')
    } finally {
      await owner.query('DROP POLICY draft_only ON newsroom.articles')
    }
  })
  test('RLS without a matching INSERT policy denies writes despite table grants', async () => {
    await owner.query(`GRANT INSERT(title) ON newsroom.articles TO ${ident(role('blind'))}`)
    const q = await connect('blind')
    try {
      await deny(q, "INSERT INTO newsroom.articles(title) VALUES ('No policy')")
      expect(
        await as('blind', (db) =>
          refusal(page.insertRecord(db, 'newsroom', 'articles', { title: 'No policy' }))
        )
      ).toBe('42501')
    } finally {
      await q.end()
    }
  })
  test('typed relation builders create database foreign keys immediately', async () => {
    const children = await collectionStatements('newsroom', 'children', '', [
      field({ name: 'parent', type: 'relation', relation: 'tasks', onDelete: 'restrict' }),
    ])
    await as('owner', (db) => runAll(db, children))
    expect(
      await as('owner', (db) =>
        refusal(page.insertRecord(db, 'newsroom', 'children', { parent: crypto.randomUUID() }))
      )
    ).toBe('23503')
  })
  test('installer refuses existing sys schemas before making changes', async () => {
    await admin.query('BEGIN; CREATE SCHEMA sys')
    try {
      await deny(
        admin,
        readFileSync(new URL('../migrations/0001_native.sql', import.meta.url), 'utf8'),
        'P0001'
      )
    } finally {
      await admin.query('ROLLBACK')
    }
    expect((await admin.query("SELECT to_regnamespace('sys') AS n")).rows[0].n).toBeNull()
  })
  test('audit visibility remains valid after an old workspace owner is dropped', async () => {
    await admin.query(`GRANT CREATE ON DATABASE ${ident(dbName)} TO ${ident(role('retired'))}`)
    const q = await connect('retired')
    try {
      await q.query(
        "CREATE SCHEMA retired_workspace; SELECT platform.create_collection('retired_workspace','records'); INSERT INTO retired_workspace.records DEFAULT VALUES; DROP SCHEMA retired_workspace CASCADE"
      )
    } finally {
      await q.end()
    }
    await admin.query(`REVOKE CREATE ON DATABASE ${ident(dbName)} FROM ${ident(role('retired'))}`)
    await admin.query(`DROP ROLE ${ident(role('retired'))}`)
    for (const name of ['owner', 'alice'])
      await as(name, async (db) => {
        for (const schema of ['retired_workspace', 'newsroom'])
          expect(Array.isArray(await page.activity(db, { schema }))).toBe(true)
        // The whole history the reader may see is still readable, with its row security.
        await page.run(db, 'SELECT * FROM platform.activity')
      })
  })
})

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
  const apply = (raw: unknown) => transaction(admin, () => applyManifest(admin, raw))
  test('one manifest provisions users, groups, a workspace, grants and policies, and repeats as a no-op', async () => {
    const first = await apply(manifest())
    expect(first.changes).toContain(`create user ${role('ap_ann')}`)
    expect(first.changes).toContain(`create workspace desk owned by ${role('ap_admin')}`)
    expect(first.changes).toContain('create collection desk.notes')
    expect(first.changes).toContain(`make ${role('ap_admin')} an administrator`)
    expect(await apply(manifest())).toMatchObject({ changes: [] })
    const owned = await admin.query(
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
    const ghost = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role('ap_ghost')])
    expect(ghost.rowCount).toBe(0)
    const made = await apply({ users: [...manifest().users, { name: role('ap_new') }] })
    expect(made.changes).toEqual([
      `create user ${role('ap_new')}`,
      `add ${role('ap_new')} to platform_users`,
    ])
    await (await connect('ap_new')).end()
    const secrets = await admin.query(
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
  test('CLI applies model files and manifests to a deployment, and a dry run leaves it untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'platform-apply-'))
    const file = join(dir, 'team.json')
    writeFileSync(join(dir, 'not-json'), 'plain text\n')
    writeFileSync(file, JSON.stringify({ users: [{ name: role('ap_cli') }] }))
    const run = async (args: string[], operator?: Record<string, string>) => {
      const child = Bun.spawn([process.execPath, 'packages/cli/src/cli.ts', 'apply', ...args], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH,
          ...cliEnv,
          ...(operator ?? {
            PGUSER: decodeURIComponent(url.username),
            PGPASSWORD: decodeURIComponent(url.password),
          }),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      return { code: await child.exited, output, error }
    }
    try {
      const dry = await run(['k8s', 'deploy/models/crm.json', file, '--dry-run'])
      expect(dry).toMatchObject({ code: 0, error: '' })
      expect(dry.output).toContain(`~ create user ${role('ap_cli')}`)
      expect(dry.output).toContain('Dry run: nothing was changed.')
      const real = await run(['k8s', file])
      expect(real.output).toContain(`+ create user ${role('ap_cli')}`)
      expect(real.output).toContain('2 changed, 0 already in place.')
      await (await connect('ap_cli')).end()
      expect((await run(['k8s', file])).output).toContain('0 changed, 2 already in place.')
      expect(await run(['staging', file])).toMatchObject({ code: 1 })
      expect((await run(['k8s', join(dir, 'not-json')])).code).toBe(1)
      // A person acts through the CLI with a token, and with nothing but their own rights.
      // A manifest about themselves converges; one about somebody else needs an operator.
      const own = join(dir, 'own.json')
      writeFileSync(own, JSON.stringify({ users: [{ name: role('alice') }] }))
      const asAlice = await run(['k8s', own], { PGTOKEN: issuer.mint(role('alice')) })
      expect(asAlice.output).toContain('0 changed, 2 already in place.')
      const more = join(dir, 'more.json')
      writeFileSync(more, JSON.stringify({ users: [{ name: role('ap_denied') }] }))
      const denied = await run(['k8s', more], { PGTOKEN: issuer.mint(role('alice')) })
      expect(denied).toMatchObject({ code: 1 })
      expect(denied.error).toContain('permission denied')
    } finally {
      await root.query(`DROP ROLE IF EXISTS ${ident(role('ap_cli'))}`)
      rmSync(dir, { recursive: true })
    }
  })
})

test('CLI installs a new database at 2.1.0 and safely repeats the installation', async () => {
  const name = dbName + '_cli'
  await root.query(`CREATE DATABASE ${ident(name)}`)
  try {
    for (let i = 0; i < 2; i++) {
      const child = Bun.spawn([process.execPath, 'packages/cli/src/cli.ts', 'migrate'], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH,
          APP_ENV: 'test',
          DATABASE_HOST: url.hostname,
          DATABASE_PORT: url.port || '5432',
          DATABASE_NAME: name,
          DATABASE_SSL: cliEnv.DATABASE_SSL,
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      expect(error).toBe('')
      expect(await child.exited).toBe(0)
      expect(output).toContain(
        i === 0
          ? 'Installed PostgreSQL-native platform version 2.1.0'
          : 'Already installed at version 2.1.0'
      )
    }
  } finally {
    await root.query(`DROP DATABASE ${ident(name)} WITH(FORCE)`)
  }
})
