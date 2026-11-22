import { describe, expect, test } from 'bun:test'
import { fake } from './deploy-helpers.ts'
import { readFileSync } from 'node:fs'
import { deploy } from '../src/deployment/index.ts'

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
})
