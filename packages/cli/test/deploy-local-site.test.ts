import { describe, expect, test } from 'bun:test'
import { fake } from './deploy-helpers.ts'
import { readFileSync } from 'node:fs'
import { deploy } from '../src/deployment/index.ts'

describe('local deployment orchestration', () => {
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
})
