import { expect } from 'bun:test'
import type pg from 'pg'
import { ident } from '../packages/vocabulary/src/index.ts'
import { emptyField, type FieldDraft } from '../packages/ui/src/model/statements.ts'
import * as pageCatalog from '../packages/data/src/catalog/query.ts'
import * as pageContent from '../packages/data/src/content/query.ts'
import { transaction as pageTransaction } from '../packages/vocabulary/src/index.ts'
import type { Connection } from '../packages/pg-client/src/wire.ts'
import { adminUrl } from './administrator.ts'
import { prefix, world, type World } from './world.ts'

/**
 * The world the platform's own tests are written against: a database of their own, the roles
 * in it, and the collections they are given. Every test file that asks for it has one of its
 * own, so that a file may be run on its own.
 */

export let w: World
export let owner: pg.Client
export let alice: pg.Client
export let bob: pg.Client
export let aliceId: string
export let bobId: string

/** The name of a role in this world: one person among the others. */
export const role = (name: string) => w.role(name)

// The test server is started trusting this issuer: see docs/operations.md.
export const issuerUrl = process.env.TEST_OIDC_ISSUER ?? 'http://127.0.0.1:54330'

/** The address the test database is reached at. */
export const url = new URL(adminUrl)

const roleNames = [
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
const appliedRoles = ['ap_admin', 'ap_ann', 'ap_editors', 'ap_new']

/** What the CLI reads from its environment to reach the test database. */
export const cliEnv: Record<string, string> = {
  APP_ENV: 'test',
  OIDC_ISSUER: issuerUrl,
  DATABASE_HOST: url.hostname,
  DATABASE_PORT: url.port || '5432',
  DATABASE_NAME: '',
  DATABASE_SSL: process.env.TEST_DATABASE_SSL ?? 'disable',
}

/** The issuer whose tokens the roles sign in with. */
export const issuer = () => w.issuer

/** A direct connection, as psql would make it: the role, and a token that names it. */
export const connect = (name: string, token?: string) => w.connect(name, token)

/** The page's own client, signed in as this person with a token the issuer minted for them. */
export const signIn = (name: string, token?: string) => w.signIn(name, token)

/** Runs some work in the page's client as this person, then signs them out. */
export async function as<T>(name: string, work: (db: Connection) => Promise<T>): Promise<T> {
  return w.as(name, work)
}

/** The columns of a collection this reader may read, as the catalog reports them. */
export async function readable(db: Connection, schema: string, table: string) {
  const { columns } = await pageCatalog.catalog(db)
  return columns
    .filter((c) => c.schema === schema && c.table === table && c.can_select)
    .map((c) => c.name)
}

/** One page of records, as the records screen asks for it. */
export const recordsOf = (
  db: Connection,
  table: string,
  query: Partial<pageContent.RecordQuery> = {}
) =>
  pageContent.records(db, {
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
export const runAll = (db: Connection, statements: string[]) =>
  pageTransaction(db, async () => {
    for (const statement of statements) await db.query(statement)
  })

/** A field as a draft: the platform's own, with what the test changes. */
export const field = (draft: Partial<FieldDraft> & Pick<FieldDraft, 'name'>): FieldDraft => ({
  ...emptyField(),
  ...draft,
})

/** Runs a statement the database must refuse, and says what it refused it with. */
export async function deny(q: pg.Client, text: string, code = '42501') {
  try {
    await q.query(text)
    throw new Error('Expected PostgreSQL denial')
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code)
  }
}

/** Makes the world the tests are written against. */
export async function setup(): Promise<void> {
  w = await world(prefix('t'), adminUrl)
  cliEnv.DATABASE_NAME = w.dbName
  await w.makeRoles(roleNames, (n) => !['writer', 'reader'].includes(n))
  await w.admin.query(`GRANT CREATE ON DATABASE ${ident(w.dbName)} TO ${ident(w.role('owner'))}`)
  await w.admin.query(
    `GRANT ${ident(w.role('writer'))},${ident(w.role('reader'))} TO ${ident(w.role('alice'))},${ident(w.role('bob'))}`
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
}

/** Closes the world, and takes its database with it. */
export async function teardown(): Promise<void> {
  await Promise.all([owner?.end(), alice?.end(), bob?.end()])
  if (w) await w.drop([...roleNames, ...appliedRoles])
}
