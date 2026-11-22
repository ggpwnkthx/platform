import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saved } from '../src/deployment/runtime.ts'

/**
 * The settings a deployment keeps in a file of its own: read the way a dotenv file is
 * read, so that the file Compose and Docker read is the file the tools read.
 */
describe('the settings a deployment keeps in a file', () => {
  const file = (lines: string[]) => {
    const path = join(mkdtempSync(join(tmpdir(), 'platform-env-')), '.env')
    writeFileSync(path, `${lines.join('\n')}\n`)
    return path
  }

  test('are read the way a dotenv file is read', () => {
    const env = file([
      '# The settings of this deployment.',
      'PLATFORM_DOMAIN=localhost',
      'export PLATFORM_IDP_HOST=idp',
      'PLATFORM_PUBLIC_URL="https://platform.example.com"',
      "PLATFORM_ADMIN_PASSWORD='a secret'",
      'PLATFORM_EMPTY=',
    ])
    expect(saved(env, 'PLATFORM_DOMAIN')).toBe('localhost')
    expect(saved(env, 'PLATFORM_IDP_HOST')).toBe('idp')
    expect(saved(env, 'PLATFORM_PUBLIC_URL')).toBe('https://platform.example.com')
    expect(saved(env, 'PLATFORM_ADMIN_PASSWORD')).toBe('a secret')
    // A name with no value is no value at all.
    expect(saved(env, 'PLATFORM_EMPTY')).toBeUndefined()
    expect(saved(env, 'PLATFORM_NOT_THERE')).toBeUndefined()
  })

  test('the last value of a name is the one that counts, as it does for Compose', () => {
    const env = file(['PLATFORM_DOMAIN=first', 'PLATFORM_DOMAIN=second'])
    expect(saved(env, 'PLATFORM_DOMAIN')).toBe('second')
  })

  test('a file that is not there holds nothing', () => {
    expect(
      saved(join(tmpdir(), 'platform-env-that-is-not-there'), 'PLATFORM_DOMAIN')
    ).toBeUndefined()
  })
})
