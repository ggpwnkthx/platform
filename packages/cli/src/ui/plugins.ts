import { dirname, join, resolve } from 'node:path'
import { sources } from '@platform/ui/paths.ts'
import type { ApplyFiles } from '../config.ts'

/** PostgreSQL in the page, and what makes the seam's database of what a folder applies. */
const inPageModule = join(import.meta.dir, '..', 'in-page.ts')

/** What tells the manifest's schemas not to compile themselves: see the module. */
const noEvalModule = join(import.meta.dir, '..', 'no-eval.ts')

/**
 * The seam: the interface's own database, replaced by a PostgreSQL that runs in the page,
 * installed from the files a folder applies.
 *
 * The seam is loaded as a module that imports those files and hands them over: the manifest
 * as what it says, the SQL as its text. Nothing is written in the folder to make it so.
 */
export function seamPlugin(files: ApplyFiles): Bun.BunPlugin {
  const seam = join(sources, 'pg', 'connect.ts')
  const text = (name: string, path: string | undefined) =>
    path === undefined
      ? `const ${name} = undefined`
      : `import ${name} from ${JSON.stringify(path)} with { type: 'text' }`
  const contents = [
    // First, so that it has run before the in-page module's schemas are made.
    `import ${JSON.stringify(noEvalModule)}`,
    `import { inPage } from ${JSON.stringify(inPageModule)}`,
    `import models from ${JSON.stringify(files.models)}`,
    text('migration', files.migration),
    text('demo', files.demo),
    'export const { connect, withoutIssuer } = inPage({ models, migration, demo })',
    '',
  ].join('\n')
  return {
    name: 'the-database-seam',
    setup(build) {
      build.onLoad({ filter: /[\\/]pg[\\/]connect\.ts$/ }, (args) =>
        resolve(args.path) === seam ? { contents, loader: 'ts' } : undefined
      )
    },
  }
}

/**
 * The other seam: the interface's own extensions, which are empty, replaced by the module a
 * site names. The module registers the site's field types and renderers with what the
 * interface publishes — `@platform/ui/fields/registry.ts`, `@platform/ui/fields/renderers.tsx`
 * — and it is imported before any page draws a field, in the prerender and in the bundle.
 *
 * The seam is not resolved to the site's module: it is loaded as a module that imports it.
 * The site's module is then found as any other is, so it is compiled as its own directory
 * says — its JSX is its own `tsconfig.json`'s — and it may be named `extensions.ts` too.
 */
export function extensionsPlugin(extensions: string): Bun.BunPlugin {
  const replacement = resolve(extensions)
  const seam = join(sources, 'extensions.ts')
  return {
    name: 'the-extensions-seam',
    setup(build) {
      build.onLoad({ filter: /[\\/]extensions\.ts$/ }, (args) =>
        resolve(args.path) === seam
          ? { contents: `import ${JSON.stringify(replacement)}\n`, loader: 'ts' }
          : undefined
      )
    },
  }
}

/**
 * PostgreSQL itself, compiled to WebAssembly: what the in-page database runs on. It is
 * found where the tools find it themselves.
 */
export function inPageAssets(): { from: string; to: string }[] {
  const dist = dirname(Bun.resolveSync('@electric-sql/pglite', import.meta.dir))
  return ['pglite.wasm', 'initdb.wasm', 'pglite.data'].map((file) => ({
    from: join(dist, file),
    to: join('dev', file),
  }))
}
