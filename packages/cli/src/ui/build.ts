/**
 * The builder: the interface as a static site.
 *
 * Every page is rendered to HTML at build time with the interface's own prerenderer, and
 * one client bundle hydrates it. Nothing is rendered at request time: the output is files,
 * served by any static web server.
 *
 * A build is one process. Whoever asks for a build may reshape it — a development build
 * swaps the database seam for a PostgreSQL in the page, installed from the files its folder
 * applies, and a site that has field types and renderers of its own swaps them in for the
 * interface's empty ones — and the prerendered pages and the bundle are built from the same
 * shape.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { headersFile } from '@platform/ui/headers.ts'
import { root, sources } from '@platform/ui/paths.ts'
import { siteConfig, siteOrigins } from './site-config.ts'

export { siteConfig, siteOrigins } from './site-config.ts'
export { extensionsPlugin, inPageAssets, seamPlugin } from './plugins.ts'

/** How a site is built: where it goes, what it is called, and what shapes it. */
export type SiteBuild = {
  /** The folder the site is written to. */
  out: string
  /** The environment the pages believe they run in. */
  environment?: 'development' | 'production'
  /** The title the pages carry after the site's name. */
  title?: string
  /** The relay the pages look for. The platform's own default when it is not given. */
  relay?: string
  /** Plugins that reshape the bundle and the pages. */
  plugins?: Bun.BunPlugin[]
  /** Files copied into the site, beside the pages. */
  assets?: { from: string; to: string }[]
}

/**
 * The version of the platform this interface is built for. The installation must be the
 * same version: the interface reads the platform's schema, and a schema of another version
 * is not one it knows.
 */
async function platformVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(root, '..', '..', 'package.json'), 'utf8'))
  return manifest.version as string
}

function page(body: string, title: string, suffix: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title} · Platform${suffix}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="root">${body}</div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`
}

/** Builds the interface and writes it to a folder. Returns the number of pages. */
export async function buildSite(build: SiteBuild): Promise<number> {
  const dev = build.environment === 'development'
  // The plugins are installed for the whole process, before the application is imported, so
  // that the prerendered pages and the bundle are built from the same shape.
  for (const plugin of build.plugins ?? []) Bun.plugin(plugin)
  const version = await platformVersion()
  // The pages are rendered in this process, so the version is here as well as in the bundle.
  process.env.PLATFORM_VERSION = version
  // Imported after the plugins are in place, so the prerender reads the same database as the bundle.
  const { renderPages } = await import('@platform/ui/prerender.tsx')

  const out = build.out
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const bundle = await Bun.build({
    entrypoints: [join(sources, 'main.tsx')],
    target: 'browser',
    format: 'esm',
    minify: !dev,
    sourcemap: dev ? 'linked' : 'none',
    define: {
      'process.env.NODE_ENV': dev ? '"development"' : '"production"',
      'process.env.PLATFORM_VERSION': JSON.stringify(version),
    },
    plugins: build.plugins ?? [],
    naming: 'app.[ext]',
    outdir: out,
  })
  if (!bundle.success) throw new Error(bundle.logs.map((log) => String(log)).join('\n'))

  await cp(join(sources, 'styles.css'), join(out, 'styles.css'))
  await cp(join(sources, 'favicon.svg'), join(out, 'favicon.svg'))
  // Both files say where the site runs, and both are written from the one answer.
  const config = siteConfig(build.relay)
  await writeFile(join(out, 'config.json'), JSON.stringify(config, null, 2))
  await writeFile(join(out, '_headers'), headersFile(siteOrigins(config)))
  await mkdir(join(out, 'fonts'), { recursive: true })
  const fonts = {
    'inter-latin-wght-normal.woff2':
      '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    'inter-latin-ext-wght-normal.woff2':
      '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2',
    'jetbrains-mono-latin-400-normal.woff2':
      '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
    'jetbrains-mono-latin-500-normal.woff2':
      '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2',
  }
  for (const [name, from] of Object.entries(fonts))
    await cp(join(import.meta.dir, '..', '..', 'node_modules', from), join(out, 'fonts', name))
  for (const asset of build.assets ?? []) {
    await mkdir(dirname(join(out, asset.to)), { recursive: true })
    await cp(asset.from, join(out, asset.to))
  }

  const rendered = await renderPages()
  for (const { file, title, html } of rendered) {
    const target = join(out, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, page(html, title, build.title ?? ''))
  }
  return rendered.length
}
