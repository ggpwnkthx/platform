import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { headersFile, type Origins } from './headers.ts'

/**
 * Static site generation for the interface. Every page is rendered to HTML at build time
 * with the router's own prerenderer, and one client bundle hydrates it. Nothing is rendered
 * at request time: the output is files, served by any static web server.
 *
 *   bun run build:ui          the real interface: it speaks to PostgreSQL through the relay
 *   bun run build:ui --dev    the development interface: PostgreSQL runs inside the page
 *
 * A build is one process: the development build swaps the database seam before the app is
 * imported, so the prerendered pages and the bundle read the same one.
 */

const project = join(import.meta.dir, '..')
const sources = join(project, 'src')

/** The seam between the interface and its database, and what the development build puts there. */
function inPageDatabase(): Bun.BunPlugin {
  const replacement = join(sources, 'dev/database.ts')
  return {
    name: 'in-page-database',
    setup(build) {
      build.onResolve({ filter: /\/db\/connect\.ts$/ }, (args) =>
        args.importer.endsWith('dev/database.ts') ? undefined : { path: replacement }
      )
    },
  }
}

function page(body: string, title: string, dev: boolean): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title} · Platform${dev ? ' (development)' : ''}</title>
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

export async function buildUi(dev: boolean, out: string): Promise<number> {
  if (dev) Bun.plugin(inPageDatabase())
  // Imported after the seam is in place, so the prerender reads the same database as the bundle.
  const { prerender } = await import('preact-iso')
  const { locationStub } = await import('preact-iso/prerender')
  const { App } = await import('../src/app.tsx')
  const { fileFor, pages } = await import('../src/routes.ts')

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const bundle = await Bun.build({
    entrypoints: [join(sources, 'main.tsx')],
    target: 'browser',
    format: 'esm',
    minify: !dev,
    sourcemap: dev ? 'linked' : 'none',
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
    plugins: dev ? [inPageDatabase()] : [],
    naming: 'app.[ext]',
    outdir: out,
  })
  if (!bundle.success) throw new Error(bundle.logs.map((log) => String(log)).join('\n'))

  await cp(join(sources, 'styles.css'), join(out, 'styles.css'))
  await cp(join(sources, 'favicon.svg'), join(out, 'favicon.svg'))
  await cp(join(project, 'public'), out, { recursive: true })
  await writeFile(join(out, 'config.json'), JSON.stringify(await siteConfig(dev), null, 2))
  await writeFile(join(out, '_headers'), headersFile(siteOrigins()))
  if (!dev && !process.env.PLATFORM_RELAY_URL)
    console.warn(
      'PLATFORM_RELAY_URL is not set: the pages will look for the relay on their own origin. Set it to the relay\u2019s address (wss://...) before publishing.'
    )
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
    await cp(join(project, 'node_modules', from), join(out, 'fonts', name))
  if (dev) {
    // PostgreSQL itself, compiled to WebAssembly, for the in-page database.
    await mkdir(join(out, 'dev'), { recursive: true })
    for (const file of ['pglite.wasm', 'initdb.wasm', 'pglite.data'])
      await cp(
        join(project, 'node_modules/@electric-sql/pglite/dist', file),
        join(out, 'dev', file)
      )
  }

  for (const { path, title } of pages) {
    const target = join(out, fileFor(path))
    await mkdir(dirname(target), { recursive: true })
    locationStub(path)
    const { html } = await prerender(<App />)
    await writeFile(target, page(html, title, dev))
  }
  return pages.length
}

/**
 * The deployment's names, as the environment gives them. The pages are static, so these are
 * the only things that differ between one deployment and the next: the bundle itself is the
 * same file everywhere.
 */
export function siteOrigins(env: Record<string, string | undefined> = process.env): Origins {
  const publicUrl = env.PLATFORM_PUBLIC_URL ?? 'http://localhost:5173'
  const issuer = env.PLATFORM_ISSUER ?? env.OIDC_ISSUER ?? 'http://localhost:5556/dex'
  const relay = env.PLATFORM_RELAY_URL ?? 'ws://localhost:8081'
  return { public: publicUrl, issuer, relay }
}

/**
 * The file the pages read to find the issuer, the relay and the database. It is served
 * beside the pages, so a deployment changes it without rebuilding the bundle.
 */
async function siteConfig(dev: boolean): Promise<Record<string, unknown>> {
  const env = process.env
  const file = await readFile(join(project, 'public/config.json'), 'utf8')
  const base = JSON.parse(file) as Record<string, unknown>
  return {
    ...base,
    issuer: env.PLATFORM_ISSUER ?? env.OIDC_ISSUER ?? base.issuer,
    clientId: env.PLATFORM_CLIENT_ID ?? base.clientId,
    claim: env.PLATFORM_CLAIM ?? base.claim,
    relay: dev ? base.relay : (env.PLATFORM_RELAY_URL ?? base.relay),
    database: env.PLATFORM_DATABASE_NAME ?? base.database,
    statementTimeoutMs: Number(
      env.PLATFORM_STATEMENT_TIMEOUT_MS ?? base.statementTimeoutMs ?? 15000
    ),
  }
}

if (import.meta.main) {
  const dev = process.argv.includes('--dev')
  const out = join(project, dev ? 'dist-dev' : 'dist')
  const count = await buildUi(dev, out)
  console.log(
    `Built ${count} static pages and one client bundle in ${out.replace(join(project, '..', '..'), '.')}${dev ? ' (development: PostgreSQL runs in the page)' : ''}`
  )
}
