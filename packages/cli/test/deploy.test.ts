import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { VERSION } from '../src/version.ts'

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
