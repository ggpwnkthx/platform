import { connect, isIP, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { relaySettingsFromEnv } from './settings.ts'
import { MAX_STARTUP, startupPacket } from './startup.ts'

export { relaySettingsFromEnv as relayOptionsFromEnv } from './settings.ts'
export type { RelaySettings } from './settings.ts'

/**
 * The WebSocket in front of PostgreSQL's port. It forwards bytes and holds no credentials:
 * the reader's token travels inside PostgreSQL's own login, and PostgreSQL alone checks it.
 *
 * It does four things of its own: it answers only the site's origin, it forwards only to the
 * one upstream it was given, it lets a session begin only with a protocol 3 startup packet
 * (so the page cannot send a cancel request or anything else to the port), and it counts the
 * sessions one address, and one role, may hold at once. How many sessions an address may
 * hold is also the business of the edge in front of the relay; PostgreSQL's own CONNECTION
 * LIMIT and authentication_timeout are the last word.
 */
export interface RelayOptions {
  upstream: { host: string; port: number; tls?: { ca?: string } }
  port: number
  /** The origins that may open a session. Empty allows any: only with RELAY_ALLOW_ANY_ORIGIN. */
  allowedOrigins: string[]
  tls?: { cert: string; key: string }
  /** How many sessions one client address may hold at once. 0 is no limit. */
  sessionsPerAddress?: number
  /** How many sessions one role may hold at once. 0 is no limit. */
  sessionsPerRole?: number
}
const REFUSED = 1008
const HELD_FOR_BROWSER = 16 * 1024 * 1024

/** How many sessions each address, and each role, holds at once. */
class Counters {
  private readonly held = new Map<string, number>()
  /** Takes one, and says yes; says no when the limit is reached. A limit of 0 is no limit. */
  take(key: string, limit: number): boolean {
    if (!limit) return true
    const count = this.held.get(key) ?? 0
    if (count >= limit) return false
    this.held.set(key, count + 1)
    return true
  }
  give(key: string | undefined) {
    if (!key) return
    const count = this.held.get(key) ?? 0
    if (count <= 1) this.held.delete(key)
    else this.held.set(key, count - 1)
  }
}

export function startRelay(options: RelayOptions) {
  const { host, port, tls } = options.upstream
  const upstream = () =>
    tls
      ? connectTls({
          host,
          port,
          ALPNProtocols: ['postgresql'],
          // A certificate is checked against a name; an address is not one to ask for.
          ...(isIP(host) ? {} : { servername: host }),
          ...tls,
        })
      : connect({ host, port })
  const sessionsPerAddress = options.sessionsPerAddress ?? 0
  const sessionsPerRole = options.sessionsPerRole ?? 0
  const byAddress = new Counters()
  const byRole = new Counters()
  const server = Bun.serve<{
    socket?: Socket
    startup?: Buffer
    role?: string
    address?: string
  }>({
    port: options.port,
    ...(options.tls ? { tls: options.tls } : {}),
    fetch(request, server) {
      if (new URL(request.url).pathname === '/health') return new Response('ok\n')
      const origin = request.headers.get('origin')
      if (options.allowedOrigins.length && !(origin && options.allowedOrigins.includes(origin)))
        return new Response('Origin not allowed\n', { status: 403 })
      // The address of the client, as the relay sees it. Behind an edge it is the edge's
      // address: the edge's own cap is the one that counts the people.
      const address = server.requestIP(request)?.address ?? ''
      if (!byAddress.take(address, sessionsPerAddress))
        return new Response('Too many sessions from this address\n', { status: 429 })
      if (!server.upgrade(request, { data: { address } })) {
        byAddress.give(address)
        return new Response('Expected a WebSocket\n', { status: 426 })
      }
      return undefined
    },
    websocket: {
      backpressureLimit: HELD_FOR_BROWSER,
      closeOnBackpressureLimit: true,
      message(ws, message) {
        const bytes = Buffer.from(message as Buffer)
        if (!ws.data.socket) {
          // A session begins with a startup packet, and it may arrive in pieces: hold what
          // has come until the packet says it is whole.
          const held = Buffer.concat([ws.data.startup ?? Buffer.alloc(0), bytes])
          const startup = startupPacket(held)
          if (!startup) {
            if (startup === false) {
              ws.close(REFUSED, 'The session did not open with a startup packet')
              return
            }
            if (held.length > MAX_STARTUP) {
              ws.close(REFUSED, 'The startup packet is longer than PostgreSQL allows')
              return
            }
            ws.data.startup = held
            return
          }
          // The role the client asks for. PostgreSQL is the judge of who it really is.
          if (!byRole.take(startup.user, sessionsPerRole)) {
            ws.close(REFUSED, 'This role holds as many sessions as it may')
            return
          }
          ws.data.role = startup.user
          const socket = upstream()
          ws.data.socket = socket
          socket.on('data', (chunk: Buffer) => {
            if (ws.sendBinary(chunk) === -1) socket.pause()
          })
          socket.on('drain', () => ws.resume())
          socket.on('error', () => ws.close())
          socket.on('close', () => ws.close())
          socket.write(held)
          return
        }
        // Browser to PostgreSQL: stop reading the WebSocket while the socket is full.
        if (!ws.data.socket.write(bytes)) ws.pause()
      },
      drain: (ws) => void ws.data.socket?.resume(),
      close: (ws) => {
        ws.data.socket?.destroy()
        byRole.give(ws.data.role)
        byAddress.give(ws.data.address)
      },
    },
  })
  return { port: server.port ?? options.port, stop: () => server.stop(true) }
}

if (import.meta.main) {
  const options = relaySettingsFromEnv()
  const relay = startRelay(options)
  console.log(
    `The relay is listening on port ${relay.port}, forwarding to ${options.upstream.host}:${options.upstream.port}${options.upstream.tls ? ' in TLS' : ''}.`
  )
  console.log(
    options.allowedOrigins.length
      ? `Origins allowed: ${options.allowedOrigins.join(', ')}`
      : 'The relay checks no origin: the edge in front of it is trusted to check it.'
  )
  console.log(
    `Sessions per address: ${options.sessionsPerAddress || 'no limit'}; per role: ${options.sessionsPerRole || 'no limit'}.`
  )
}
