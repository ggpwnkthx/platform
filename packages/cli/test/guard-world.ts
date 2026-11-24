import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * The guard and the hardening, installed as the superuser from the files psql runs, then met
 * by ordinary roles in the same PostgreSQL. Every way round a guard that reads the statement's
 * text is here.
 */
export const ROOT = join(import.meta.dir, '../../..')
export const sql = (file: string) => Bun.file(join(ROOT, 'deploy/sql', file)).text()
export const alice = '"alice@example.com"'
export let pg: PGlite

/** Runs as someone: PGlite holds one session, so it becomes them, and the superuser again after. */
export const as = async (role: string, sql: string) => {
  await pg.query(`SET SESSION AUTHORIZATION ${role}`)
  try {
    return await pg.exec(sql).then(
      () => 'done',
      (error: Error & { code?: string }) => `${error.code}: ${error.message}`
    )
  } finally {
    await pg.query('RESET SESSION AUTHORIZATION')
    await pg.query('SET SESSION AUTHORIZATION postgres')
  }
}
export const one = async <T>(sql: string) => (await pg.query<T>(sql)).rows[0] as T
export const state = () =>
  one<{
    rls: boolean
    force: boolean
    enabled: string
  }>(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
     (SELECT string_agg(t.tgenabled::text, '' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS enabled
     FROM pg_class c WHERE c.oid = 'alice_ws.notes'::regclass`)

/** A PostgreSQL with the platform, the hardening and the guard, and a collection alice owns. */
export async function guarded() {
  pg = await PGlite.create()
  await pg.exec(await Bun.file(join(ROOT, 'migrations/0001_platform.sql')).text())
  await pg.exec(`CREATE ROLE ${alice} LOGIN; GRANT platform_users TO ${alice};
    CREATE ROLE "ops@example.com" LOGIN; GRANT platform_users, platform_admins TO "ops@example.com";
    CREATE SCHEMA alice_ws AUTHORIZATION ${alice};
    GRANT USAGE, CREATE ON SCHEMA alice_ws TO "ops@example.com";`)
  for (const file of ['harden.sql', 'guard.sql']) await pg.exec(await sql(file))
  await as(
    alice,
    "SELECT platform.create_collection('alice_ws', 'notes'); ALTER TABLE alice_ws.notes FORCE ROW LEVEL SECURITY;"
  )
}
