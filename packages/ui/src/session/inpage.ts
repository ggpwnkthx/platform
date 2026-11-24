import { PGlite } from '@electric-sql/pglite'
import { type Db, ident } from '@platform/core'
import { fromPglite, pgliteParsers } from '@platform/core/pglite'
import type { Session } from './connect.ts'

export interface Person {
  role: string
  note: string
}
export interface InPage {
  notice: string
  people(): Promise<Person[]>
  open(role: string): Promise<Session>
}

/**
 * The dev mode: PostgreSQL 18 inside the page (PGlite), installed with the real migration and
 * the SQL files the site's folder applies. The page is the identity provider here: choosing a
 * person makes the one session theirs, and every grant, row policy and trigger applies to
 * them as it would on a server. It is never part of a published build.
 */
export function inPage(files: string[]): InPage {
  const prefix = 'platform-dev-'
  const boot = async () => {
    // What is installed names the database, so a change to any of it starts a fresh one.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(files.join('\0')))
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
    const found = await pg.query<{ found: boolean }>(
      `SELECT to_regclass('platform.installation') IS NOT NULL AS found`
    )
    if (!found.rows[0]?.found)
      await pg.transaction(async (tx) => void (await tx.exec(files.join('\n'))))
    // The people who may sign in are the roles that may: read once, as the server's own user.
    const people = await pg.query<Person>(
      `SELECT r.rolname::text AS role,
              coalesce(nullif(concat_ws(', ',
                (SELECT 'owns ' || string_agg(n.nspname, ' and ' ORDER BY 1) FROM pg_namespace n WHERE n.nspowner = r.oid),
                CASE WHEN r.rolcreaterole THEN 'administers roles' END,
                (SELECT 'is in ' || string_agg(g.rolname, ', ' ORDER BY 1) FROM pg_auth_members m
                   JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid AND g.rolname !~ '^platform_')), ''),
                'in no group') AS note
         FROM pg_roles r
        WHERE r.rolcanlogin AND NOT r.rolsuper AND pg_has_role(r.oid, 'platform_users', 'MEMBER')
        ORDER BY r.rolcreaterole DESC, 1`
    )
    return { pg, people: people.rows }
  }
  let booted: ReturnType<typeof boot> | null = null
  const start = () => {
    booted ??= boot()
    return booted
  }
  return {
    notice: 'PostgreSQL runs inside this page, with the site installed. Choose who to be.',
    people: async () => (await start()).people,
    async open(role): Promise<Session> {
      const { pg } = await start()
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
      // The reader's own statements leave nothing of their session behind, as a login of their
      // own would not: a statement that left the session someone else's is undone and refused,
      // and DISCARD ALL clears settings, SET ROLE, prepared statements and temporary tables.
      // It is not a full boundary: one DO block may become the superuser and switch back.
      const own: Session['own'] = (work) =>
        exclusive(async (one) => {
          await pg.query('BEGIN')
          try {
            const result = await work(one)
            const still = await pg.query<{ ok: boolean }>(
              `SELECT session_user = $1 AND current_setting('is_superuser') = 'off' AS ok`,
              [role]
            )
            if (!still.rows[0]?.ok)
              throw Object.assign(
                new Error(`${role} may not become another role's session: nothing was kept.`),
                { code: '42501' }
              )
            await pg.query('COMMIT')
            return result
          } finally {
            await pg.query('ROLLBACK')
            await pg.query('DISCARD ALL')
            await pg.query(`SET SESSION AUTHORIZATION ${ident(role)}`)
          }
        })
      return {
        query: (text, params) => exclusive((one) => one.query(text, params)),
        exclusive,
        own,
        close: async () => undefined,
      }
    },
  }
}
