import { readFileSync } from 'node:fs'
import { connect } from 'node:net'

/**
 * The relay: a WebSocket in front of PostgreSQL's port, forwarding bytes in both directions.
 *
 * It holds no credentials and reads nothing it carries. The reader's token travels inside the
 * PostgreSQL startup packet, and PostgreSQL alone checks it. The relay's whole job is to keep
 * the bytes intact between a browser and the database's port.
 *
 * It does enforce three things about the sessions it accepts:
 *
 *   - the Origin of the handshake must be one the deployment allows, so that no other site
 *     can open a session through a reader's browser;
 *   - one address may hold only so many sessions at a time;
 *   - the connection to PostgreSQL is opened when the WebSocket opens and closed with it.
 */
export type RelayOptions = {
  /** Where PostgreSQL listens. */
  upstream: { host: string; port: number }
  /** The port the relay listens on. */
  port: number
  /**
   * The origins allowed to open a session, such as `https://platform.example.com`. Empty
   * allows any origin, which is only right when something else already refuses them.
   */
  allowedOrigins: string[]
  /** How many sessions one address may hold at a time. */
  sessionsPerAddress: number
  /** The certificate and key the relay serves TLS with, if it serves TLS at all. */
  tls?: { cert: string; key: string }
}

export type Relay = {
  port: number
  stop: () => void
}

type Session = { socket: ReturnType<typeof connect> | null; address: string }

/** The origin of a request, as the browser sent it, without a trailing slash. */
function originOf(request: Request): string | null {
  const header = request.headers.get('origin')
  if (!header) return null
  try {
    const url = new URL(header)
    return url.origin
  } catch {
    return null
  }
}

/**
 * Whether the handshake comes from an allowed origin. A request with no Origin header is
 * refused when there is a list: only a browser sends one, and it is the page's own origin
 * that a cross-site page cannot forge.
 */
export function originAllowed(request: Request, allowed: string[]): boolean {
  if (!allowed.length) return true
  const origin = originOf(request)
  return origin !== null && allowed.includes(origin)
}

/**
 * Starts the relay. Returns the port it listens on, so that a caller which asked for port 0
 * (any free port) can find it.
 */
export function startRelay(options: RelayOptions): Relay {
  const held = new Map<string, number>()
  const server = Bun.serve<Session>({
    port: options.port,
    ...(options.tls ? { tls: options.tls } : {}),
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === '/health') return new Response('ok\n')
      if (!originAllowed(request, options.allowedOrigins))
        return new Response('Origin not allowed\n', { status: 403 })
      const address = server.requestIP(request)?.address ?? 'unknown'
      const count = held.get(address) ?? 0
      if (count >= options.sessionsPerAddress)
        return new Response('Too many sessions from this address\n', { status: 429 })
      held.set(address, count + 1)
      if (server.upgrade(request, { data: { socket: null, address } })) return undefined
      held.set(address, count)
      return new Response('Expected a WebSocket\n', { status: 426 })
    },
    websocket: {
      open(ws) {
        const session = ws.data as Session
        const socket = connect({
          host: options.upstream.host,
          port: options.upstream.port,
        })
        session.socket = socket
        socket.on('data', (chunk) => {
          try {
            ws.sendBinary(chunk as Buffer)
          } catch {
            // The browser is gone; the close handler tidies up.
          }
        })
        socket.on('error', () => ws.close())
        socket.on('close', () => ws.close())
      },
      message(ws, message) {
        const session = ws.data as Session
        const bytes = typeof message === 'string' ? Buffer.from(message) : Buffer.from(message)
        session.socket?.write(bytes)
      },
      close(ws) {
        const session = ws.data as Session
        session.socket?.end()
        session.socket?.destroy()
        session.socket = null
        const address = session.address
        const count = held.get(address) ?? 1
        if (count <= 1) held.delete(address)
        else held.set(address, count - 1)
      },
    },
  })
  return {
    port: server.port ?? options.port,
    stop: () => {
      server.stop(true)
    },
  }
}

/** The relay's options, read from the environment a deployment sets. */
export function relayOptionsFromEnv(env: Record<string, string | undefined> = process.env) {
  const upstream = env.RELAY_UPSTREAM ?? '127.0.0.1:5432'
  const [host, port] = upstream.split(':')
  if (!host || !port) throw new Error(`RELAY_UPSTREAM must be host:port, not ${upstream}`)
  const origins = (env.RELAY_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  const sessions = Number(env.RELAY_SESSIONS_PER_ADDRESS ?? '20')
  if (!Number.isInteger(sessions) || sessions < 1)
    throw new Error('RELAY_SESSIONS_PER_ADDRESS must be a number')
  const tlsCert = env.RELAY_TLS_CERT
  const tlsKey = env.RELAY_TLS_KEY
  if (Boolean(tlsCert) !== Boolean(tlsKey))
    throw new Error('RELAY_TLS_CERT and RELAY_TLS_KEY are both needed, or neither')
  return {
    upstream: { host, port: Number(port) },
    port: Number(env.RELAY_PORT ?? '8081'),
    allowedOrigins: origins,
    sessionsPerAddress: sessions,
    ...(tlsCert && tlsKey
      ? { tls: { cert: readFileSync(tlsCert, 'utf8'), key: readFileSync(tlsKey, 'utf8') } }
      : {}),
  }
}

if (import.meta.main) {
  const options = relayOptionsFromEnv()
  const relay = startRelay(options)
  console.log(
    `The relay is listening on port ${relay.port}, forwarding to ${options.upstream.host}:${options.upstream.port}.`
  )
  console.log(
    options.allowedOrigins.length
      ? `Origins allowed: ${options.allowedOrigins.join(', ')}`
      : 'No origin is restricted: set RELAY_ORIGINS to the address of the site.'
  )
}
