import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

/**
 * The interface in development, served as the static files it is.
 *
 *   bun run dev:ui                 PostgreSQL runs inside the page; nothing else is needed.
 *   bun run dev:ui --relay=HOST:PORT
 *                                  The real interface, against a real PostgreSQL: this process
 *                                  also forwards /pg WebSockets to HOST:PORT, byte for byte,
 *                                  as the deployment's relay does. Sign-in goes through the
 *                                  issuer in ui/public/config.json.
 *
 * Every change under ui/src rebuilds the pages; reload to see it.
 */

const project = join(import.meta.dir, '..')
const relayArg = process.argv.find((a) => a.startsWith('--relay='))?.slice('--relay='.length)
const dev = !relayArg
const dist = join(project, dev ? 'ui/dist-dev' : 'ui/dist')
const port = Number(process.env.PORT ?? 5173)

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

async function build() {
  const child = Bun.spawn(
    ['bun', join(project, 'scripts/build-ui.tsx'), ...(dev ? ['--dev'] : [])],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    }
  )
  return (await child.exited) === 0
}

function fileFor(path: string): string | null {
  const clean = decodeURIComponent(path).replace(/^\/+|\/+$/g, '')
  if (clean.split('/').includes('..')) return null
  const candidate = clean.includes('.') ? join(dist, clean) : join(dist, clean, 'index.html')
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}

// The same policy the deployment's web server sends; WebAssembly is allowed only here, in
// development, where PostgreSQL itself runs in the page.
const policy = [
  "default-src 'self'",
  `script-src 'self'${dev ? " 'wasm-unsafe-eval'" : ''}`,
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self'${dev ? '' : ` ws://localhost:${port} ${JSON.parse(readFileSync(join(project, 'ui/public/config.json'), 'utf8')).issuer.replace(/^(https?:\/\/[^/]+).*/, '$1')}`}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

if (!(await build())) process.exit(1)

const [relayHost, relayPort] = relayArg ? relayArg.split(':') : []
type Pipe = { socket: ReturnType<typeof connect> | null }

Bun.serve<Pipe>({
  port,
  fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === '/pg' && relayArg) {
      if (server.upgrade(request, { data: { socket: null } })) return undefined
      return new Response('Expected a WebSocket', { status: 426 })
    }
    const file = fileFor(url.pathname)
    if (!file) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(readFileSync(file)), {
      headers: {
        'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
        'content-security-policy': policy,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
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
  `The interface${dev ? ', with PostgreSQL in the page,' : `, relaying /pg to ${relayArg},`} on http://localhost:${port}/`
)

let timer: ReturnType<typeof setTimeout> | null = null
watch(join(project, 'ui'), { recursive: true }, (_, name) => {
  if (!name || name.startsWith('dist')) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void build(), 150)
})
