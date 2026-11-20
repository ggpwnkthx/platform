/**
 * The interface in development, served as the static files it is.
 *
 * The site is built by a fresh process every time, so that a change to the sources is read
 * and not the module that was loaded before it.
 */
import { readFileSync, watch } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { securityHeaders } from '@platform/ui/headers.ts'
import { root, sources } from '@platform/ui/paths.ts'
import type { FolderConfig } from '../config.ts'
import { fileIn, types } from './serve.ts'

/** The interface, served on a port, with the site it serves beside it. */
export async function serveInterface(
  config: FolderConfig | null,
  options: { relay?: string; port: number }
): Promise<void> {
  const relay = options.relay
  // With a relay, the real interface is served: the pages sign in through the issuer and
  // reach PostgreSQL through the relay. Without one, a folder that applies something runs
  // with it installed in the page.
  const development = !relay && config?.apply !== undefined
  // The site the server serves is the site it builds: the example's own in development,
  // the published one when a relay is in front of PostgreSQL.
  const dist = development ? join(config!.dir, '.dist') : join(root, 'dist')
  const port = options.port

  async function build(): Promise<boolean> {
    const args = ['bun', join(import.meta.dir, '..', 'cli.ts'), 'ui', 'build']
    if (development) args.push(`--dir=${config!.dir}`)
    else args.push('--production')
    const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' })
    return (await child.exited) === 0
  }

  const fileFor = (path: string) => fileIn(dist, path)

  if (!(await build())) process.exit(1)

  // The site the build wrote: what it says about the issuer and the relay. The
  // development server is the relay, so it says so itself.
  const site: Record<string, unknown> = {
    ...(JSON.parse(readFileSync(join(dist, 'config.json'), 'utf8')) as Record<string, unknown>),
    relay: '/pg',
  }
  // The same headers a CDN serves the built site with, from the same source.
  const headers = securityHeaders({
    public: `http://localhost:${port}`,
    issuer: String(site.issuer ?? ''),
    relay: `ws://localhost:${port}`,
  })
  // WebAssembly is allowed only here, in development, where PostgreSQL itself runs in the page.
  if (development)
    headers['Content-Security-Policy'] = headers['Content-Security-Policy']!.replace(
      "script-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'"
    )

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
      // relays /pg itself, so it says so.
      const content =
        url.pathname === '/config.json' ? JSON.stringify(site) : new Uint8Array(readFileSync(file))
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
