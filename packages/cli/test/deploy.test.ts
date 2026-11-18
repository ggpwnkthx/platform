import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploy, type DeployRuntime, renderKubernetes } from '../src/deployment/index.ts'
import { VERSION } from '../src/version.ts'

type Call = { argv: string[]; options?: Parameters<DeployRuntime['run']>[1] }
function fake(env: Record<string, string | undefined> = {}) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'platform-env-')), '.env')
  const calls: Call[] = []
  const output: string[] = []
  const urls: string[] = []
  const r: DeployRuntime = {
    env,
    envFile,
    which: (name) => name,
    print: (text) => {
      output.push(text)
    },
    run: async (argv, options) => {
      calls.push({ argv, options })
      return 0
    },
    sleep: async () => undefined,
    healthy: async (url) => {
      urls.push(url)
      return true
    },
    hash: async (password) => `hash-of(${password})`,
  }
  return { r, calls, output, urls, envFile }
}
const settings = {
  image: 'registry.example.com/platform:2.0.0',
  publicUrl: 'https://platform.example.com',
  oidcIssuer: 'https://sso.example.com/dex',
  databaseHost: 'db.internal',
  databaseName: 'platform',
  databasePort: '5432',
}
const kenv = {
  PLATFORM_IMAGE: settings.image,
  PUBLIC_URL: settings.publicUrl,
  OIDC_ISSUER: settings.oidcIssuer,
  DATABASE_HOST: settings.databaseHost,
}

describe('version and CLI entry points', () => {
  test('package, database, API expectation and runtime agree on 2.1.0', () => {
    expect(VERSION).toBe('2.1.0')
    expect(
      JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
    ).toBe(VERSION)
    expect(
      readFileSync(new URL('../../../migrations/0001_native.sql', import.meta.url), 'utf8')
    ).toContain("version='2.0.0'")
    expect(
      readFileSync(new URL('../../../migrations/0002_harden_catalogs.sql', import.meta.url), 'utf8')
    ).toContain("version = '2.0.1'")
    expect(
      readFileSync(new URL('../../../migrations/0003_metadata.sql', import.meta.url), 'utf8')
    ).toContain("version = '2.1.0'")
    // The workspace packages carry the same version, so a release is one number everywhere.
    for (const name of ['cli', 'relay', 'ui']) {
      const manifest = JSON.parse(
        readFileSync(new URL(`../../../packages/${name}/package.json`, import.meta.url), 'utf8')
      )
      expect(manifest.version).toBe(VERSION)
    }
  })
  test('deploy help and version run without database credentials or external tools', async () => {
    for (const args of [['--version'], ['deploy', 'help']]) {
      const child = Bun.spawn([process.execPath, 'packages/cli/src/cli.ts', ...args], {
        cwd: new URL('../../..', import.meta.url).pathname,
        env: { PATH: process.env.PATH },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const out = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(out).toContain(args[0] === '--version' ? '2.1.0' : 'platform deploy')
    }
  })
})
describe('local deployment orchestration', () => {
  test('up installs with a one-off credential-bearing process before starting the relay', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'private-secret', RELAY_PORT: '8087' })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const cmds = f.calls.map((c) => c.argv)
    expect(cmds[1]!.slice(-4)).toEqual(['build', 'postgres', 'relay', 'migrate'])
    // The installer's image is built too, so its profile is named for the build.
    expect(cmds[1]).toContain('--profile')
    expect(cmds[2]!.slice(-4)).toEqual(['up', '-d', 'postgres', 'dex'])
    const init = f.calls.find((c) => c.argv.includes('migrate') && c.argv.includes('run'))!
    expect(init.argv).toContain('--rm')
    expect(init.argv).toContain('--no-deps')
    expect(init.argv.slice(-7)).toEqual([
      '-f',
      init.argv.at(-6)!,
      'run',
      '--rm',
      '--no-deps',
      '-T',
      'migrate',
    ])
    expect(init.argv).toContain('--profile')
    expect(init.argv.some((a) => a.includes('='))).toBe(false)
    expect(init.options?.env?.POSTGRES_PASSWORD).toBe('private-secret')
    expect(JSON.stringify(cmds)).not.toContain('private-secret')
    expect(cmds.at(-1)!.slice(-3)).toEqual(['up', '-d', 'relay'])
    // Dex answers before the installer runs; the relay is checked last.
    expect(f.urls).toEqual([
      'http://localhost:5556/dex/.well-known/openid-configuration',
      'http://localhost:8087/health',
    ])
    const stack = readFileSync(
      new URL('../../../deploy/compose/compose.yaml', import.meta.url),
      'utf8'
    )
    const services = (Bun.YAML.parse(stack) as any).services
    // Only the installer is given a password: the relay holds none.
    expect(JSON.stringify(services.relay)).not.toContain('PASS')
    // The interface is a static site, published to a CDN: it is not a container.
    expect(services.ui).toBeUndefined()
    expect(Object.keys(services).sort()).toEqual(['dex', 'migrate', 'postgres', 'relay'])
    // From the relay's network, PostgreSQL takes tokens and nothing else.
    expect(services.postgres.environment.PLATFORM_TOKEN_ONLY_FROM).toBe(
      (Bun.YAML.parse(stack) as any).networks.relay.ipam.config[0].subnet
    )
    expect(stack).not.toContain('postgres:16')
  })
  test('Dex is given hashes of the example people’s passwords, never the passwords', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'secret', ALICE_PASSWORD: 'chosen-by-alice' })
    writeFileSync(f.envFile, 'BOB_PASSWORD=saved-for-bob\n')
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const saved = readFileSync(f.envFile, 'utf8')
    const admin = saved.match(/^PLATFORM_ADMIN_PASSWORD=([A-Za-z0-9_-]{32})$/m)![1]!
    expect(saved).not.toContain('ALICE_PASSWORD')
    expect(saved.match(/BOB_PASSWORD/g)).toHaveLength(1)
    const env = f.calls.at(-1)!.options!.env!
    expect(env.DEX_ADMIN_HASH).toBe(`hash-of(${admin})`)
    expect(env.DEX_ALICE_HASH).toBe('hash-of(chosen-by-alice)')
    expect(env.DEX_BOB_HASH).toBe('hash-of(saved-for-bob)')
    expect(JSON.stringify([f.output, f.calls.map((c) => c.argv)])).not.toContain(admin)
    expect(f.output.at(-1)).toContain('admin@example.com')
    const dex = readFileSync(
      new URL('../../../deploy/compose/compose.yaml', import.meta.url),
      'utf8'
    )
      .split('  dex:')[1]!
      .split('  migrate:')[0]!
    expect(dex).not.toContain('PASSWORD')
  })
  test('installer failure propagates its exit code and prevents the interface starting', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'private-secret' })
    const original = f.r.run
    f.r.run = async (argv, options) => {
      await original(argv, options)
      return argv.includes('migrate') && argv.includes('run') ? 7 : 0
    }
    expect(await deploy(['local', 'up'], f.r)).toBe(7)
    expect(f.calls.some((c) => c.argv.slice(-3).join(' ') === 'up -d relay')).toBe(false)
  })
  test('build failure prevents database startup', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'secret' })
    f.r.run = async (argv) => (argv.includes('build') ? 5 : 0)
    expect(await deploy(['local', 'up'], f.r)).toBe(5)
  })
  test('init runs only the installer and never starts the interface', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'secret' })
    expect(await deploy(['local', 'init'], f.r)).toBe(0)
    expect(f.calls.at(-1)!.argv.slice(-2)).toEqual(['-T', 'migrate'])
    expect(f.urls).toEqual(['http://localhost:5556/dex/.well-known/openid-configuration'])
  })
  test('Podman is selected when Docker Compose is unavailable', async () => {
    const f = fake()
    f.r.which = (name) => (name === 'podman' ? name : null)
    expect(await deploy(['local', 'status'], f.r)).toBe(0)
    expect(f.calls.at(-1)!.argv[0]).toBe('podman')
  })
  test('status, logs and down do not require credentials or delete volumes implicitly', async () => {
    for (const action of ['status', 'logs', 'down']) {
      const f = fake()
      expect(await deploy(['local', action], f.r)).toBe(0)
      expect(f.calls.at(-1)!.argv).not.toContain('--volumes')
    }
    const f = fake()
    await deploy(['local', 'logs', '-f', 'relay'], f.r)
    expect(f.calls.at(-1)!.argv.slice(-3)).toEqual(['logs', '-f', 'relay'])
  })
  test('a missing administrator password is generated once, saved privately and reused', async () => {
    const f = fake()
    writeFileSync(f.envFile, 'APP_ENV=development')
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const password = f.calls.find((c) => c.argv.includes('migrate'))!.options!.env!
      .POSTGRES_PASSWORD!
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(readFileSync(f.envFile, 'utf8')).toStartWith(
      `APP_ENV=development\nPOSTGRES_PASSWORD=${password}\nPLATFORM_ADMIN_PASSWORD=`
    )
    expect(f.output[0]).toContain('Generated POSTGRES_PASSWORD')
    expect(JSON.stringify([f.output, f.calls.map((c) => c.argv)])).not.toContain(password)
    f.calls.length = 0
    f.output.length = 0
    expect(await deploy(['local', 'init'], f.r)).toBe(0)
    expect(f.calls.at(-1)!.options!.env!.POSTGRES_PASSWORD).toBe(password)
    expect(readFileSync(f.envFile, 'utf8').match(/POSTGRES_PASSWORD/g)).toHaveLength(1)
    expect(f.output).toEqual([])
    const fresh = fake()
    expect(await deploy(['local', 'validate'], fresh.r)).toBe(0)
    expect(statSync(fresh.envFile).mode & 0o777).toBe(0o600)
  })
  test('a supplied password or password file is used and nothing is generated', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'from-environment' })
    writeFileSync(f.envFile, 'POSTGRES_PASSWORD="from-file"\n')
    await deploy(['local', 'init'], f.r)
    expect(f.calls.at(-1)!.options!.env!.POSTGRES_PASSWORD).toBe('from-environment')
    const g = fake()
    writeFileSync(join(g.envFile, '..', 'secret'), 'from-secret-file\n')
    writeFileSync(g.envFile, `POSTGRES_PASSWORD_FILE=${join(g.envFile, '..', 'secret')}\n`)
    await deploy(['local', 'init'], g.r)
    expect(g.calls.at(-1)!.options!.env!.POSTGRES_PASSWORD).toBe('from-secret-file')
    expect(readFileSync(g.envFile, 'utf8')).not.toMatch(/^POSTGRES_PASSWORD=/m)
    for (const action of ['status', 'logs', 'down']) {
      const h = fake()
      await deploy(['local', action], h.r)
      expect(existsSync(h.envFile)).toBe(false)
    }
  })
  test('options are validated before any process starts or value is generated', async () => {
    const f = fake()
    await expect(
      deploy(['local', 'up', '--engine=podman', '--engine=docker'], f.r)
    ).rejects.toThrow('Repeated')
    await expect(deploy(['local', 'up', '--timeout=0'], f.r)).rejects.toThrow('--timeout')
    const relay = fake({ RELAY_PORT: 'no' })
    await expect(deploy(['local', 'up'], relay.r)).rejects.toThrow('RELAY_PORT')
    expect(existsSync(relay.envFile)).toBe(false)
    await expect(deploy(['local', 'up'], fake({ DEX_PORT: '0' }).r)).rejects.toThrow('DEX_PORT')
    expect(f.calls).toEqual([])
    expect(existsSync(f.envFile)).toBe(false)
    const bad = fake({ POSTGRES_PASSWORD: 'secret', RELAY_PORT: 'no' })
    await expect(deploy(['local', 'up'], bad.r)).rejects.toThrow('RELAY_PORT')
    expect(bad.calls).toEqual([])
  })
  test('failed relay readiness times out instead of reporting success', async () => {
    const f = fake({ POSTGRES_PASSWORD: 'secret' })
    f.r.healthy = async (url) => url.includes('/dex/')
    await expect(deploy(['local', 'up', '--timeout=2'], f.r)).rejects.toThrow(
      'The relay did not become ready'
    )
    expect(f.output.filter((line) => !line.startsWith('Generated '))).toEqual([])
    f.r.healthy = async () => false
    await expect(deploy(['local', 'up', '--timeout=2'], f.r)).rejects.toThrow(
      'Dex did not become ready'
    )
    expect(f.calls.some((c) => c.argv.includes('migrate') && c.argv.includes('run'))).toBe(true)
  })
})
describe('Kubernetes deployment orchestration', () => {
  test('render is offline and emits concrete, namespaced YAML without database credentials', async () => {
    const f = fake(kenv)
    f.r.which = () => null
    expect(await deploy(['k8s', 'render', '--namespace=team'], f.r)).toBe(0)
    const docs = f.output[0]!.split(/^---$/m).map((s) => Bun.YAML.parse(s)) as any[]
    expect(docs).toHaveLength(2)
    expect(docs.every((d) => d.metadata.namespace === 'team')).toBe(true)
    const [container] = docs[0].spec.template.spec.containers
    expect(container.image).toBe(settings.image)
    // The relay forwards to the database and allows only the site's own origin.
    expect(container.env.find((e: any) => e.name === 'RELAY_UPSTREAM').value).toBe(
      'db.internal:5432'
    )
    expect(container.env.find((e: any) => e.name === 'RELAY_ORIGINS').value).toBe(
      settings.publicUrl
    )
    expect(container.args).toBeUndefined()
    expect(
      (container.env ?? []).some((e: any) =>
        ['PGUSER', 'PGPASSWORD', 'DATABASE_URL'].includes(e.name)
      )
    ).toBe(false)
    expect(f.calls).toEqual([])
  })
  test('apply renders supplied settings then waits for rollout in the same namespace', async () => {
    const f = fake(kenv)
    expect(await deploy(['k8s', 'apply', '--namespace', 'team', '--timeout=60'], f.r)).toBe(0)
    expect(f.calls[0]!.argv).toEqual(['kubectl', '-n', 'team', 'apply', '-f', '-'])
    expect(f.calls[0]!.options?.input).toContain(settings.databaseHost)
    expect(f.calls[1]!.argv).toEqual([
      'kubectl',
      '-n',
      'team',
      'rollout',
      'status',
      'deployment/platform-relay',
      '--timeout=60s',
    ])
  })
  test('failed apply does not attempt a rollout, and diff preserves exit 1', async () => {
    const f = fake(kenv)
    f.r.run = async (argv, options) => {
      f.calls.push({ argv, options })
      return 1
    }
    expect(await deploy(['k8s', 'apply'], f.r)).toBe(1)
    expect(f.calls).toHaveLength(1)
    expect(await deploy(['k8s', 'diff'], f.r)).toBe(1)
  })
  test('validate uses a server-side dry run and status needs no image configuration', async () => {
    const f = fake(kenv)
    await deploy(['k8s', 'validate'], f.r)
    expect(f.calls[0]!.argv).toContain('--dry-run=server')
    const status = fake()
    expect(await deploy(['k8s', 'status'], status.r)).toBe(0)
    expect(status.calls[0]!.argv).toContain('deployment,service,pod')
  })
  test('render rejects placeholders, insecure origins and invalid port values', () => {
    expect(() => renderKubernetes({ ...settings, image: '' })).toThrow('--image')
    expect(() => renderKubernetes({ ...settings, publicUrl: 'http://example.com' })).toThrow(
      'HTTPS'
    )
    expect(() => renderKubernetes({ ...settings, oidcIssuer: '' })).toThrow('--oidc-issuer')
    expect(() => renderKubernetes({ ...settings, oidcIssuer: 'http://sso.example.com' })).toThrow(
      'OIDC_ISSUER must be an HTTPS URL'
    )
    expect(() => renderKubernetes({ ...settings, databasePort: '5432\nmalicious' })).toThrow('port')
    expect(() => renderKubernetes({ ...settings, databaseHost: 'db --conncap 1' })).toThrow(
      'host name'
    )
    expect(() => renderKubernetes({ ...settings, namespace: 'bad/namespace' })).toThrow('namespace')
  })
  test('YAML string quoting prevents values from creating extra configuration', () => {
    const yaml = renderKubernetes({ ...settings, publicUrl: 'https://platform.example.com/?a="b' })
    const doc = Bun.YAML.parse(yaml.split(/^---$/m)[0]!) as any
    expect(
      doc.spec.template.spec.containers[0].env.find((e: any) => e.name === 'RELAY_ORIGINS').value
    ).toBe('https://platform.example.com/?a="b')
  })
})

test('CLI apply invokes the real subprocess adapter and sends the manifest through stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'platform-deploy-'))
  try {
    writeFileSync(
      join(dir, 'kubectl'),
      `#!/bin/sh
printf '%s\\n' "$@" >> "$DEPLOY_TEST_CALLS"
if [ "$3" = "apply" ]; then cat > "$DEPLOY_TEST_MANIFEST"; fi
`,
      { mode: 0o755 }
    )
    const child = Bun.spawn(
      [process.execPath, 'packages/cli/src/cli.ts', 'deploy', 'k8s', 'apply'],
      {
        cwd: new URL('../../..', import.meta.url).pathname,
        env: {
          PATH: dir + ':' + process.env.PATH,
          ...kenv,
          DEPLOY_TEST_CALLS: join(dir, 'calls'),
          DEPLOY_TEST_MANIFEST: join(dir, 'manifest'),
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toBe('')
    expect(await child.exited).toBe(0)
    expect(readFileSync(join(dir, 'calls'), 'utf8')).toContain('rollout')
    expect(readFileSync(join(dir, 'manifest'), 'utf8')).toContain(settings.image)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
