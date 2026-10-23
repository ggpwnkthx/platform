import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'

const root = resolve(import.meta.dir, '..', '..')

/** The token of the administration of the tests. */
const TOKEN = 'the-admin-token'

let service: TestRuntime

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the smoke test of the administration', () => {
  test('the twelve calls of the specification answer', async () => {
    const proc = Bun.spawn(['bun', 'run', 'scripts/cli/admin-smoke.ts'], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        ACCESS_URL: service.base,
        ACCESS_ADMIN_TOKEN: TOKEN,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    expect(exitCode).toBe(0)
    expect(stdout).toContain('the twelve calls of the administration answered')
    // The secrets never reach the output of the tool.
    expect(stdout).not.toContain('the-secret-of-the-provider')
    expect(stdout).not.toContain('the-secret-of-the-gateway')
  }, 30_000)

  test('the state of the smoke test is in the database', async () => {
    const tenants = await service.runtime.database.query<{ slug: string; enabled: boolean }>(
      'select slug, enabled from tenants where slug = $1',
      ['smoke']
    )
    expect(tenants).toHaveLength(1)
    const users = await service.runtime.database.query<{ external_subject: string }>(
      'select external_subject from users'
    )
    expect(users.map((row) => row.external_subject)).toContain('the-subject-of-the-smoke-test')
    const grants = await service.runtime.database.query<{ revoked_at: Date | null }>(
      'select revoked_at from grants'
    )
    expect(grants).toHaveLength(1)
    expect(grants[0]?.revoked_at).toBeInstanceOf(Date)
  })

  test('the tool refuses to run without a token', async () => {
    const proc = Bun.spawn(['bun', 'run', 'scripts/cli/admin-smoke.ts'], {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ACCESS_URL: service.base },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await proc.exited).toBe(1)
    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toContain('ACCESS_ADMIN_TOKEN')
  }, 30_000)
})
