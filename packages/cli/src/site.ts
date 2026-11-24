import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Applied } from '@platform/core'
import type { SiteFiles } from '@platform/ui/vite'
import { z } from 'zod'

export const ROOT = resolve(import.meta.dir, '../../..')
const file = z.string().min(1)
/** What a folder says of itself: what it applies to a database, and the module of its own renderers. */
const schema = z.strictObject({
  apply: z
    .strictObject({ models: file, migration: file.optional(), demo: file.optional() })
    .optional(),
  extensions: file.optional(),
})

/** platform.json, with the files it names resolved and checked. Null where a folder has none. */
export function siteFiles(dir: string): SiteFiles | null {
  const path = join(resolve(dir), 'platform.json')
  if (!existsSync(path)) return null
  const said = schema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const named = (name: string) => {
    const full = resolve(dir, name)
    if (!existsSync(full)) throw new Error(`${path}: there is no file at ${name}.`)
    return full
  }
  return {
    extensions: said.extensions && named(said.extensions),
    apply: said.apply && {
      models: named(said.apply.models),
      migration: said.apply.migration && named(said.apply.migration),
      demo: said.apply.demo && named(said.apply.demo),
    },
  }
}

/** What a folder applies, read: the manifest (JSON, or a module's default export) and the SQL beside it. */
export async function readApplied(dir: string): Promise<Applied> {
  const files = siteFiles(dir)
  if (!files) throw new Error(`There is no platform.json in ${resolve(dir)}`)
  if (!files.apply)
    throw new Error(`${join(resolve(dir), 'platform.json')} names nothing to apply.`)
  const text = (path?: string) => (path ? readFileSync(path, 'utf8') : undefined)
  const models = files.apply.models.endsWith('.json')
    ? JSON.parse(text(files.apply.models)!)
    : (await import(files.apply.models)).default
  if (models === undefined)
    throw new Error(`${files.apply.models} exports no manifest: its default export is the models.`)
  return { models, migration: text(files.apply.migration), demo: text(files.apply.demo) }
}

export interface UiOptions {
  /** The site's folder, which holds platform.json: the interface is only ever built as a site. */
  dir: string
  production?: boolean
  relay?: string
  port?: number
}
/**
 * The site of a folder, built into the folder's `.dist`. A folder that applies something is
 * built as the dev mode, with PostgreSQL in the page, unless the published interface is asked
 * for. A folder whose platform.json is `{}` is the platform's interface and nothing more.
 */
async function site(options: UiOptions, relayUrl?: string) {
  const { runtimeConfigFrom } = await import('@platform/ui/config')
  const files = siteFiles(options.dir)
  if (!files) throw new Error(`There is no platform.json in ${resolve(options.dir)}`)
  return {
    files,
    inPage: !!files.apply && !options.production && !options.relay,
    runtime: runtimeConfigFrom(process.env, relayUrl),
    outDir: join(resolve(options.dir), '.dist'),
  }
}
export async function buildUi(options: UiOptions): Promise<string> {
  const { buildSite } = await import('@platform/ui/vite')
  const built = await site(options)
  await buildSite(built)
  return built.outDir
}
export async function devUi(options: UiOptions) {
  const { devSite } = await import('@platform/ui/vite')
  const port = options.port ?? Number(process.env.PORT ?? 5173)
  let relayUrl: string | undefined
  if (options.relay) {
    // The real interface against a real PostgreSQL: its sessions are forwarded as the deployment's relay does.
    const { startRelay } = await import('@platform/relay')
    const [host, upstream] = options.relay.split(':')
    if (!host || !upstream) throw new Error('--relay is HOST:PORT')
    const relay = startRelay({
      upstream: { host, port: Number(upstream) },
      port: 0,
      allowedOrigins: [`http://localhost:${port}`],
    })
    relayUrl = `ws://localhost:${relay.port}`
  }
  const server = await devSite(await site(options, relayUrl), port)
  server.printUrls()
}

const types: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  wasm: 'application/wasm',
}
/** Serves a built site as the files it is, with the headers its _headers file lists. A real deployment uses a CDN. */
export function serveUi(dir: string, port: number) {
  const listed = existsSync(join(dir, '_headers'))
    ? readFileSync(join(dir, '_headers'), 'utf8')
    : ''
  const headers = Object.fromEntries(
    [...listed.matchAll(/^ {2}([\w-]+): (.*)$/gm)].map((m) => [m[1]!, m[2]!])
  )
  return Bun.serve({
    port,
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname)
      if (path.includes('..')) return new Response('Not found\n', { status: 404 })
      for (const candidate of [path, join(path, 'index.html')]) {
        const found = Bun.file(join(dir, candidate))
        if (!candidate.endsWith('/') && (await found.exists()))
          return new Response(found, {
            headers: {
              ...headers,
              'content-type': types[candidate.split('.').pop() ?? ''] ?? found.type,
            },
          })
      }
      return new Response('Not found\n', { status: 404, headers })
    },
  })
}
