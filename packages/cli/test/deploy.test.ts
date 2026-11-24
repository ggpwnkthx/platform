import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { maxLines, overlong, sourceFiles } from '../../../scripts/lines.ts'
import { render } from '../src/k8s.ts'
import { applied } from '../src/local.ts'
import { addresses, ROOT, settle } from '../src/settings.ts'

const text = (path: string) => Bun.file(join(ROOT, path)).text()

describe('a deployment', () => {
  const names = {
    PLATFORM_DOMAIN: 'platform.example.com',
    PLATFORM_IDP_HOST: 'idp',
    PLATFORM_API_HOST: 'api',
    PLATFORM_DB_HOST: 'db',
    PLATFORM_APP_HOST: 'app',
    EDGE_PORT: '8080',
  }
  test('its addresses follow from its domain and sub-domains', () => {
    expect(
      addresses('local', {
        ...names,
        PLATFORM_DOMAIN: 'localhost',
        PLATFORM_SITE: 'examples/newsroom',
      })
    ).toEqual({
      issuer: 'http://idp.localhost:8080',
      relay: 'ws://api.localhost:8080',
      site: 'http://app.localhost:8080',
      database: 'db.localhost',
      siteFolder: join(ROOT, 'examples/newsroom'),
    })
    expect(
      addresses('k8s', { ...names, PLATFORM_PUBLIC_URL: 'https://www.example.com' })
    ).toMatchObject({
      issuer: 'https://idp.platform.example.com',
      relay: 'wss://api.platform.example.com',
      site: 'https://www.example.com',
      siteFolder: null,
    })
  })
  test('a first run writes down what it settled, with a secret, for its owner alone', async () => {
    const file = `/tmp/platform-settings-${process.pid}.env`
    const first = settle('local', {}, {}, file)
    expect(first).toMatchObject({
      PLATFORM_DOMAIN: 'localhost',
      PLATFORM_ADMIN: 'admin@localhost',
      EDGE_PORT: '8080',
    })
    expect(first.PLATFORM_ADMIN_PASSWORD?.length).toBeGreaterThan(20)
    expect((await Bun.file(file).stat()).mode & 0o777).toBe(0o600)
    // What is saved is kept; what the command line gives wins.
    const again = settle('local', { PLATFORM_DOMAIN: 'platform.test' }, {}, file)
    expect(again.PLATFORM_ADMIN_PASSWORD).toBe(first.PLATFORM_ADMIN_PASSWORD)
    expect(again.PLATFORM_DOMAIN).toBe('platform.test')
    expect(() => settle('local', { EDGE_PORT: 'eighty' }, {}, file)).toThrow('EDGE_PORT')
    expect(() => settle('k8s', {}, {}, `${file}.k8s`)).toThrow('PLATFORM_IMAGE is required')
    await Bun.file(file).delete()
  })
  const options = {
    image: 'registry.example.com/platform-relay:3.0.0',
    publicUrl: 'https://platform.example.com',
    database: 'db.platform.example.com:5432',
    namespace: 'platform',
  }
  test('the Kubernetes manifests carry the image, the namespace, the upstream and the one origin', () => {
    const manifest = render(options)
    expect(manifest).toContain('image: registry.example.com/platform-relay:3.0.0')
    expect(manifest).toContain('{ name: RELAY_UPSTREAM, value: "db.platform.example.com:5432" }')
    expect(manifest).toContain('{ name: RELAY_ORIGINS, value: "https://platform.example.com" }')
    expect(manifest.match(/namespace: platform/g)).toHaveLength(2)
    expect(manifest).not.toMatch(/YOUR_|\$\{/)
  })
  test('they are refused for a site in the clear, or an image nobody built', () => {
    expect(() => render({ ...options, publicUrl: 'http://platform.example.com' })).toThrow('https')
    expect(() => render({ ...options, image: 'YOUR_REGISTRY/platform-relay:3.0.0' })).toThrow(
      'image'
    )
    expect(() => render({ ...options, namespace: 'Not_A_Namespace' })).toThrow()
  })
  test('a site folder says which SQL files it applies, in order', () => {
    const newsroom = join(ROOT, 'examples/newsroom')
    expect(applied(newsroom)).toEqual([
      join(newsroom, 'apply/schema.sql'),
      join(newsroom, 'apply/demo.sql'),
    ])
    expect(applied(null)).toEqual([])
  })
})

describe("the operator's SQL files", () => {
  const installed = async (...files: string[]) => {
    const pg = await PGlite.create()
    for (const file of ['migrations/0001_platform.sql', ...files]) await pg.exec(await text(file))
    return pg
  }
  const doctor = async (pg: PGlite) =>
    (await pg.exec(await text('deploy/sql/doctor.sql'))).at(-1)!.rows as {
      finding: string
      said: string
    }[]

  test('doctor says what a deployment has left open, and stops saying it once it is closed', async () => {
    const open = await doctor(await installed())
    const problems = open
      .filter((row) => row.finding === 'problem')
      .map((row) => row.said)
      .join('\n')
    expect(problems).toContain('Every connection reads the role catalogs')
    expect(problems).toContain('No guard on row security')
    const closed = await doctor(await installed('deploy/sql/harden.sql', 'deploy/sql/guard.sql'))
    const left = closed
      .filter((row) => row.finding === 'problem')
      .map((row) => row.said)
      .join('\n')
    expect(left).not.toContain('role catalogs')
    expect(left).not.toContain('No guard')
  }, 60000)

  test('doctor names a rule that lets logins in without a token, and a collection that writes no history', async () => {
    const pg = await installed('examples/newsroom/apply/schema.sql')
    await pg.exec('CREATE TABLE newsroom.loose (id int)')
    const said = (await doctor(pg)).map((row) => `${row.finding}: ${row.said}`).join('\n')
    expect(said).toMatch(
      /problem: (pg_hba.conf rule \d+: .* lets logins in without a token|pg_hba.conf has no oauth rule)/
    )
    expect(said).toContain('No enabled audit trigger, so writes leave no revision: newsroom.loose')
    expect(said).toContain('Owned by a person')
  }, 60000)

  test('restore puts PostgreSQL’s default back', async () => {
    const pg = await installed(
      'deploy/sql/harden.sql',
      'deploy/sql/guard.sql',
      'deploy/sql/restore.sql'
    )
    const open = await pg.query<{ open: boolean; guards: number }>(
      "SELECT has_table_privilege('public', 'pg_catalog.pg_auth_members', 'SELECT') AS open, (SELECT count(*)::int FROM pg_event_trigger WHERE evtname LIKE 'platform_guard%') AS guards"
    )
    expect(open.rows[0]).toEqual({ open: true, guards: 0 })
  }, 60000)

  test('the CRM model installs in a database that holds none', async () => {
    const pg = await installed('deploy/models/crm.sql')
    const tables = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform.catalog_tables WHERE schema = 'crm'"
    )
    expect(tables.rows[0]!.n).toBeGreaterThan(10)
  }, 60000)
})

describe('the files of the repository', () => {
  test('none of them is longer than a file should hold', () => {
    expect(overlong(ROOT)).toEqual([])
    expect(sourceFiles(ROOT).length).toBeGreaterThan(40)
    expect(maxLines).toBe(200)
  })
})
