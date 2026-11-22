import { describe, expect, test } from 'bun:test'
import { fake } from './deploy-helpers.ts'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploy } from '../src/deployment/index.ts'
import { saved } from '../src/deployment/runtime.ts'

describe('the configuration of a deployment', () => {
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
