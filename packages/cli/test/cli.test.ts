import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { hardenSql } from '../src/database/doctor.ts'
import { addresses, ensureSettings } from '../src/deploy/settings.ts'
import { renderKubernetes } from '../src/deploy/kubernetes.ts'
import { readApplied, ROOT, siteFiles } from '../src/site.ts'

describe('a deployment', () => {
  const pieces = {
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
        ...pieces,
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
      addresses('k8s', { ...pieces, PLATFORM_PUBLIC_URL: 'https://www.example.com' })
    ).toMatchObject({
      issuer: 'https://idp.platform.example.com',
      relay: 'wss://api.platform.example.com',
      site: 'https://www.example.com',
      siteFolder: null,
    })
  })
  const options = {
    image: 'registry.example.com/platform-relay:2.3.0',
    publicUrl: 'https://platform.example.com',
    oidcIssuer: 'https://idp.platform.example.com',
    databaseHost: 'db.platform.example.com',
    databasePort: '5432',
    namespace: 'platform',
  }
  test('a first run writes down what it settled, with a secret, for its owner alone', async () => {
    const file = `/tmp/platform-settings-${process.pid}.env`
    const first = await ensureSettings('local', {}, {}, file)
    expect(first).toMatchObject({
      PLATFORM_DOMAIN: 'localhost',
      PLATFORM_ADMIN: 'admin@localhost',
      EDGE_PORT: '8080',
    })
    expect(first.PLATFORM_ADMIN_PASSWORD?.length).toBeGreaterThan(20)
    expect((await Bun.file(file).stat()).mode & 0o777).toBe(0o600)
    // What is saved is kept; what the command line gives wins.
    const again = await ensureSettings('local', { PLATFORM_DOMAIN: 'platform.test' }, {}, file)
    expect(again.PLATFORM_ADMIN_PASSWORD).toBe(first.PLATFORM_ADMIN_PASSWORD)
    expect(again.PLATFORM_DOMAIN).toBe('platform.test')
    await expect(ensureSettings('local', { EDGE_PORT: 'eighty' }, {}, file)).rejects.toThrow(
      'EDGE_PORT'
    )
    await expect(ensureSettings('k8s', {}, {}, `${file}.k8s`)).rejects.toThrow(
      'PLATFORM_DOMAIN is required'
    )
    await Bun.file(file).delete()
  })
  test('the Kubernetes manifests carry the image, the namespace, the upstream and the one origin', () => {
    const manifest = renderKubernetes(options)
    expect(manifest).toContain('image: registry.example.com/platform-relay:2.3.0')
    expect(manifest).toContain('{ name: RELAY_UPSTREAM, value: "db.platform.example.com:5432" }')
    expect(manifest).toContain('{ name: RELAY_ORIGINS, value: "https://platform.example.com" }')
    expect(manifest.match(/namespace: platform/g)).toHaveLength(2)
    expect(manifest).not.toContain('YOUR_')
  })
  test('they are refused for a site in the clear, or an image nobody built', () => {
    expect(() =>
      renderKubernetes({ ...options, publicUrl: 'http://platform.example.com' })
    ).toThrow('HTTPS')
    expect(() =>
      renderKubernetes({ ...options, image: 'YOUR_REGISTRY/platform-relay:2.3.0' })
    ).toThrow('image')
    expect(() => renderKubernetes({ ...options, namespace: 'Not_A_Namespace' })).toThrow()
  })
  test('hardening hides the role catalogs, keeps names when asked, and can be undone', () => {
    expect(hardenSql('strict')).toContain('REVOKE SELECT ON pg_auth_members FROM PUBLIC;')
    expect(hardenSql('strict')).not.toContain('rolname')
    expect(hardenSql('keep-names')).toContain('GRANT SELECT (oid, rolname) ON pg_roles TO PUBLIC;')
    expect(hardenSql('restore')).toBe(
      'GRANT SELECT ON pg_auth_members, pg_roles, pg_user TO PUBLIC;'
    )
  })
})

describe('a site folder', () => {
  const newsroom = join(ROOT, 'examples/newsroom')
  test('says what it applies and names its extensions in platform.json', async () => {
    expect(siteFiles(newsroom)).toEqual({
      extensions: join(newsroom, 'extensions.tsx'),
      apply: {
        models: join(newsroom, 'apply/models.ts'),
        migration: join(newsroom, 'apply/migration.sql'),
        demo: join(newsroom, 'apply/demo.sql'),
      },
    })
    expect(siteFiles(join(ROOT, 'docs'))).toBeNull()
    const applied = await readApplied(newsroom)
    expect(typeof applied.models).toBe('function')
    expect(applied.demo).toContain('INSERT INTO newsroom.sections')
  })
})

/** The commands themselves, run as an operator would run them, against a PostgreSQL of their own. */
describe('the database commands', () => {
  let server: PGLiteSocketServer
  const token = (email: string) =>
    `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.sig`
  const cli = async (...args: string[]) => {
    const child = Bun.spawn(['bun', join(ROOT, 'packages/cli/src/cli.ts'), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: '54412',
        DATABASE_NAME: 'postgres',
        DATABASE_SSL: 'disable',
        PGTOKEN: token('postgres'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code: await child.exited, out: out + err }
  }
  beforeAll(async () => {
    server = new PGLiteSocketServer({ db: await PGlite.create(), port: 54412, host: '127.0.0.1' })
    await server.start()
  })
  afterAll(() => server.stop())

  test('migrate installs once; apply converges, and a dry run changes nothing', async () => {
    expect((await cli('migrate')).out).toContain(
      'Installed PostgreSQL-native platform version 2.3.0'
    )
    expect((await cli('migrate')).out).toContain('Already installed at version 2.3.0')
    const dry = await cli('apply', 'k8s', '--dir=examples/newsroom', '--dry-run')
    expect(dry.out).toContain('~ create workspace newsroom owned by admin@example.com')
    expect(dry.out).toContain('Dry run: nothing was changed.')
    const first = await cli('apply', 'k8s', '--dir=examples/newsroom')
    expect(first.out).toContain('+ write the records and the history of the demonstration')
    const again = await cli('apply', 'k8s', '--dir=examples/newsroom')
    expect(again.out).toContain('0 changed')
    expect(again.out).toContain('demo.sql was not run')
  }, 60000)

  test('a manifest that does not parse says where; a command with no token says how to get one', async () => {
    await Bun.write('/tmp/platform-bad-manifest.json', JSON.stringify({ users: [{ nam: 'x' }] }))
    const bad = await cli('apply', 'k8s', '/tmp/platform-bad-manifest.json')
    expect(bad.code).toBe(1)
    expect(bad.out).toContain('at users[0]')
    const child = Bun.spawn(['bun', join(ROOT, 'packages/cli/src/cli.ts'), 'doctor'], {
      env: { ...process.env, PGTOKEN: '', DATABASE_HOST: '127.0.0.1' },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    expect(await new Response(child.stderr).text()).toContain('PGTOKEN or PGTOKEN_FILE is required')
  }, 30000)

  test('doctor reports a server that lets logins in without a token; lock takes a login away', async () => {
    const report = await cli('doctor')
    expect(report.code).toBe(1)
    expect(report.out).toContain('lets logins in without a token')
    expect((await cli('lock', 'alice@example.com')).out).toContain('can no longer log in')
    expect((await cli('unlock', 'alice@example.com')).out).toContain(
      'may log in again, with a token'
    )
    expect((await cli('lock', 'postgres')).out).toContain('the role this command is signed in as')
  }, 30000)
})
