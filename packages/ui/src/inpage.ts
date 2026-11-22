import { PGlite } from '@electric-sql/pglite'
import {
  type Applied,
  applyFolder,
  type Db,
  ident,
  manifestOf,
  parseManifest,
  transaction,
} from '@platform/core'
import { fromPglite, pgliteParsers } from '@platform/core/pglite'
import type { Session } from './connect.ts'
import type { InPage, Person } from './session.tsx'

/**
 * The dev mode: PostgreSQL 18 inside the page (PGlite), installed with the real migration and
 * with what the site's folder applies, as a deployment installs them. The page is the identity
 * provider here: choosing a person makes the one session theirs, and every grant, row policy
 * and trigger applies to them as it would on a server. It is never part of a published build.
 */
export function inPage(platform: string, applied: Applied): InPage {
  const prefix = 'platform-dev-'
  const boot = async () => {
    // What is installed names the database, so a change to any of it starts a fresh one.
    const said = [platform, JSON.stringify(manifestOf(applied)), applied.migration, applied.demo]
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(said.join('\0')))
    const key =
      prefix +
      [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32)
    const options = { parsers: pgliteParsers }
    const pg = await PGlite.create(`idb://${key}`, options).catch(() => PGlite.create(options))
    for (const { name } of await indexedDB.databases().catch(() => []))
      if (name?.includes(`/${prefix}`) && !name.endsWith(`/${key}`)) indexedDB.deleteDatabase(name)
    const db = fromPglite(pg)
    const found = await db.query(`SELECT to_regclass('platform.installation') IS NOT NULL AS found`)
    if (!found.rows[0]?.found)
      await transaction(db, async () => {
        await pg.exec(platform)
        await applyFolder(db, applied)
      })
    return pg
  }
  let booted: Promise<PGlite> | null = null
  return {
    people: peopleOf(manifestOf(applied)),
    notice: 'PostgreSQL runs inside this page, with the site installed. Choose who to be.',
    async open(role): Promise<Session> {
      booted ??= boot()
      const pg = await booted
      await pg.query('RESET SESSION AUTHORIZATION')
      await pg.query(`SET SESSION AUTHORIZATION ${ident(role)}`)
      const db: Db = fromPglite(pg)
      // There is one session, so everything takes its turn on it.
      let turn: Promise<unknown> = Promise.resolve()
      const exclusive = <T>(work: (db: Db) => Promise<T>) => {
        const result = turn.then(() => work(db))
        turn = result.catch(() => undefined)
        return result
      }
      return {
        query: (text, params) => exclusive((one) => one.query(text, params)),
        exclusive,
        own: exclusive,
        close: async () => undefined,
      }
    },
  }
}

const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
/** The people of the example, and what the manifest says each may do. */
function peopleOf(models: unknown): Person[] {
  const manifest = parseManifest(models)
  const owned = (owner: string) =>
    manifest.workspaces.filter((w) => w.owner === owner).map((w) => w.slug)
  return manifest.users
    .filter((user) => user.state === 'present' && user.login)
    .map((user) => {
      const groups = user.groups.map((group) =>
        owned(group).length ? `${group} (owns ${listed(owned(group))})` : group
      )
      const says = [
        ...(owned(user.name).length ? [`owns ${listed(owned(user.name))}`] : []),
        ...(user.admin ? ['administers roles'] : []),
        ...(groups.length ? [`is in ${listed(groups)}`] : []),
      ].join(', ')
      return {
        role: user.name,
        note: says ? says[0]!.toUpperCase() + says.slice(1) : 'In no group',
      }
    })
}
