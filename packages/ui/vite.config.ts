import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import react from '@vitejs/plugin-react'
import { build, createServer, type InlineConfig, type Plugin } from 'vite'
import { headersFile, pages, type RuntimeConfig } from './src/config.ts'

/**
 * The interface is never built on its own: a site — a folder with a platform.json — builds it,
 * through `buildSite` and `devSite`, into that folder's `.dist`. This file exports no Vite
 * config of its own, so `vite` run here has nothing to build.
 */
const root = import.meta.dirname
const migrations = join(root, '../../migrations/0001_platform.sql')

/** What a folder's platform.json names, as files: its extensions and what it applies. */
export interface SiteFiles {
  extensions?: string
  apply?: { models: string; migration?: string; demo?: string }
}
export interface SiteOptions {
  files?: SiteFiles
  /** Build the dev mode: PostgreSQL inside the page, installed with what the folder applies. */
  inPage?: boolean
  runtime: RuntimeConfig
  outDir: string
}

/**
 * The one seam between the interface and a site: `virtual:platform-site` is the site's
 * extensions and, in the dev mode alone, the in-page PostgreSQL with what the folder applies.
 * A published build gets `startInPage = null`, so the in-page database never reaches it.
 */
function platformSite({ files = {}, inPage = false, runtime, outDir }: SiteOptions): Plugin {
  const id = '\0virtual:platform-site'
  const from = (path: string, query = '') => JSON.stringify(path + query)
  return {
    name: 'platform-site',
    resolveId: (source) => (source === 'virtual:platform-site' ? id : undefined),
    load(loaded) {
      if (loaded !== id) return
      const lines = files.extensions ? [`import ${from(files.extensions)}`] : []
      if (!inPage || !files.apply) return [...lines, 'export const startInPage = null'].join('\n')
      const { models, migration, demo } = files.apply
      return [
        ...lines,
        `import { inPage } from ${from(join(root, 'src/inpage.ts'))}`,
        `import platform from ${from(migrations, '?raw')}`,
        `import models from ${from(models)}`,
        migration
          ? `import migration from ${from(migration, '?raw')}`
          : 'const migration = undefined',
        demo ? `import demo from ${from(demo, '?raw')}` : 'const demo = undefined',
        'export const startInPage = inPage(platform, { models, migration, demo })',
      ].join('\n')
    },
    configureServer(server) {
      server.middlewares.use('/config.json', (_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(runtime))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'config.json',
        source: JSON.stringify(runtime, null, 2),
      })
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(runtime, inPage) })
    },
    // Each page is its own file, so a bookmark, a new tab and a reload all land on a real page.
    closeBundle() {
      for (const path of Object.keys(pages).slice(1)) {
        const file = join(outDir, path, 'index.html')
        mkdirSync(dirname(file), { recursive: true })
        copyFileSync(join(outDir, 'index.html'), file)
      }
    },
  }
}

export const siteConfig = (options: SiteOptions): InlineConfig => ({
  root,
  configFile: false,
  plugins: [react(), platformSite(options)],
  // The one node_modules is the workspace's: Vite's cache goes there, not beside this package.
  cacheDir: join(root, '../../node_modules/.vite'),
  // PGlite finds its own WebAssembly beside itself; pre-bundling would move it away.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  // Nothing is inlined as a data: address: the site's own headers let the pages load 'self' alone.
  build: {
    outDir: options.outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
  server: {
    fs: {
      allow: [
        join(root, '../..'),
        ...[options.files?.extensions, ...Object.values(options.files?.apply ?? {})]
          .filter((path) => path !== undefined)
          .map((path) => dirname(path)),
      ],
    },
  },
})

/** Writes a site out as the files a CDN is given. */
export const buildSite = (options: SiteOptions) => build(siteConfig(options))
/** Serves a site while it is worked on, rebuilding what changes. */
export async function devSite(options: SiteOptions, port: number) {
  const config = siteConfig(options)
  const server = await createServer({
    ...config,
    server: { ...config.server, port, strictPort: true },
  })
  await server.listen()
  return server
}
