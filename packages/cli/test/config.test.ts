import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyFiles, findConfig, readApplied } from '../src/config.ts'
import { manifestOf } from '../src/folder.ts'
import { examplesIn } from '../src/deployment/config.ts'
import { siteConfig, siteOrigins } from '../src/ui/build.ts'

/**
 * What a folder says of itself: `platform.json` names what the folder applies and what it
 * adds to the interface, and every tool reads the same file.
 */
const newsroom = join(import.meta.dir, '..', '..', '..', 'examples', 'newsroom')

function folder(config: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'platform-folder-'))
  writeFileSync(join(dir, 'platform.json'), JSON.stringify(config))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

describe('what a folder applies', () => {
  test('the example names its three files, and they are read as they are', () => {
    const config = findConfig(newsroom)!
    expect(config.apply).toEqual({
      models: 'apply/models.ts',
      migration: 'apply/migration.sql',
      demo: 'apply/demo.sql',
    })
    expect(applyFiles(config).models).toBe(join(newsroom, 'apply', 'models.ts'))
    const example = readApplied(config)
    // The models are a module: a function of what the deployment says of itself.
    expect((manifestOf(example, { admin: 'root@corp.example' }) as { format: number }).format).toBe(
      1
    )
    expect(example.migration).toContain('item_metadata')
    expect(example.demo).toContain('INSERT INTO newsroom.sections')
  })

  test('the files are named as the folder likes, and the SQL is its own to leave out', () => {
    const dir = folder({ apply: { models: 'schema.json' } }, { 'schema.json': '{"format":1}' })
    expect(readApplied(findConfig(dir)!)).toEqual({
      models: { format: 1 },
      migration: undefined,
      demo: undefined,
    })
  })

  test('a file that is not there is refused when the configuration is read', () => {
    expect(() => findConfig(folder({ apply: { models: 'models.json' } }))).toThrow(
      /no file at models\.json/
    )
    const dir = folder(
      { apply: { models: 'models.json', demo: 'demo.sql' } },
      { 'models.json': '{}' }
    )
    expect(() => findConfig(dir)).toThrow(/no file at demo\.sql/)
  })

  test('SQL without a schema is refused', () => {
    const dir = folder({ apply: { demo: 'demo.sql' } }, { 'demo.sql': '' })
    expect(() => findConfig(dir)).toThrow(/apply needs models/)
  })

  test('a folder that applies nothing has nothing to read', () => {
    const config = findConfig(folder({}))!
    expect(config.apply).toBeUndefined()
    expect(() => readApplied(config)).toThrow(/names nothing to apply/)
  })

  test('what a folder does not say is refused, and so is where it runs', () => {
    for (const key of ['mode', 'database', 'out', 'site', 'issuer'])
      expect(() => findConfig(folder({ [key]: 'x' }))).toThrow(
        new RegExp(`${key} is not something a folder says of itself`)
      )
    expect(() => findConfig(folder({ apply: { models: 'm.json', seed: 's.sql' } }))).toThrow(
      /seed is not something a folder applies/
    )
  })
})

describe('the examples of a checkout', () => {
  test('are the folders that say they apply something', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-checkout-'))
    const make = (name: string, config: unknown | null, files: Record<string, string> = {}) => {
      mkdirSync(join(root, 'examples', name), { recursive: true })
      const dir = join(root, 'examples', name)
      if (config !== null) writeFileSync(join(dir, 'platform.json'), JSON.stringify(config))
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
    }
    make('applies', { apply: { models: 'models.json' } }, { 'models.json': '{}' })
    make('extends', { extensions: 'own.ts' }, { 'own.ts': 'export {}' })
    make('says-nothing', null, { 'package.json': '{}' })
    expect(examplesIn(root)).toEqual(['applies'])
  })

  test('the newsroom is one', () => {
    expect(examplesIn(join(newsroom, '..', '..'))).toContain('newsroom')
  })
})

describe('where a site runs', () => {
  test('is the platform’s own defaults, when the environment says nothing', () => {
    expect(siteConfig(undefined, {})).toEqual({
      issuer: 'http://idp.localhost:5556',
      clientId: 'platform-console',
      claim: 'email',
      relay: '/pg',
      database: 'platform',
      statementTimeoutMs: 15000,
    })
  })

  test('is what the environment says, and the relay the build was given', () => {
    const config = siteConfig('wss://api.example.org', {
      PLATFORM_ISSUER: 'https://idp.example.org',
      PLATFORM_CLIENT_ID: 'console',
      PLATFORM_CLAIM: 'sub',
      PLATFORM_DATABASE_NAME: 'main',
      PLATFORM_STATEMENT_TIMEOUT_MS: '5000',
    })
    expect(config).toEqual({
      issuer: 'https://idp.example.org',
      clientId: 'console',
      claim: 'sub',
      relay: 'wss://api.example.org',
      database: 'main',
      statementTimeoutMs: 5000,
    })
  })

  test('the headers allow the issuer config.json sends the pages to', () => {
    for (const env of [{}, { OIDC_ISSUER: 'https://idp.example.org' }]) {
      const config = siteConfig(undefined, env)
      expect(siteOrigins(config, env).issuer).toBe(config.issuer)
    }
  })
})
