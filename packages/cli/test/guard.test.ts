import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { ROOT } from '../src/site.ts'
import platform from '../../../migrations/0001_platform.sql' with { type: 'text' }

/** The guard: what an ordinary role may not do to a collection's row security. */

describe('the guard', () => {
  test('harden installs it, and a collection keeps its row security, and its history', async () => {
    // The database of its own: the socket server logs every connection in as its superuser,
    // so the guard is exercised here against a session that is somebody else.
    const pg = await PGlite.create()
    await pg.exec(platform)
    await pg.exec(`CREATE ROLE "alice@example.com" LOGIN;
GRANT platform_users TO "alice@example.com";
CREATE SCHEMA alice_ws AUTHORIZATION "alice@example.com";
CREATE SCHEMA operator_ws AUTHORIZATION postgres;`)
    // The operator's own way of installing it.
    const server = new PGLiteSocketServer({ db: pg, port: 54413, host: '127.0.0.1' })
    await server.start()
    const child = Bun.spawn(
      ['bun', join(ROOT, 'packages/cli/src/cli.ts'), 'harden', 'k8s', '--events'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_HOST: '127.0.0.1',
          DATABASE_PORT: '54413',
          DATABASE_NAME: 'postgres',
          DATABASE_SSL: 'disable',
          PGTOKEN: `e30.${Buffer.from(JSON.stringify({ email: 'postgres' })).toString('base64url')}.sig`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )
    const [out, err] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(await child.exited).toBe(0)
    expect(out + err).toContain('installed the guard')
    await server.stop()
    const installed = await pg.query<{ evtname: string }>(
      "SELECT evtname FROM pg_event_trigger WHERE evtname LIKE 'platform_guard%' ORDER BY evtname"
    )
    expect(installed.rows.map((r) => r.evtname)).toEqual([
      'platform_guard_ddl',
      'platform_guard_drop',
    ])
    // An operator may: the guard is there for the ordinary roles.
    await pg.exec("SELECT platform.create_collection('operator_ws','notes');")
    await pg.exec('ALTER TABLE operator_ws.notes DISABLE ROW LEVEL SECURITY;')
    // Alice owns a collection of her own.
    await pg.query('SET SESSION AUTHORIZATION "alice@example.com"')
    await pg.exec("SELECT platform.create_collection('alice_ws','notes');")
    // She owns it, and may change it as she likes: a field added.
    await pg.exec('ALTER TABLE alice_ws.notes ADD COLUMN body text;')
    // She may not turn its row security off, nor drop the triggers that write its history.
    const off = await pg
      .exec('ALTER TABLE alice_ws.notes DISABLE ROW LEVEL SECURITY;')
      .catch((e) => e)
    expect(off?.message).toContain('not yours to turn off')
    const drop = await pg.exec('DROP TRIGGER platform_audit ON alice_ws.notes;').catch((e) => e)
    expect(drop?.message).toContain('not yours to drop')
    const still = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'notes' AND relnamespace = 'alice_ws'::regnamespace"
    )
    expect(still.rows[0]?.relrowsecurity).toBe(true)
  }, 120000)
})
