import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin, UserConfig } from 'vite'
import { parse } from 'yaml'
import { headersFile, runtimeConfigFrom } from './src/config.ts'

/**
 * The interface is never built on its own: a site — a folder with a platform.json — builds
 * it, with a vite.config.ts of two lines:
 *
 *   import { site } from '@platform/ui/vite'
 *   export default site(import.meta.dirname)
 *
 * `vite` serves the dev mode (PostgreSQL inside the page, installed with the SQL files the
 * folder applies), `vite build` writes the published site into the folder's `.dist`, and
 * `vite build --mode development` writes the dev mode as files.
 */
const root = import.meta.dirname
const repository = join(root, '../..')
interface SiteFolder {
  apply?: string[]
  extensions?: string
}

/**
 * Two modules the interface imports and a site provides: `virtual:platform-site` is the
 * site's extensions and, in the dev mode alone, the in-page PostgreSQL with what the folder
 * applies; `virtual:design-tokens` is DESIGN.md's own frontmatter, so the theme cannot
 * drift from the document.
 */
function platformSite(dir: string, inPage: boolean): Plugin {
  const folder: SiteFolder = JSON.parse(readFileSync(join(dir, 'platform.json'), 'utf8'))
  const from = (path: string, query = '') => JSON.stringify(resolve(dir, path) + query)
  const runtime = runtimeConfigFrom(process.env)
  const modules: Record<string, () => string> = {
    'virtual:design-tokens': () => {
      const frontmatter = readFileSync(join(repository, 'DESIGN.md'), 'utf8').split('---')[1]!
      return `export default ${JSON.stringify(parse(frontmatter))}`
    },
    'virtual:platform-site': () => {
      const lines = folder.extensions ? [`import ${from(folder.extensions)}`] : []
      if (!inPage) return [...lines, 'export const startInPage = null'].join('\n')
      const files = [join(repository, 'migrations/0001_platform.sql'), ...(folder.apply ?? [])]
      return [
        ...lines,
        `import { inPage } from ${JSON.stringify(join(root, 'src/session/inpage.ts'))}`,
        ...files.map((file, at) => `import sql${at} from ${from(file, '?raw')}`),
        `export const startInPage = inPage([${files.map((_, at) => `sql${at}`).join(', ')}])`,
      ].join('\n')
    },
  }
  return {
    name: 'platform-site',
    resolveId: (source) => (source in modules ? `\0${source}` : undefined),
    load: (id) => modules[id.slice(1)]?.(),
    configureServer(server) {
      server.middlewares.use('/config.json', (_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(runtime))
      })
    },
    generateBundle() {
      const asset = (fileName: string, source: string) =>
        this.emitFile({ type: 'asset', fileName, source })
      asset('config.json', JSON.stringify(runtime, null, 2))
      asset('_headers', headersFile(runtime, inPage))
    },
  }
}

export const site =
  (dir: string) =>
  ({ mode }: { mode: string }): UserConfig => ({
    root,
    plugins: [react(), platformSite(dir, mode !== 'production')],
    cacheDir: join(repository, 'node_modules/.vite'),
    // PGlite finds its own WebAssembly beside itself; pre-bundling would move it away.
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    // Nothing is inlined as a data: address: the site's headers let the pages load 'self' alone.
    build: {
      // The published site and the dev mode may be written side by side: PLATFORM_DIST names the folder.
      outDir: join(dir, process.env.PLATFORM_DIST ?? '.dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: 0,
    },
    server: { fs: { allow: [repository, dirname(dir)] } },
    preview: { headers: previewHeaders(mode !== 'production') },
  })

/** `vite preview` serves the built site with the headers a CDN would be given. */
function previewHeaders(inPage: boolean) {
  const lines = headersFile(runtimeConfigFrom(process.env), inPage).split('\n').slice(1)
  return Object.fromEntries(
    lines.filter(Boolean).map((line) => {
      const [name, ...value] = line.trim().split(': ')
      return [name!, value.join(': ')]
    })
  )
}
