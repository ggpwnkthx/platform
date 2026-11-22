import { describe, expect, test } from 'bun:test'
import { fake } from './deploy-helpers.ts'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { deploy } from '../src/deployment/index.ts'

describe('local deployment orchestration', () => {
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
