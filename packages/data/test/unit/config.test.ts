import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEnv } from '../../src/runtime/config'

/** The files of the tests, removed at the end of the test. */
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    require('node:fs').rmSync(directory, { recursive: true, force: true })
  }
})

/** Creates a file that holds a secret and returns its path. */
function secretFile(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'data-env-'))
  directories.push(directory)
  const path = join(directory, 'secret')
  writeFileSync(path, content)
  return path
}

/** The environment of a production deployment of the api. */
function production(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  return {
    DATA_ENVIRONMENT: 'production',
    DATA_PROCESS_ROLE: 'api',
    DATA_DATABASE_URL: 'postgres://data@localhost:5432/data',
    DATA_REGISTRY_DATABASE_URL: 'postgres://registry@localhost:5432/data',
    DATA_SCHEMA_BUNDLE_FILE: '/app/schema.json',
    DATA_POLICY_BUNDLE_FILE: '/app/policies.json',
    DATA_GATEWAY_BINDINGS_FILE: '/app/bindings.json',
    DATA_ACCESS_URL: 'https://access.example.com',
    DATA_ACCESS_CONTEXT_TOKEN_FILE: secretFile('the-credential-of-the-contract-0001'),
    DATA_CURSOR_KEY_FILE: secretFile('the-key-that-signs-the-cursors-0001'),
    ...(overrides as Record<string, string>),
  }
}

describe('the environment of Data', () => {
  test('a production deployment of the api is accepted', () => {
    const settings = readEnv(production())
    expect(settings.production).toBe(true)
    expect(settings.role).toBe('api')
  })

  test('the credential of the access context that the repository publishes is refused', () => {
    // The file of the fixtures of the development machine is in the
    // repository: a deployment that mounts it holds a credential that
    // everybody knows.
    expect(() =>
      readEnv(
        production({
          DATA_ACCESS_CONTEXT_TOKEN_FILE: secretFile('development-access-context-token-0001'),
        })
      )
    ).toThrow(/DATA_ACCESS_CONTEXT_TOKEN_FILE holds a credential that the repository publishes/)
  })

  test('the key of the cursors that the repository publishes is refused', () => {
    expect(() =>
      readEnv(
        production({
          DATA_CURSOR_KEY_FILE: secretFile('cu1IBGmHyRF8rfNnCkftxqTEZCrJTZFqRb5DxVhMQWI='),
        })
      )
    ).toThrow(/DATA_CURSOR_KEY_FILE holds a key that the repository publishes/)
  })

  test('a development machine may use the fixtures of the repository', () => {
    const settings = readEnv(
      production({
        DATA_ENVIRONMENT: 'development',
        DATA_ACCESS_CONTEXT_TOKEN_FILE: secretFile('development-access-context-token-0001'),
        DATA_CURSOR_KEY_FILE: secretFile('cu1IBGmHyRF8rfNnCkftxqTEZCrJTZFqRb5DxVhMQWI='),
      })
    )
    expect(settings.production).toBe(false)
  })
})
