import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { deploy, type DeployRuntime, renderKubernetes } from '../src/deployment/index.ts'
import { saved } from '../src/deployment/runtime.ts'
import { VERSION } from '../src/version.ts'

type Call = { argv: string[]; options?: Parameters<DeployRuntime['run']>[1] }
function fake(
  env: Record<string, string | undefined> = {},
  answers: Record<string, string> = {},
  interactive = false
) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'platform-env-')), '.env')
  const calls: Call[] = []
  const output: string[] = []
  const notes: string[] = []
  const urls: string[] = []
  const asked: string[] = []
  const hosts: string[] = []
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
    // One after the other, through whatever `run` is at the time: a test may replace it.
    together: async (_task, jobs, options) => {
      for (const job of jobs) {
        const code = await r.run(job.argv, options)
        if (code) return code
      }
      return 0
    },
    sleep: async () => undefined,
    healthy: async (url) => {
      urls.push(url)
      return true
    },
    hash: async (password) => `hash-of(${password})`,
    interactive,
    hosts: async (names: string[]) => {
      hosts.push(...names)
    },
    note: (text) => {
      notes.push(text)
    },
    ask: async (name, _question, fallback) => {
      asked.push(name)
      return answers[name] ?? fallback
    },
    choose: async (name, _question, _choices, fallback) => {
      asked.push(name)
      return answers[name] ?? fallback
    },
    confirm: async (name, _question, fallback = false) => {
      asked.push(name)
      return answers[name] === undefined ? fallback : /^y(es)?$/i.test(answers[name])
    },
    begin: (title) => {
      notes.push(title)
    },
    show: (title, lines) => {
      notes.push(`Configuration: ${title}\n${lines}`)
    },
    waiting: () => ({ done: () => undefined, fail: () => undefined }),
    done: () => undefined,
    result: (title, rows, next) => {
      output.push([title, ...rows.map(([name, value]) => `${name}: ${value}`), ...next].join('\n'))
    },
  }
  return { r, calls, output, notes, urls, envFile, asked, hosts }
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
  PLATFORM_DOMAIN: 'platform.example.com',
  PLATFORM_IDP_HOST: 'idp',
  PLATFORM_API_HOST: 'api',
  PLATFORM_DB_HOST: 'db',
  PLATFORM_IMAGE: settings.image,
  PUBLIC_URL: settings.publicUrl,
  OIDC_ISSUER: settings.oidcIssuer,
  DATABASE_HOST: settings.databaseHost,
  DATABASE_NAME: 'platform',
  DATABASE_PORT: '5432',
}

describe('version and CLI entry points', () => {
  test('package, database, API expectation and runtime agree on 2.3.0', () => {
    expect(VERSION).toBe('2.3.0')
    expect(
      JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
    ).toBe(VERSION)
    expect(
      readFileSync(new URL('../../../migrations/0001_platform.sql', import.meta.url), 'utf8')
    ).toContain(`CHECK (version = '${VERSION}')`)
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
      expect(out).toContain(args[0] === '--version' ? '2.3.0' : 'platform deploy')
    }
  })
})
describe('local deployment orchestration', () => {
  test('up installs through a one-off process beside PostgreSQL before starting the relay', async () => {
    const f = fake({ RELAY_PORT: '8087' })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const cmds = f.calls.map((c) => c.argv)
    // Each image is built by a command of its own, so that what it says is its own.
    expect(cmds.slice(1, 4).map((cmd) => cmd.slice(-2))).toEqual([
      ['build', 'postgres'],
      ['build', 'relay'],
      ['build', 'migrate'],
    ])
    // The installer's image is built too, so its profile is named for the build.
    expect(cmds[3]).toContain('--profile')
    // The edge is started with Dex: it is what answers on the issuer's name.
    expect(cmds[4]!.slice(-5)).toEqual(['up', '-d', 'postgres', 'dex', 'edge'])
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
    // Nothing is handed to the installer: PostgreSQL has no password to hand.
    expect(
      Object.keys(init.options?.env ?? {}).filter((name) => /^(POSTGRES_PASSWORD|PG)/.test(name))
    ).toEqual([])
    // No site was chosen, so the administrator's role alone is made, straight after.
    const administrator = f.calls[f.calls.indexOf(init) + 1]!
    expect(administrator.argv.slice(-5)).toEqual([
      '-T',
      'migrate',
      'apply',
      'k8s',
      '--administrator',
    ])
    expect(cmds.at(-1)!.slice(-3)).toEqual(['up', '-d', 'relay'])
    // Dex answers before the installer runs; the relay is checked last.
    expect(f.urls).toEqual([
      'http://idp.localhost:8080/.well-known/openid-configuration',
      'http://api.localhost:8080/health',
    ])
    const stack = readFileSync(
      new URL('../../../deploy/compose/compose.yaml', import.meta.url),
      'utf8'
    )
    const services = (Bun.YAML.parse(stack) as any).services
    // No service is given a password: PostgreSQL has none, and the installer shares its socket.
    expect(stack).not.toMatch(/PASSWORD|scram/)
    expect(services.migrate.environment.DATABASE_HOST).toBe('/var/run/postgresql')
    // Beside the socket it reads the folder of the deployment's site, wherever that is on
    // this machine, and writes nothing anywhere.
    expect(services.migrate.volumes).toEqual([
      'socket:/var/run/postgresql',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: it is Compose's own variable, as the file writes it
      '${PLATFORM_SITE_FOLDER:-../../examples}:/app/site:ro',
    ])
    expect(services.postgres.volumes).toContain('socket:/var/run/postgresql')
    // The interface is a static site, published to a CDN: it is not a container. The one
    // site the stack serves is the one it was given a folder for, with the operator's own tools, and it is
    // reached through the edge like everything else.
    expect(services.ui).toBeUndefined()
    expect(Object.keys(services).sort()).toEqual([
      'dex',
      'edge',
      'migrate',
      'postgres',
      'relay',
      'site',
    ])
    expect(services.site.image).toBe(services.migrate.image)
    expect(services.site.command).toEqual(['ui', 'serve', '--dir=/site', '--port=8080'])
    expect(services.site.ports).toBeUndefined()
    // No site was chosen here, so none is built or started.
    expect(cmds.some((cmd) => cmd.includes('site'))).toBe(false)
    // The edge is the only part that answers on the network: it is the only one published,
    // and the services behind it are reached by the deployment's own names.
    expect(services.postgres.ports).toEqual([
      '127.0.0.1:$' + '{POSTGRES_PORT:-5432}:5432',
      '127.0.0.1:$' + '{EDGE_PORT:-8080}:$' + '{EDGE_PORT:-8080}',
      '127.0.0.1:$' + '{EDGE_TLS_PORT:-4433}:$' + '{EDGE_TLS_PORT:-4433}',
    ])
    expect(services.relay.ports).toBeUndefined()
    expect(services.dex.ports).toBeUndefined()
    // The issuer is the deployment's own name for Dex, on the port the edge answers on:
    // the same address for the browser, for PostgreSQL and for the tools.
    const name = '$' + '{PLATFORM_IDP_HOST:-idp}.' + '$' + '{PLATFORM_DOMAIN:-localhost}'
    const issuer = 'http://' + name + ':$' + '{EDGE_PORT:-8080}'
    expect(services.postgres.environment.PLATFORM_OIDC_ISSUER).toBe(issuer)
    // Dex issues the issuer it is given, and PostgreSQL compares it with what it was
    // told: the two have to be the same address.
    expect(services.dex.environment.DEX_ISSUER).toBe(issuer)
    // A container that joins another's network namespace may not carry extra hosts, and
    // only the one that owns the namespace needs them.
    expect(services.dex.extra_hosts).toBeUndefined()
    expect(services.postgres.extra_hosts).toEqual([name + ':127.0.0.1'])
    // The relay's network is named to PostgreSQL, which keeps an administrator out of it.
    expect(services.postgres.environment.PLATFORM_TOKEN_ONLY_FROM).toBe(
      (Bun.YAML.parse(stack) as any).networks.relay.ipam.config[0].subnet
    )
    expect(stack).not.toContain('postgres:16')
  })
  test('Dex is given the hash of the one password there is, never the password', async () => {
    const f = fake({ PLATFORM_ADMIN_PASSWORD: 'chosen-by-the-operator' })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_ADMIN_PASSWORD=chosen-by-the-operator')
    const env = f.calls.at(-1)!.options!.env!
    expect(env.DEX_ADMIN_HASH).toBe('hash-of(chosen-by-the-operator)')
    // No other account has a password: the stack's Dex keeps one, and everybody else comes
    // from a connector.
    expect(env.DEX_ALICE_HASH).toBeUndefined()
    expect(env.DEX_BOB_HASH).toBeUndefined()
    expect(JSON.stringify([f.output, f.calls.map((c) => c.argv)])).not.toContain(
      'chosen-by-the-operator'
    )
    // The administrator is the deployment's own, on its own domain: Dex keeps that
    // account, and the installer makes that role.
    expect(f.output.at(-1)).toContain('Sign in as admin@localhost')
    expect(f.calls.at(-1)!.options?.env?.PLATFORM_ADMIN).toBe('admin@localhost')
    const dex = readFileSync(
      new URL('../../../deploy/compose/compose.yaml', import.meta.url),
      'utf8'
    )
      .split('  dex:')[1]!
      .split('  migrate:')[0]!
    expect(dex).not.toContain('PASSWORD')
    // The Dex configuration keeps one account with a password, and it is the administrator.
    const template = readFileSync(
      new URL('../../../deploy/dex/config.yaml.tmpl', import.meta.url),
      'utf8'
    )
    expect(template.match(/hashFromEnv/g)).toHaveLength(1)
    expect(template).toContain('DEX_ADMIN_HASH')
    expect(template).not.toContain('alice@example.com')
    expect(template).not.toContain('bob@example.com')
  })
  test('installer failure propagates its exit code and prevents the interface starting', async () => {
    const f = fake()
    const original = f.r.run
    f.r.run = async (argv, options) => {
      await original(argv, options)
      return argv.includes('migrate') && argv.includes('run') ? 7 : 0
    }
    expect(await deploy(['local', 'up'], f.r)).toBe(7)
    expect(f.calls.some((c) => c.argv.slice(-3).join(' ') === 'up -d relay')).toBe(false)
  })
  test('the edge reads its names from the environment, in the way Traefik reads them', () => {
    const edge = readFileSync(
      new URL('../../../deploy/traefik/dynamic.yaml', import.meta.url),
      'utf8'
    )
    // Traefik renders the file as a Go template: a shell's ${NAME} would be left as it is.
    expect(edge.replace(/^\s*#.*$/gm, '')).not.toContain('${')
    for (const name of ['PLATFORM_DOMAIN', 'PLATFORM_IDP_HOST', 'PLATFORM_API_HOST', 'DEX_PORT'])
      expect(edge).toContain(`{{ env "${name}" }}`)
  })
  test('the site of a folder is built, served by the stack and routed by the edge', async () => {
    const f = fake({ PLATFORM_SITE: 'examples/newsroom', EDGE_PORT: '9090' })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const cmds = f.calls.map((c) => c.argv)
    // The site is last: built on this machine, as it would be for a CDN, then started.
    expect(cmds.at(-2)).toEqual([
      'bun',
      'packages/cli/src/cli.ts',
      'ui',
      'build',
      '--dir=examples/newsroom',
      '--production',
    ])
    expect(cmds.at(-1)!.slice(-3)).toEqual(['up', '-d', 'site'])
    // What the folder applies is installed beside PostgreSQL, from where it is mounted.
    expect(cmds.filter((c) => c.includes('apply')).map((c) => c.slice(-3))).toEqual([
      ['apply', 'k8s', '--dir=/app/site'],
    ])
    // The pages are built for the address the edge serves them on, and the relay allows it.
    const built = f.calls.at(-2)!.options?.env ?? {}
    expect(built.PLATFORM_PUBLIC_URL).toBe('http://app.localhost:9090')
    expect(built.PLATFORM_RELAY_URL).toBe('ws://api.localhost:9090')
    const stack = f.calls.at(-1)!.options?.env ?? {}
    expect(stack.PLATFORM_PUBLIC_ORIGIN).toBe('http://app.localhost:9090')
    expect(stack.PLATFORM_SITE).toBe('examples/newsroom')
    expect(stack.PLATFORM_SITE_FOLDER).toEndWith('/examples/newsroom')
    expect(stack.PLATFORM_SITE_DIST).toEndWith('/examples/newsroom/.dist')
    // The site's name answers on this machine with the others, and is waited for last.
    expect(f.hosts).toContain('app.localhost')
    expect(f.urls.at(-1)).toBe('http://app.localhost:9090/')
    expect(f.output.join('\n')).toContain('Site: http://app.localhost:9090')
    // The site is the one link: none opens it at its sign-in, and nothing secret is said.
    expect(f.output.join('\n')).not.toContain('#signin')
    expect(f.output.join('\n')).not.toContain(saved(f.envFile, 'PLATFORM_ADMIN_PASSWORD')!)
    // The edge routes the name only when there is a site.
    const edge = readFileSync(
      new URL('../../../deploy/traefik/dynamic.yaml', import.meta.url),
      'utf8'
    )
    expect(edge).toMatch(/\{\{ if env "PLATFORM_SITE" \}\}\s+app:\s+rule: 'Host/)
    expect(edge).toContain('http://site:8080')
    // A site of the operator's own is not the stack's to serve.
    const own = fake({
      PLATFORM_SITE: 'examples/newsroom',
      PLATFORM_PUBLIC_URL: 'https://x.example.com',
    })
    expect(await deploy(['local', 'up'], own.r)).toBe(0)
    expect(own.calls.some((c) => c.argv.includes('site'))).toBe(false)
  })
  test("the administrator is named on the deployment's own domain, unless another is", async () => {
    // On its own domain by default: Dex keeps that account, the installer makes that role.
    const f = fake({ PLATFORM_DOMAIN: 'corp.example' })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    expect(f.calls.at(-1)!.options?.env?.PLATFORM_ADMIN).toBe('admin@corp.example')
    expect(f.output.at(-1)).toContain('Sign in as admin@corp.example')
    expect(readFileSync(f.envFile, 'utf8')).toContain('PLATFORM_ADMIN=admin@corp.example')
    // A person may be named instead.
    const named = fake({ PLATFORM_DOMAIN: 'corp.example', PLATFORM_ADMIN: 'root@corp.example' })
    expect(await deploy(['local', 'up'], named.r)).toBe(0)
    expect(named.calls.at(-1)!.options?.env?.PLATFORM_ADMIN).toBe('root@corp.example')
    // What is not an address is refused before anything starts.
    const wrong = fake({ PLATFORM_ADMIN: 'the admin' })
    await expect(deploy(['local', 'up'], wrong.r)).rejects.toThrow('PLATFORM_ADMIN')
    expect(wrong.calls).toEqual([])
    // Dex and the installer are both told who it is, and nothing names an address of its own.
    const stack = Bun.YAML.parse(
      readFileSync(new URL('../../../deploy/compose/compose.yaml', import.meta.url), 'utf8')
    ) as any
    const name = '$' + '{PLATFORM_ADMIN:-'
    expect(stack.services.dex.environment.DEX_ADMIN_EMAIL).toStartWith(name)
    expect(stack.services.migrate.environment.PLATFORM_ADMIN).toStartWith(name)
    const dex = readFileSync(
      new URL('../../../deploy/dex/config.yaml.tmpl', import.meta.url),
      'utf8'
    )
    expect(dex).toContain('email: {{ getenv "DEX_ADMIN_EMAIL"')
    // The sign-in form opens with that address filled in: Dex's own form, with that change.
    expect(dex).toMatch(/frontend:\s+extra:\s+admin: \{\{ getenv "DEX_ADMIN_EMAIL"/)
    expect(stack.services.dex.volumes).toContain(
      '../dex/password.html:/srv/dex/web/templates/password.html:ro'
    )
    const form = readFileSync(new URL('../../../deploy/dex/password.html', import.meta.url), 'utf8')
    expect(form).toContain('value="{{ extra "admin" }}"')
    expect(form).toContain('name="password"')
    expect(dex).not.toContain('admin@example.com')
  })
  test('build failure prevents database startup', async () => {
    const f = fake()
    f.r.run = async (argv) => (argv.includes('build') ? 5 : 0)
    expect(await deploy(['local', 'up'], f.r)).toBe(5)
  })
  test('init runs only the installer and never starts the interface', async () => {
    const f = fake()
    expect(await deploy(['local', 'init'], f.r)).toBe(0)
    expect(f.calls.at(-2)!.argv.slice(-2)).toEqual(['-T', 'migrate'])
    expect(f.calls.at(-1)!.argv.slice(-4)).toEqual(['migrate', 'apply', 'k8s', '--administrator'])
    expect(f.urls).toEqual(['http://idp.localhost:8080/.well-known/openid-configuration'])
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
  test('no password is made for PostgreSQL, and the one password there is saved once', async () => {
    const f = fake()
    writeFileSync(f.envFile, 'APP_ENV=development')
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const saved = readFileSync(f.envFile, 'utf8')
    // The file that was there is kept, and the settings it lacked are added to it.
    expect(saved).toStartWith('APP_ENV=development\n')
    expect(saved).toContain('PLATFORM_ADMIN_PASSWORD=')
    expect(saved).not.toContain('POSTGRES_PASSWORD')
    for (const call of f.calls)
      expect(
        Object.keys(call.options?.env ?? {}).filter((name) => /^(POSTGRES_PASSWORD|PG)/.test(name))
      ).toEqual([])
    expect(f.notes.join('\n')).toContain('Generated PLATFORM_ADMIN_PASSWORD')
    f.calls.length = 0
    f.output.length = 0
    expect(await deploy(['local', 'init'], f.r)).toBe(0)
    expect(readFileSync(f.envFile, 'utf8')).toBe(saved)
    expect(f.output).toEqual([])
    const fresh = fake()
    expect(await deploy(['local', 'validate'], fresh.r)).toBe(0)
    expect(statSync(fresh.envFile).mode & 0o777).toBe(0o600)
    for (const action of ['status', 'logs', 'down']) {
      const h = fake()
      await deploy(['local', action], h.r)
      expect(existsSync(h.envFile)).toBe(false)
    }
  })
  test('admin runs an operator command beside PostgreSQL, and holds nothing to do it', async () => {
    const f = fake()
    expect(await deploy(['local', 'admin', 'harden', 'k8s', '--keep-names'], f.r)).toBe(0)
    const call = f.calls.at(-1)!
    expect(call.argv.slice(-8)).toEqual([
      'run',
      '--rm',
      '--no-deps',
      '-T',
      'migrate',
      'harden',
      'k8s',
      '--keep-names',
    ])
    expect(call.argv).toContain('--profile')
    expect(existsSync(f.envFile)).toBe(false)
    await expect(deploy(['local', 'admin'], fake().r)).rejects.toThrow('needs a command')
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
  })
  test('failed relay readiness times out instead of reporting success', async () => {
    const f = fake()
    f.r.healthy = async (url) => url.includes('/.well-known/')
    await expect(deploy(['local', 'up', '--timeout=2'], f.r)).rejects.toThrow(
      'The relay did not become ready'
    )
    expect(
      [...f.output, ...f.notes].filter(
        (line) =>
          !line.startsWith('Generated ') &&
          !line.startsWith('Configuration: ') &&
          // The heading the command runs under.
          line !== 'platform deploy local up'
      )
    ).toEqual([])
    f.r.healthy = async () => false
    await expect(deploy(['local', 'up', '--timeout=2'], f.r)).rejects.toThrow(
      'Dex did not become ready'
    )
    // What the service said last is shown: the reason is usually there.
    expect(f.calls.slice(-2).map((c) => c.argv.slice(-4))).toEqual([
      ['logs', '--tail', '40', 'dex'],
      ['logs', '--tail', '40', 'edge'],
    ])
    expect(f.calls.some((c) => c.argv.includes('migrate') && c.argv.includes('run'))).toBe(true)
  })
})
describe('the configuration of a deployment', () => {
  test('a missing configuration is written by asking, and kept out of git', async () => {
    const f = fake({}, { PLATFORM_PUBLIC_URL: 'https://platform.example.com' }, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // What the operator was asked, and what the answers are worth.
    expect(f.asked).toContain('PLATFORM_PUBLIC_URL')
    expect(f.asked).toContain('RELAY_PORT')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_PUBLIC_URL=https://platform.example.com')
    // The services answer on their own sub-domains of the deployment's domain.
    expect(saved).toContain('PLATFORM_DOMAIN=localhost')
    // The file holds the pieces only: the addresses are made of them at runtime.
    expect(saved).not.toContain('PLATFORM_ISSUER')
    expect(saved).not.toContain('PLATFORM_RELAY_URL')
    expect(saved).not.toContain('DATABASE_HOST')
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.localhost:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.localhost:8080')
    expect(f.r.env.DATABASE_HOST).toBe('db.localhost')
    // The one password there is, the break-glass administrator's, is generated and never
    // printed. Nobody else has one.
    expect(saved).toMatch(/^PLATFORM_ADMIN_PASSWORD=[\w-]{32}$/m)
    expect(saved).not.toContain('ALICE_PASSWORD')
    expect(saved).not.toContain('BOB_PASSWORD')
    expect(JSON.stringify(f.output)).not.toMatch(/PASSWORD=[\w-]{32}/)
    // The file holds secrets: it is the operator's alone, and git never sees it.
    expect(statSync(f.envFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(dirname(f.envFile), '.gitignore'), 'utf8')).toContain('.env')
    // The answers are what the deployment then uses.
    expect(f.r.env.PLATFORM_PUBLIC_URL).toBe('https://platform.example.com')
    expect(f.r.env.RELAY_PORT).toBe('8081')
  })
  test('a configuration that is already there is completed, not rewritten', async () => {
    const f = fake({}, {}, true)
    writeFileSync(f.envFile, 'PLATFORM_PUBLIC_URL=https://kept.example.com\n')
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // What the file holds is kept; what it lacks is asked for and added to it.
    expect(f.asked).toContain('PLATFORM_DOMAIN')
    const file = readFileSync(f.envFile, 'utf8')
    expect(file).toStartWith('PLATFORM_PUBLIC_URL=https://kept.example.com\n')
    expect(file).toContain('PLATFORM_DOMAIN=localhost')
    // The addresses are not kept: they are made of the pieces.
    expect(file).not.toContain('PLATFORM_ISSUER')
  })
  test('the values a file held that are computed now are taken out of it', async () => {
    const f = fake()
    writeFileSync(
      f.envFile,
      [
        'PLATFORM_DOMAIN=localhost',
        'PLATFORM_ISSUER=http://idp.localhost:8080',
        'OIDC_ISSUER=http://idp.localhost:8080',
        'PLATFORM_RELAY_URL=ws://api.localhost:8080',
        'DATABASE_HOST=db.localhost',
        'PLATFORM_PUBLIC_URL=http://app.localhost:5173',
        '',
      ].join('\n')
    )
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const file = readFileSync(f.envFile, 'utf8')
    // The pieces are kept; the addresses are made of them now.
    expect(file).toContain('PLATFORM_DOMAIN=localhost')
    expect(file).not.toContain('PLATFORM_ISSUER')
    expect(file).not.toContain('OIDC_ISSUER')
    expect(file).not.toContain('PLATFORM_RELAY_URL')
    expect(file).not.toContain('DATABASE_HOST')
    expect(file).not.toContain('PLATFORM_PUBLIC_URL')
    // And the addresses are right.
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.localhost:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.localhost:8080')
    expect(f.r.env.DATABASE_HOST).toBe('db.localhost')
  })
  test('what was answered is shown before it is written, and refusing it writes nothing', async () => {
    const f = fake({}, { PLATFORM_DOMAIN: 'wrong.example.com', write: 'no' }, true)
    await expect(deploy(['local', 'validate'], f.r)).rejects.toThrow('Cancelled')
    // Why the questions are asked is said before the first of them.
    expect(f.notes[0]).toContain('no .env was found')
    // The answers are shown with what follows from them, and the password is not.
    const shown = f.notes.find((note) => note.includes('What is added to .env')) ?? ''
    expect(shown).toContain('PLATFORM_DOMAIN')
    expect(shown).toContain('wrong.example.com')
    expect(shown).toContain('http://idp.wrong.example.com:8080')
    expect(shown).toMatch(/PLATFORM_ADMIN_PASSWORD\s+\(generated\)/)
    expect(existsSync(f.envFile)).toBe(false)
    expect(f.calls).toEqual([])
  })
  test('without a terminal the defaults are written, and nothing is asked', async () => {
    const f = fake()
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    expect(f.asked).toEqual([])
    const saved = readFileSync(f.envFile, 'utf8')
    // No site that already exists: one is deployed, on its own sub-domain, and
    // its address is made of the domain and it rather than kept.
    expect(saved).not.toContain('PLATFORM_PUBLIC_URL')
    expect(saved).toContain('PLATFORM_APP_HOST=app')
    expect(f.r.env.PLATFORM_SITE_URL).toBe('http://app.localhost:5173')
    expect(saved).toContain('DEX_PORT=5556')
    expect(saved).toMatch(/^PLATFORM_ADMIN_PASSWORD=[\w-]{32}$/m)
  })
  test('what the command line gave is kept, and only the rest is asked for', async () => {
    const f = fake({}, {}, true)
    expect(
      await deploy(
        [
          'k8s',
          'render',
          '--domain=platform.example.com',
          '--image=registry.example.com/platform:2.3.0',
          '--public-url=https://platform.example.com',
          '--oidc-issuer=https://sso.example.com/dex',
          '--database-host=db.internal',
        ],
        f.r
      )
    ).toBe(0)
    expect(f.asked).toEqual([
      'PLATFORM_IDP_HOST',
      'PLATFORM_API_HOST',
      'PLATFORM_DB_HOST',
      'DATABASE_PORT',
      // The last question: whether what was answered is written down.
      'write',
    ])
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_DOMAIN=platform.example.com')
    expect(saved).toContain('PLATFORM_IMAGE=registry.example.com/platform:2.3.0')
    expect(saved).toContain('DATABASE_PORT=5432')
    // The database's name is the same for every deployment: it is worked out, not kept.
    expect(saved).not.toContain('DATABASE_NAME')
  })
  test('a Kubernetes deployment with nothing given writes nothing, and says what is missing', async () => {
    const f = fake()
    await expect(deploy(['k8s', 'render'], f.r)).rejects.toThrow('--domain')
    expect(existsSync(f.envFile)).toBe(false)
    expect(f.notes.join('\n')).toContain('PLATFORM_DOMAIN')
  })
  test('the names of the deployment follow from its domain, and are asked for', async () => {
    const f = fake(
      {},
      {
        PLATFORM_DOMAIN: 'dex.local',
        PLATFORM_IDP_HOST: 'idp',
        PLATFORM_API_HOST: 'api',
        PLATFORM_DB_HOST: 'db',
        PLATFORM_PUBLIC_URL: 'https://dex.local',
      },
      true
    )
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_DOMAIN=dex.local')
    // The addresses follow from the names, at runtime.
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.dex.local:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.dex.local:8080')
    expect(f.r.env.DATABASE_HOST).toBe('db.dex.local')
    // The names have to answer on this machine: the browser and the operator's tools.
    expect(f.hosts).toEqual(['idp.dex.local', 'api.dex.local', 'db.dex.local'])
  })
  test('a site that already exists is asked for by its full URL, and none is deployed', async () => {
    const f = fake({}, { PLATFORM_PUBLIC_URL: 'https://console.example.com' }, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // The operator is asked for the address of the site, and no site is deployed.
    expect(f.asked).toContain('PLATFORM_PUBLIC_URL')
    expect(f.asked).not.toContain('PLATFORM_APP_HOST')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_PUBLIC_URL=https://console.example.com')
    expect(saved).not.toContain('PLATFORM_APP_HOST')
  })
  test('the examples a checkout carries are offered, and one of them is deployed', async () => {
    const f = fake({}, { PLATFORM_SITE: 'examples/newsroom' }, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // The question is which folder the site is in.
    expect(f.asked).toContain('PLATFORM_SITE')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_SITE=examples/newsroom')
    // The interface that is built is the one in the folder that was chosen.
    f.calls.length = 0
    expect(await deploy(['local', 'ui'], f.r)).toBe(0)
    expect(f.calls.at(-1)!.argv).toContain('--dir=examples/newsroom')
  })
  test('a folder that is no site is refused', async () => {
    const f = fake({ PLATFORM_SITE: 'examples/nonesuch' })
    await expect(deploy(['local', 'up'], f.r)).rejects.toThrow('PLATFORM_SITE')
    expect(existsSync(f.envFile)).toBe(false)
  })
  test('the site is any folder that holds a platform.json, wherever it is', async () => {
    // A folder outside the checkout, which applies nothing: a site, and no example.
    const dir = mkdtempSync(join(tmpdir(), 'platform-site-'))
    writeFileSync(join(dir, 'platform.json'), '{}')
    const f = fake({ PLATFORM_SITE: dir })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const cmds = f.calls.map((c) => c.argv)
    // It is built where it is, and served from there.
    expect(cmds.at(-2)).toContain(`--dir=${dir}`)
    const stack = f.calls.at(-1)!.options?.env ?? {}
    expect(stack.PLATFORM_SITE_FOLDER).toBe(dir)
    expect(stack.PLATFORM_SITE_DIST).toBe(join(dir, '.dist'))
    // It applies nothing, so the administrator's role alone is made.
    expect(cmds.filter((c) => c.includes('apply')).map((c) => c.slice(-3))).toEqual([
      ['apply', 'k8s', '--administrator'],
    ])
    rmSync(dir, { recursive: true })
  })
  test('a configuration that names an example is told what to say now', async () => {
    const f = fake({ PLATFORM_EXAMPLE: 'newsroom' })
    await expect(deploy(['local', 'up'], f.r)).rejects.toThrow('PLATFORM_SITE=examples/newsroom')
  })
  test('the site is deployed on a sub-domain of the deployment domain', async () => {
    const f = fake({}, { PLATFORM_APP_HOST: 'console' }, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // No site exists already, so the sub-domain is asked for, and the address of the
    // site follows from the domain and it.
    expect(f.asked).toContain('PLATFORM_APP_HOST')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_APP_HOST=console')
    expect(f.r.env.PLATFORM_SITE_URL).toBe('http://console.localhost:5173')
  })
  test('the edge answers on ports the operator chooses, never on 80 or 443', async () => {
    const f = fake({}, {}, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // The operator is asked for the ports, and the defaults are not the privileged ones.
    expect(f.asked).toContain('EDGE_PORT')
    expect(f.asked).toContain('EDGE_TLS_PORT')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('EDGE_PORT=8080')
    expect(saved).toContain('EDGE_TLS_PORT=4433')
    expect(saved).not.toMatch(/^EDGE_PORT=80$/m)
    expect(saved).not.toMatch(/^EDGE_TLS_PORT=443$/m)
    // The names carry the port the edge answers on: the addresses are made of the pieces
    // at runtime, and the deployment is given them.
    expect(saved).not.toContain('PLATFORM_ISSUER')
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.localhost:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.localhost:8080')
    // The edge is the only part published, and it is published on those ports.
    const env = f.calls.at(-1)!.options!.env!
    expect(env.EDGE_PORT).toBe('8080')
    expect(env.EDGE_TLS_PORT).toBe('4433')
    expect(env.PLATFORM_ISSUER).toBe('http://idp.localhost:8080')
    expect(env.PLATFORM_RELAY_URL).toBe('ws://api.localhost:8080')
  })
  test('a secret that is not a bare word is written so that it reads back as it is', async () => {
    const f = fake({ PLATFORM_ADMIN_PASSWORD: 'a secret with spaces' })
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const file = readFileSync(f.envFile, 'utf8')
    expect(file).toContain("PLATFORM_ADMIN_PASSWORD='a secret with spaces'")
    expect(saved(f.envFile, 'PLATFORM_ADMIN_PASSWORD')).toBe('a secret with spaces')
    // Dex is given the hash of that password, never the password itself.
    expect(f.calls.at(-1)!.options!.env!.DEX_ADMIN_HASH).toBe('hash-of(a secret with spaces)')
  })
  test('a setting that is wrong is refused before anything is written', async () => {
    const f = fake({ RELAY_PORT: 'no' })
    await expect(deploy(['local', 'up'], f.r)).rejects.toThrow('RELAY_PORT')
    expect(existsSync(f.envFile)).toBe(false)
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
          // The settings of the deployment live in a file of their own: the checkout's is
          // the operator's, and this run must not touch it.
          PLATFORM_ENV_FILE: join(dir, '.env'),
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
    // The configuration is written on the way, and says so on stderr; stdout carries the
    // deployment's own words.
    expect(stderr).toContain('Configuration:')
    expect(await new Response(child.stdout).text()).toContain('The relay is deployed')
    expect(await child.exited).toBe(0)
    expect(readFileSync(join(dir, 'calls'), 'utf8')).toContain('rollout')
    expect(readFileSync(join(dir, 'manifest'), 'utf8')).toContain(settings.image)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
