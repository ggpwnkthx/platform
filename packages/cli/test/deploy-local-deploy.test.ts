import { describe, expect, test } from 'bun:test'
import { fake } from './deploy-helpers.ts'
import { readFileSync } from 'node:fs'
import { deploy } from '../src/deployment/index.ts'
import { saved } from '../src/deployment/runtime.ts'

describe('local deployment orchestration', () => {
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
})
