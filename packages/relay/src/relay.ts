import { readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'

/**
 * The WebSocket in front of PostgreSQL's port. It forwards bytes and holds no credentials:
 * the reader's token travels inside PostgreSQL's own login, and PostgreSQL alone checks it.
 *
 * It does three things of its own: it answers only the site's origin, it forwards only to
 * the one upstream it was given, and it lets a session begin only with a protocol 3 startup
 * packet (so the page cannot send a cancel request or anything else to the port). How many
 * sessions an address or a role may hold is the business of what already does it well: the
 * edge in front of the relay, and PostgreSQL's own CONNECTION LIMIT and authentication_timeout.
 */
export interface RelayOptions {
  upstream: { host: string; port: number; tls?: { ca?: string } }
  port: number
  /** Empty allows any origin: for a relay behind an edge that checks the origin itself. */
  allowedOrigins: string[]
  tls?: { cert: string; key: string }
}
const REFUSED = 1008
const HELD_FOR_BROWSER = 16 * 1024 * 1024
const isStartup = (bytes: Buffer) =>
  bytes.length >= 8 && bytes.readInt32BE(0) <= 10000 && bytes.readInt32BE(4) >>> 16 === 3

export function startRelay(options: RelayOptions) {
  const { host, port, tls } = options.upstream
  const upstream = () =>
    tls
      ? connectTls({ host, port, ALPNProtocols: ['postgresql'], servername: host, ...tls })
      : connect({ host, port })
  const server = Bun.serve<{ socket?: Socket }>({
    port: options.port,
    ...(options.tls ? { tls: options.tls } : {}),
    fetch(request, server) {
      if (new URL(request.url).pathname === '/health') return new Response('ok\n')
      const origin = request.headers.get('origin')
      if (options.allowedOrigins.length && !(origin && options.allowedOrigins.includes(origin)))
        return new Response('Origin not allowed\n', { status: 403 })
      if (server.upgrade(request, { data: {} })) return undefined
      return new Response('Expected a WebSocket\n', { status: 426 })
    },
    websocket: {
      backpressureLimit: HELD_FOR_BROWSER,
      closeOnBackpressureLimit: true,
      message(ws, message) {
        const bytes = Buffer.from(message as Buffer)
        if (!ws.data.socket) {
          if (!isStartup(bytes))
            return ws.close(REFUSED, 'The session did not open with a startup packet')
          const socket = upstream()
          ws.data.socket = socket
          socket.on('data', (chunk: Buffer) => {
            if (ws.sendBinary(chunk) === -1) socket.pause()
          })
          socket.on('error', () => ws.close())
          socket.on('close', () => ws.close())
        }
        ws.data.socket.write(bytes)
      },
      drain: (ws) => void ws.data.socket?.resume(),
      close: (ws) => void ws.data.socket?.destroy(),
    },
  })
  return { port: server.port ?? options.port, stop: () => server.stop(true) }
}

const isLoopback = (host: string) => /^(localhost|::1|\[::1\]|127(\.\d{1,3}){3})$/.test(host)
export function relayOptionsFromEnv(
  env: Record<string, string | undefined> = process.env
): RelayOptions {
  const [host, port] = (env.RELAY_UPSTREAM ?? '127.0.0.1:5432').split(':')
  if (!host || !port) throw new Error('RELAY_UPSTREAM must be host:port')
  const origins = (env.RELAY_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin && origin !== '*')
  const upstreamTls = (env.RELAY_UPSTREAM_TLS ?? '').trim().toLowerCase()
  if (!['', 'off', 'verify'].includes(upstreamTls))
    throw new Error('RELAY_UPSTREAM_TLS must be verify or off')
  // A token must not cross a network in the clear by accident: off is said, never assumed.
  if (!upstreamTls && !isLoopback(host))
    throw new Error(
      `RELAY_UPSTREAM_TLS must be set to reach ${host}: verify, or off where the network between the relay and PostgreSQL is one you trust with a token`
    )
  if (env.RELAY_UPSTREAM_CA && upstreamTls !== 'verify')
    throw new Error('RELAY_UPSTREAM_CA needs RELAY_UPSTREAM_TLS=verify')
  if (Boolean(env.RELAY_TLS_CERT) !== Boolean(env.RELAY_TLS_KEY))
    throw new Error('RELAY_TLS_CERT and RELAY_TLS_KEY are both needed, or neither')
  const file = (path: string) => readFileSync(path, 'utf8')
  return {
    upstream: {
      host,
      port: Number(port),
      ...(upstreamTls === 'verify'
        ? { tls: env.RELAY_UPSTREAM_CA ? { ca: file(env.RELAY_UPSTREAM_CA) } : {} }
        : {}),
    },
    port: Number(env.RELAY_PORT ?? '8081'),
    allowedOrigins: origins,
    ...(env.RELAY_TLS_CERT && env.RELAY_TLS_KEY
      ? { tls: { cert: file(env.RELAY_TLS_CERT), key: file(env.RELAY_TLS_KEY) } }
      : {}),
  }
}

if (import.meta.main) {
  const options = relayOptionsFromEnv()
  const relay = startRelay(options)
  console.log(
    `The relay is listening on port ${relay.port}, forwarding to ${options.upstream.host}:${options.upstream.port}${options.upstream.tls ? ' in TLS' : ''}.`
  )
  console.log(
    options.allowedOrigins.length
      ? `Origins allowed: ${options.allowedOrigins.join(', ')}`
      : 'The relay checks no origin: set RELAY_ORIGINS to the address of the site, unless what is in front of the relay refuses other origins itself.'
  )
}
