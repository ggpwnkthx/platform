import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sources } from '@platform/ui/paths.ts'
import { extensionsPlugin } from '../src/ui/build.ts'
import { extensionsModule, findConfig } from '../src/config.ts'

/**
 * A site's own field types and renderers: the configuration names the module that holds
 * them, and the build puts it in the place of the interface's own, which is empty.
 */
const newsroom = join(import.meta.dir, '..', '..', '..', 'examples', 'newsroom')

function site(config: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'platform-site-'))
  writeFileSync(join(dir, 'platform.json'), JSON.stringify(config))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

async function bundle(plugins: Bun.BunPlugin[]): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), 'platform-bundle-'))
  const built = await Bun.build({
    entrypoints: [join(sources, 'main.tsx')],
    target: 'browser',
    format: 'esm',
    plugins,
    naming: 'app.[ext]',
    outdir: out,
  })
  expect(built.success).toBe(true)
  return readFileSync(join(out, 'app.js'), 'utf8')
}

describe('the extensions a site names', () => {
  test('a configuration that names none has none', () => {
    const config = findConfig(site({}))
    expect(config?.extensions).toBeUndefined()
    expect(extensionsModule(config)).toBeNull()
    expect(extensionsModule(null)).toBeNull()
  })

  test('the module is named relative to the configuration', () => {
    const dir = site({ extensions: 'own.ts' }, { 'own.ts': 'export {}' })
    expect(extensionsModule(findConfig(dir))).toBe(join(dir, 'own.ts'))
  })

  test('a module that is not there is refused when the configuration is read', () => {
    const dir = site({ extensions: 'missing.ts' })
    expect(() => findConfig(dir)).toThrow(/no file at missing\.ts/)
  })

  test('the example names its own', () => {
    expect(extensionsModule(findConfig(newsroom))).toBe(join(newsroom, 'extensions.tsx'))
  })
})

describe('the extensions seam', () => {
  test('the interface itself holds no renderer of a site’s', async () => {
    expect(await bundle([])).not.toContain('reading-time')
  })

  test('a site’s module, JSX and all, is built into the bundle in the seam’s place', async () => {
    const text = await bundle([extensionsPlugin(join(newsroom, 'extensions.tsx'))])
    expect(text).toContain('reading-time')
    // The site registers with the registry the interface reads: there is one, not two.
    expect(text.split('As the platform draws it').length).toBe(
      (await bundle([])).split('As the platform draws it').length
    )
  })
})
