import type pg from 'pg'
import {
  collectionTarget,
  fieldTarget,
  ident,
  workspaceTarget,
} from '../packages/vocabulary/src/index.ts'
import { metadata } from '../packages/data/src/metadata/query.ts'
import type { Connection } from '../packages/pg-client/src/wire.ts'
import { adminUrl } from './administrator.ts'
import { prefix, world, type World } from './world.ts'

/**
 * The world the metadata tests are written against: a workspace of their own, its owner, and
 * the readers of it. Every test file that asks for it has one of its own.
 */

const roles = ['owner', 'reader', 'writer', 'blind', 'outsider']
export let w: World
export let owner: pg.Client
export let reader: pg.Client

/** A direct connection, as psql would make it: the role, and a token that names it. */
const connect = (name: string) => w.connect(name)

/** The name of a role in this world: one person among the others. */
export const role = (name: string) => w.role(name)

/** Runs some work in the page's client as this person, then signs them out. */
export const as = <T>(name: string, work: (db: Connection) => Promise<T>) => w.as(name, work)

/** The metadata of the newsroom workspace, or of its articles collection. */
export const workspace = (db: Connection) => metadata(db, workspaceTarget('newsroom'))
export const collection = (db: Connection) => metadata(db, collectionTarget('newsroom', 'articles'))

/** The metadata of one field of the articles collection. */
export const field = (db: Connection, column: string) =>
  metadata(db, fieldTarget('newsroom', 'articles', column))

/** The keys of the entries given, in the order they are given. */
export const keys = (entries: { key: string }[]) => entries.map((one) => one.key)

/** Makes the world the metadata tests are written against. */
export async function setup(): Promise<void> {
  w = await world(prefix('m'), adminUrl)
  await w.makeRoles(roles)
  owner = await connect('owner')
  reader = await connect('reader')
  // A workspace is made with CREATE on the database, so the owner holds it.
  await w.admin.query(`GRANT CREATE ON DATABASE ${ident(w.dbName)} TO ${ident(w.role('owner'))}`)
  // The owner builds the workspace and its collection, so it owns both.
  await owner.query(
    "CREATE SCHEMA newsroom; SELECT platform.create_collection('newsroom','articles')"
  )
  await owner.query('ALTER TABLE newsroom.articles ADD COLUMN title text')
  // A second column that nobody is granted: the field nobody may reach.
  await owner.query('ALTER TABLE newsroom.articles ADD COLUMN summary text')
  await owner.query(
    `GRANT USAGE ON SCHEMA newsroom TO ${['reader', 'writer', 'blind'].map((n) => ident(w.role(n))).join(',')}`
  )
  // A reader of one column of the collection, a writer of rows, and a reader of the
  // workspace alone.
  await owner.query(`GRANT SELECT (id,title) ON newsroom.articles TO ${ident(w.role('reader'))}`)
  await owner.query(`GRANT INSERT (title) ON newsroom.articles TO ${ident(w.role('writer'))}`)
}

/** Closes the world, and takes its database with it. */
export async function teardown(): Promise<void> {
  await Promise.all([owner?.end(), reader?.end()])
  if (w) await w.drop(roles)
}
