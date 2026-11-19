/**
 * The interface in development, served as the static files it is.
 *
 * The site is built by a fresh process every time, so that a change to the sources is read
 * and not the module that was loaded before it.
 */
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { securityHeaders } from '@platform/ui/headers.ts'
import { publicFiles, root, sources } from '@platform/ui/paths.ts'
import type { InterfaceConfig } from './config.ts'

const types: Record<string, string> = {
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

/** The interface, served on a port, with the site it serves beside it. */
export async function serveInterface(
  config: InterfaceConfig | null,
  options: { relay?: string; port: number }
): Promise<void> {
  const relay = options.relay
  // With a relay, the real interface is served: the pages sign in through the issuer and
  // reach PostgreSQL through the relay. Without one, the configuration says how it runs.
  const development = !relay && config?.mode === 'development'
  const dist = config?.out
    ? join(config.dir, config.out)
    : development
      ? join(config!.dir, '.dist')
      : join(root, 'dist')
  const port = options.port

  async function build(): Promise<boolean> {
    const args = ['bun', join(import.meta.dir, '..', 'cli.ts'), 'ui', 'build']
    if (development) args.push(`--dir=${config!.dir}`)
    else args.push('--production')
    const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' })
    return (await child.exited) === 0
  }

  function fileFor(path: string): string | null {
    const clean = decodeURIComponent(path).replace(/^\/+|\/+$/g, '')
    if (clean.split('/').includes('..')) return null
    const candidate = clean.includes('.') ? join(dist, clean) : join(dist, clean, 'index.html')
    return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
  }

  // The same headers a CDN serves the built site with, from the same source.
  const issuer = JSON.parse(readFileSync(join(publicFiles, 'config.json'), 'utf8')).issuer as string
  const headers = securityHeaders({
    public: `http://localhost:${port}`,
    issuer,
    relay: `ws://localhost:${port}`,
  })
  // WebAssembly is allowed only here, in development, where PostgreSQL itself runs in the page.
  if (development)
    headers['Content-Security-Policy'] = headers['Content-Security-Policy']!.replace(
      "script-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'"
    )

  if (!(await build())) process.exit(1)

  const [relayHost, relayPort] = relay ? relay.split(':') : []
  type Pipe = { socket: ReturnType<typeof connect> | null }

  Bun.serve<Pipe>({
    port,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === '/pg' && relay) {
        if (server.upgrade(request, { data: { socket: null } })) return undefined
        return new Response('Expected a WebSocket', { status: 426 })
      }
      const file = fileFor(url.pathname)
      if (!file) return new Response('Not found', { status: 404 })
      // The built site's config.json names the deployment's relay; the development server
      // relays /pg itself, so it serves the configuration the source holds.
      const content =
        url.pathname === '/config.json'
          ? readFileSync(join(publicFiles, 'config.json'), 'utf8')
          : new Uint8Array(readFileSync(file))
      return new Response(content, {
        headers: {
          'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
          'cache-control': 'no-store',
          ...headers,
        },
      })
    },
    websocket: {
      open(ws) {
        const socket = connect({ host: relayHost, port: Number(relayPort ?? 5432) })
        ws.data.socket = socket
        socket.on('data', (chunk) => ws.sendBinary(chunk as Buffer))
        socket.on('close', () => ws.close())
        socket.on('error', () => ws.close())
      },
      message(ws, message) {
        ws.data.socket?.write(
          typeof message === 'string' ? Buffer.from(message) : new Uint8Array(message)
        )
      },
      close(ws) {
        ws.data.socket?.end()
      },
    },
  })

  console.log(
    `The interface${development ? ', with PostgreSQL in the page,' : `, relaying /pg to ${relay},`} on http://localhost:${port}/`
  )

  let timer: ReturnType<typeof setTimeout> | null = null
  const rebuild = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void build(), 150)
  }
  // The interface, and what it runs on: a change to either rebuilds the pages.
  watch(sources, { recursive: true }, (_, name) => {
    if (!name || name.startsWith('dist')) return
    rebuild()
  })
  if (development)
    watch(config!.dir, { recursive: true }, (_, name) => {
      // The built site is written inside this folder: it is not a change to rebuild for.
      if (!name || name.startsWith('.dist')) return
      rebuild()
    })
}
