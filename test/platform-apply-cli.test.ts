import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  cliEnv,
  connect,
  issuer,
  issuerUrl,
  role,
  setup,
  teardown,
  url,
  w,
} from './platform-world.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { adminRole } from './administrator.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * A manifest applied: what it makes, and what it leaves alone.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('the operator’s own tools, applying a manifest', () => {
  test('CLI applies model files and manifests to a deployment, and a dry run leaves it untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'platform-apply-'))
    const file = join(dir, 'team.json')
    writeFileSync(join(dir, 'not-json'), 'plain text\n')
    writeFileSync(file, JSON.stringify({ users: [{ name: role('ap_cli') }] }))
    const run = async (args: string[], operator?: Record<string, string>) => {
      const child = Bun.spawn([process.execPath, 'packages/cli/src/cli.ts', 'apply', ...args], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH,
          ...cliEnv,
          ...(operator ?? { PGTOKEN: issuer().mint(adminRole) }),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      return { code: await child.exited, output, error }
    }
    try {
      const dry = await run(['k8s', 'deploy/models/crm.json', file, '--dry-run'])
      expect(dry).toMatchObject({ code: 0, error: '' })
      expect(dry.output).toContain(`~ create user ${role('ap_cli')}`)
      expect(dry.output).toContain('Dry run: nothing was changed.')
      const real = await run(['k8s', file])
      expect(real.output).toContain(`+ create user ${role('ap_cli')}`)
      expect(real.output).toContain('2 changed, 0 already in place.')
      await (await connect('ap_cli')).end()
      expect((await run(['k8s', file])).output).toContain('0 changed, 2 already in place.')
      expect(await run(['staging', file])).toMatchObject({ code: 1 })
      expect((await run(['k8s', join(dir, 'not-json')])).code).toBe(1)
      // A person acts through the CLI with a token, and with nothing but their own rights.
      // A manifest about themselves converges; one about somebody else needs an operator.
      const own = join(dir, 'own.json')
      writeFileSync(own, JSON.stringify({ users: [{ name: role('alice') }] }))
      const asAlice = await run(['k8s', own], { PGTOKEN: issuer().mint(role('alice')) })
      expect(asAlice.output).toContain('0 changed, 2 already in place.')
      const more = join(dir, 'more.json')
      writeFileSync(more, JSON.stringify({ users: [{ name: role('ap_denied') }] }))
      const denied = await run(['k8s', more], { PGTOKEN: issuer().mint(role('alice')) })
      expect(denied).toMatchObject({ code: 1 })
      expect(denied.error).toContain('permission denied')
    } finally {
      await w.root.query(`DROP ROLE IF EXISTS ${ident(role('ap_cli'))}`)
      rmSync(dir, { recursive: true })
    }
  })
})

test('CLI installs a new database at 2.2.0 and safely repeats the installation', async () => {
  const name = w.dbName + '_cli'
  await w.root.query(`CREATE DATABASE ${ident(name)}`)
  try {
    for (let i = 0; i < 2; i++) {
      const child = Bun.spawn([process.execPath, 'packages/cli/src/cli.ts', 'migrate'], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH,
          APP_ENV: 'test',
          DATABASE_HOST: url.hostname,
          DATABASE_PORT: url.port || '5432',
          DATABASE_NAME: name,
          DATABASE_SSL: cliEnv.DATABASE_SSL,
          OIDC_ISSUER: issuerUrl,
          PGTOKEN: issuer().mint(adminRole),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      expect(error).toBe('')
      expect(await child.exited).toBe(0)
      expect(output).toContain(
        i === 0
          ? 'Installed PostgreSQL-native platform version 2.2.0'
          : 'Already installed at version 2.2.0'
      )
    }
  } finally {
    await w.root.query(`DROP DATABASE ${ident(name)} WITH(FORCE)`)
  }
})
