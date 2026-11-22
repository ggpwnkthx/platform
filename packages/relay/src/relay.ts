import { connect, isIP } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { addressList, clientAddress } from './relay/addresses.ts'
import { counters } from './relay/counters.ts'
import { originAllowed } from './relay/origins.ts'
import { readRole as readRoleOf } from './relay/scan.ts'
import { relayOptionsFromEnv } from './relay/env.ts'
import { BEFORE_LOGIN, HELD_FOR_BROWSER, REFUSED, startupPacketIn } from './relay/startup.ts'
import type { Relay, RelayOptions, Session } from './relay/types.ts'

export { originAllowed } from './relay/origins.ts'
export { addressList, clientAddress } from './relay/addresses.ts'
export { startupPacketIn } from './relay/startup.ts'
export type { Relay, RelayOptions } from './relay/types.ts'
export { relayOptionsFromEnv } from './relay/env.ts'

export function startRelay(options: RelayOptions): Relay {
  const pendingCap = options.sessionsLoggingIn ?? 64
  const loginTimeoutMs = options.loginTimeoutMs ?? 30000
  const trusted = addressList(options.trustedProxies ?? [])
  const counts = counters(options)
  /** Opens the session's connection to PostgreSQL, in TLS if the deployment asks for it. */
  const upstream = () => {
    const { host, port, tls } = options.upstream
    if (!tls) return connect({ host, port })
    return connectTls({
      host,
      port,
      // PostgreSQL takes TLS from the first byte only from a client that names its protocol.
      ALPNProtocols: ['postgresql'],
      ...(isIP(host) ? {} : { servername: host }),
      ...(tls.ca ? { ca: tls.ca } : {}),
    })
  }

  const server = Bun.serve<Session>({
    port: options.port,
    ...(options.tls ? { tls: options.tls } : {}),
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === '/health') return new Response('ok\n')
      if (!originAllowed(request, options.allowedOrigins))
        return new Response('Origin not allowed\n', { status: 403 })
      const address = clientAddress(
        server.requestIP(request)?.address ?? 'unknown',
        request.headers.get('x-forwarded-for'),
        trusted
      )
      const count = counts.loggingIn.get(address) ?? 0
      if (count >= options.sessionsPerAddress)
        return new Response('Too many sessions from this address\n', { status: 429 })
      if (counts.pendingCount() >= pendingCap)
        return new Response('Too many sessions are logging in\n', { status: 503 })
      counts.beginLogin(address)
      const session: Session = {
        socket: null,
        opened: false,
        sent: 0,
        first: Buffer.alloc(0),
        deadline: null,
        address,
        role: null,
        loggingIn: true,
        counted: false,
        scan: { head: Buffer.alloc(0), body: Buffer.alloc(0), want: 0, skip: 0 },
      }
      if (server.upgrade(request, { data: session })) return undefined
      counts.endLogin(address)
      return new Response('Expected a WebSocket\n', { status: 426 })
    },
    websocket: {
      // A browser that falls this far behind is not reading at all: its session ends
      // rather than have what it was sent go missing from the middle of the stream.
      backpressureLimit: HELD_FOR_BROWSER,
      closeOnBackpressureLimit: true,
      open(ws) {
        const session = ws.data as Session
        // PostgreSQL waits for the client to speak first, so a session that has not sent a
        // startup packet needs no connection there, and gets none. It has this long to sign in.
        session.deadline = setTimeout(() => {
          session.deadline = null
          if (session.loggingIn) ws.close(REFUSED, 'The session did not log in in time')
        }, loginTimeoutMs)
      },
      message(ws, message) {
        const session = ws.data as Session
        const bytes = typeof message === 'string' ? Buffer.from(message) : Buffer.from(message)
        if (session.loggingIn) {
          session.sent += bytes.length
          if (session.sent > BEFORE_LOGIN) {
            ws.close(REFUSED, 'Too much was sent before the session logged in')
            return
          }
        }
        let carried: Buffer = bytes
        if (!session.opened) {
          // The first packet is held until it is whole, and is a login or is not carried.
          session.first = Buffer.concat([session.first, bytes])
          const packet = startupPacketIn(session.first)
          if (packet === 'refused') {
            ws.close(REFUSED, 'The session did not open with a startup packet')
            return
          }
          if (packet === 'partial') return
          carried = session.first
          session.first = Buffer.alloc(0)
          session.opened = true
          const socket = upstream()
          session.socket = socket
          socket.on('data', (chunk) => {
            const bytes = chunk as Buffer
            // The role is read before the bytes are carried: a session that is refused must
            // not look to the client like a session that has signed in.
            if (readRoleOf(session, bytes, (role) => counts.signedIn(ws, session, role))) return
            try {
              // The browser is behind: PostgreSQL is not read until it has caught up.
              if (ws.sendBinary(bytes) === -1) socket.pause()
            } catch {
              // The browser is gone; the close handler tidies up.
            }
          })
          // PostgreSQL has caught up: the browser is read again.
          socket.on('drain', () => ws.resume())
          socket.on('error', () => ws.close())
          socket.on('close', () => ws.close())
        }
        // PostgreSQL is behind: the browser is not read until it has caught up.
        if (session.socket && !session.socket.write(carried)) ws.pause()
      },
      drain(ws) {
        ;(ws.data as Session).socket?.resume()
      },
      close(ws) {
        const session = ws.data as Session
        session.socket?.end()
        session.socket?.destroy()
        session.socket = null
        if (session.counted && session.role) counts.forget(counts.sessions, session.role)
        counts.loggedIn(session)
        session.counted = false
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

/** Whether a host is this machine: the one place a token crosses no network on its way. */

if (import.meta.main) {
  const options = relayOptionsFromEnv()
  const relay = startRelay(options)
  console.log(
    `The relay is listening on port ${relay.port}, forwarding to ${options.upstream.host}:${options.upstream.port}${options.upstream.tls ? ' in TLS' : ''}.`
  )
  console.log(
    options.allowedOrigins.length
      ? `Origins allowed: ${options.allowedOrigins.join(', ')}`
      : 'The relay checks no origin: set RELAY_ORIGINS to the address of the site, unless what is in front of the relay refuses other origins on the WebSocket handshake itself.'
  )
  console.log(
    `Sessions: ${options.sessionsPerAddress} logging in at once per address and ${options.sessionsLoggingIn} in all, ${options.loginTimeoutMs / 1000} seconds to log in, ${options.sessionsPerRole} open at once per role.`
  )
  if (options.trustedProxies.length)
    console.log(`Proxies whose X-Forwarded-For is believed: ${options.trustedProxies.join(', ')}`)
}
