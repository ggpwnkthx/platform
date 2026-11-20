/**
 * A built site, served as the files it is.
 *
 * This is what a CDN does with the site, and nothing more: every file is sent as it was
 * written, with the headers the `_headers` file beside it lists. It is the server a local
 * stack puts behind its edge when it deploys an example; a real deployment publishes the
 * same files to a CDN and has no use for it.
 *
 * It loads nothing of the interface: the files are all there is to it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.map': 'application/json',
}

/** The file a path names in a built site: a page is the `index.html` of its folder. */
export function fileIn(dist: string, path: string): string | null {
  let clean: string
  try {
    clean = decodeURIComponent(path).replace(/^\/+|\/+$/g, '')
  } catch {
    return null
  }
  if (clean.split('/').includes('..')) return null
  const candidate = clean.includes('.') ? join(dist, clean) : join(dist, clean, 'index.html')
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}

type Rule = { path: string; headers: Record<string, string> }

/** The rules of a `_headers` file: a path, and the headers of what is under it. */
export function headerRules(text: string): Rule[] {
  const rules: Rule[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: {} })
      continue
    }
    const at = line.indexOf(':')
    const rule = rules.at(-1)
    if (at < 0 || !rule) continue
    rule.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return rules
}

/** The headers a path is served with: those of every rule it is under, the later ones last. */
export function headersFor(rules: Rule[], path: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const rule of rules) {
    const under = rule.path.endsWith('*')
      ? path.startsWith(rule.path.slice(0, -1))
      : path === rule.path
    if (under) Object.assign(headers, rule.headers)
  }
  return headers
}

/** Serves the site in a folder on a port, and returns the server. */
export function serveSite(dir: string, port: number) {
  const dist = resolve(dir)
  if (!existsSync(join(dist, 'index.html')))
    throw new Error(`There is no built site in ${dist}: build it with ui build first`)
  return Bun.serve({
    port,
    hostname: '0.0.0.0',
    fetch(request) {
      const path = new URL(request.url).pathname
      // The headers file is the server's own: it is not one of the site's pages.
      const file = path === '/_headers' ? null : fileIn(dist, path)
      if (!file) return new Response('Not found', { status: 404 })
      // Read on every request: a site that is built again is the one that is served.
      const rules = existsSync(join(dist, '_headers'))
        ? headerRules(readFileSync(join(dist, '_headers'), 'utf8'))
        : []
      return new Response(new Uint8Array(readFileSync(file)), {
        headers: {
          'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
          // Nothing is kept for long: config.json least of all, which names the relay.
          'cache-control': path === '/config.json' ? 'no-store' : 'no-cache',
          ...headersFor(rules, path),
        },
      })
    },
  })
}

/** The `ui serve` command. */
export function serve(args: string[]): number {
  const unknown = args.find((a) => !a.startsWith('--dir=') && !a.startsWith('--port='))
  if (unknown) throw new Error(`Unknown option: ${unknown}`)
  const dir = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? process.cwd()
  const port = Number(
    args.find((a) => a.startsWith('--port='))?.slice('--port='.length) ?? process.env.PORT ?? 8080
  )
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port')
  const server = serveSite(dir, port)
  console.log(`The site in ${resolve(dir)}, on http://localhost:${server.port}/`)
  return 0
}
