import { readFileSync } from 'node:fs'
import { BlockList, connect, isIP } from 'node:net'
import { connect as connectTls } from 'node:tls'

/**
 * The relay: a WebSocket in front of PostgreSQL's port, forwarding bytes in both directions.
 *
 * It holds no credentials. The reader's token travels inside the authentication exchange,
 * and PostgreSQL alone checks it. The relay's whole job is to keep the bytes intact between
 * a browser and the database's port.
 *
 * It does enforce these things about the sessions it accepts:
 *
 *   - the Origin of the handshake must be one the deployment allows, so that no other site
 *     can open a session through a reader's browser;
 *   - one address may hold only so many sessions that are still logging in at a time, and
 *     so may all addresses together;
 *   - a session has only so long to log in, and may send only so much before it has;
 *   - one role may hold only so many open sessions at a time.
 *
 * The caps answer different questions. Those on logins keep clients that never sign in from
 * taking PostgreSQL's connections: a session that has said nothing has no connection at
 * all, and one that does not finish its login is closed. The cap on a role keeps one person
 * from taking the database's connections for themselves, which is the cap that matters once
 * the interface keeps its session open instead of opening one per action.
 *
 * A side that reads slowly slows the other down rather than filling the relay's memory:
 * when the browser is behind, the relay stops reading PostgreSQL, and when PostgreSQL is
 * behind, it stops reading the browser.
 *
 * To count by role the relay reads one thing and no more: the `session_authorization`
 * PostgreSQL reports once it has signed the session in. That is the truth: a client cannot
 * claim a role it has not been signed in as, so a session counts against a role only once
 * PostgreSQL has accepted it. The bytes themselves are carried as they are; the relay
 * neither holds them nor delays them.
 */
export type RelayOptions = {
  /**
   * Where PostgreSQL listens. With `tls` the relay opens that connection in TLS from its
   * first byte, as PostgreSQL 17 and later accept it (`sslnegotiation=direct`), and checks
   * the server's certificate against `ca`, or against the system's authorities without one.
   */
  upstream: { host: string; port: number; tls?: { ca?: string } }
  /** The port the relay listens on. */
  port: number
  /**
   * The origins allowed to open a session, such as `https://platform.example.com`. Empty
   * allows any origin, which is only right when something else already refuses them.
   */
  allowedOrigins: string[]
  /** How many sessions one address may hold at once while they are still logging in. */
  sessionsPerAddress: number
  /** How many open sessions one role may hold at once. */
  sessionsPerRole: number
  /** How many sessions may be logging in at once, from every address together. Default 64. */
  sessionsLoggingIn?: number
  /** How long a session has to log in, in milliseconds. Default 30 seconds. */
  loginTimeoutMs?: number
  /**
   * The proxies in front of the relay, as addresses or CIDR blocks. A handshake that comes
   * from one of them is counted against the client the proxy names in X-Forwarded-For, and
   * not against the proxy. Empty trusts no such header.
   */
  trustedProxies?: string[]
  /** The certificate and key the relay serves TLS with, if it serves TLS at all. */
  tls?: { cert: string; key: string }
}

export type Relay = {
  port: number
  stop: () => void
}

type Session = {
  socket: ReturnType<typeof connect> | null
  /** Whether the session has had a connection to PostgreSQL, open or not. */
  opened: boolean
  /** How many bytes the client has sent before PostgreSQL signed it in. */
  sent: number
  /** What closes the session if it does not log in in time. */
  deadline: ReturnType<typeof setTimeout> | null
  address: string
  /** The role PostgreSQL has signed the session in as. */
  role: string | null
  /** Whether the session counts against an address that is still logging in. */
  loggingIn: boolean
  /** Whether the session counts against a role. */
  counted: boolean
  /** What the relay reads of the server's stream. */
  scan: Scan
}

/**
 * What the relay reads of the server's stream: the settings PostgreSQL reports. The header
 * of a message is five bytes and the body of a setting is short, so the rows and the
 * results are stepped over rather than copied.
 */
type Scan = {
  /** The header of the message being read: its type and its length. */
  head: Buffer
  /** The body of a setting message, while it is being read. */
  body: Buffer
  /** How many bytes of that body are still wanted. */
  want: number
  /** How many bytes are still to be stepped over. */
  skip: number
}

/** The Origin of a request, as the browser sent it, without a trailing slash. */
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

/** An address as it is compared: an IPv4 address carried in IPv6 is the IPv4 address. */
const plainAddress = (address: string) => address.trim().replace(/^::ffff:(?=\d+\.)/i, '')

/** The addresses a list of addresses and CIDR blocks names. */
export function addressList(blocks: string[]): BlockList {
  const list = new BlockList()
  for (const block of blocks) {
    const [address = '', prefix, ...rest] = block.split('/')
    const family = isIP(address)
    const bits = prefix === undefined ? null : Number(prefix)
    if (
      !family ||
      rest.length ||
      (bits !== null && (!/^\d+$/.test(prefix ?? '') || bits > (family === 4 ? 32 : 128)))
    )
      throw new Error(`Not an address or a CIDR block: ${block}`)
    const type = family === 4 ? 'ipv4' : 'ipv6'
    if (bits === null) list.addAddress(address, type)
    else list.addSubnet(address, bits, type)
  }
  return list
}

/**
 * The address a session is counted against. It is the peer's, unless the peer is a proxy the
 * deployment trusts: then it is the nearest address in X-Forwarded-For that is not such a
 * proxy itself. Anything further left in that header is the client's own word, and a client
 * that could choose its address would have a budget for every address it can think of.
 */
export function clientAddress(peer: string, forwarded: string | null, trusted: BlockList): string {
  const isTrusted = (address: string) => {
    const family = isIP(address)
    return family !== 0 && trusted.check(address, family === 4 ? 'ipv4' : 'ipv6')
  }
  let address = plainAddress(peer)
  const hops = (forwarded ?? '').split(',').map(plainAddress).filter(Boolean)
  while (isTrusted(address)) {
    const hop = hops.pop()
    if (!hop || !isIP(hop)) break
    address = hop
  }
  return address
}

/** The type letter of the message PostgreSQL reports a setting with. */
const PARAMETER_STATUS = 0x53

/** The close code for a session the relay refuses: the policy does not allow it. */
const REFUSED = 1008

/**
 * How much a session may send before PostgreSQL has signed it in: a startup packet and a
 * token, with room to spare, and nothing like a statement.
 */
const BEFORE_LOGIN = 64 * 1024

/** How much the relay holds for a browser that is behind before a session is beyond help. */
const HELD_FOR_BROWSER = 16 * 1024 * 1024

/** Reads a NUL-terminated string at a place in a buffer. */
function cstring(buffer: Buffer, at: number): { value: string; next: number } | null {
  const end = buffer.indexOf(0, at)
  if (end < 0) return null
  return { value: buffer.toString('utf8', at, end), next: end + 1 }
}

/**
 * The role a setting message reports, when it is the one that names the session's role.
 */
function roleInSetting(body: Buffer): string | null {
  const key = cstring(body, 0)
  if (key?.value !== 'session_authorization') return null
  const value = cstring(body, key.next)
  return value?.value ?? null
}

/**
 * The key a role is counted under. PostgreSQL's role names are as they are written, but a
 * cap is about a person, and a person does not get a second budget by spelling their name
 * differently.
 */
function keyOf(role: string): string {
  return role.toLowerCase()
}

/**
 * Starts the relay. Returns the port it listens on, so that a caller which asked for port 0
 * (any free port) can find it.
 */
export function startRelay(options: RelayOptions): Relay {
  /** Sessions per address that have not been signed in yet. */
  const loggingIn = new Map<string, number>()
  /** Open sessions per role. */
  const sessions = new Map<string, number>()
  /** Sessions that have not been signed in yet, from every address together. */
  let pending = 0
  const pendingCap = options.sessionsLoggingIn ?? 64
  const loginTimeoutMs = options.loginTimeoutMs ?? 30000
  const trusted = addressList(options.trustedProxies ?? [])

  const forget = (map: Map<string, number>, key: string) => {
    const count = (map.get(key) ?? 1) - 1
    if (count <= 0) map.delete(key)
    else map.set(key, count)
  }

  /** The session is no longer logging in: it has signed in, or it is gone. */
  const loggedIn = (session: Session) => {
    if (session.deadline) clearTimeout(session.deadline)
    session.deadline = null
    if (!session.loggingIn) return
    forget(loggingIn, session.address)
    pending--
    session.loggingIn = false
  }

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

  const overCap = (role: string) => (sessions.get(keyOf(role)) ?? 0) >= options.sessionsPerRole

  /** Refuses a session: the role already holds as many sessions as it may. */
  const refuse = (
    ws: { close: (code: number, reason: string) => void },
    session: Session,
    role: string
  ) => {
    try {
      ws.close(REFUSED, `Too many open sessions for role ${role}`)
    } catch {
      // The browser is gone.
    }
    session.socket?.destroy()
    session.socket = null
  }

  /**
   * The session is signed in: it counts against the role PostgreSQL named, and no longer
   * against its address. It answers whether the session was refused.
   */
  const signedIn = (
    ws: { close: (code: number, reason: string) => void },
    session: Session,
    role: string
  ): boolean => {
    const key = keyOf(role)
    if (session.role === key) return false
    loggedIn(session)
    if (session.counted && session.role) forget(sessions, session.role)
    session.counted = false
    session.role = null
    if (overCap(role)) {
      // The role holds as many sessions as it may: this one is refused.
      refuse(ws, session, role)
      return true
    }
    sessions.set(key, (sessions.get(key) ?? 0) + 1)
    session.role = key
    session.counted = true
    return false
  }

  /**
   * Reads what PostgreSQL says about the session: the role it has signed the session in as.
   * Only the settings are read; the rows and the results are carried as they are. It
   * answers whether the session was refused, in which case the bytes are not carried.
   */
  const readRole = (
    ws: { close: (code: number, reason: string) => void },
    session: Session,
    chunk: Buffer
  ): boolean => {
    let refused = false
    let at = 0
    while (at < chunk.length) {
      const scan = session.scan
      if (scan.skip > 0) {
        const take = Math.min(scan.skip, chunk.length - at)
        scan.skip -= take
        at += take
        continue
      }
      if (scan.want > 0) {
        const take = Math.min(scan.want, chunk.length - at)
        scan.body = Buffer.concat([scan.body, chunk.subarray(at, at + take)])
        scan.want -= take
        at += take
        if (scan.want === 0) {
          const role = roleInSetting(scan.body)
          scan.body = Buffer.alloc(0)
          if (role && signedIn(ws, session, role)) refused = true
        }
        continue
      }
      const take = Math.min(5 - scan.head.length, chunk.length - at)
      scan.head = Buffer.concat([scan.head, chunk.subarray(at, at + take)])
      at += take
      if (scan.head.length < 5) continue
      const type = scan.head[0]
      const body = scan.head.readInt32BE(1) - 4
      scan.head = Buffer.alloc(0)
      if (type === PARAMETER_STATUS && body > 0 && body <= 1024) {
        scan.want = body
        scan.body = Buffer.alloc(0)
      } else {
        scan.skip = Math.max(0, body)
      }
    }
    return refused
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
      const count = loggingIn.get(address) ?? 0
      if (count >= options.sessionsPerAddress)
        return new Response('Too many sessions from this address\n', { status: 429 })
      if (pending >= pendingCap)
        return new Response('Too many sessions are logging in\n', { status: 503 })
      loggingIn.set(address, count + 1)
      pending++
      const session: Session = {
        socket: null,
        opened: false,
        sent: 0,
        deadline: null,
        address,
        role: null,
        loggingIn: true,
        counted: false,
        scan: { head: Buffer.alloc(0), body: Buffer.alloc(0), want: 0, skip: 0 },
      }
      if (server.upgrade(request, { data: session })) return undefined
      forget(loggingIn, address)
      pending--
      return new Response('Expected a WebSocket\n', { status: 426 })
    },
    websocket: {
      // A browser that falls this far behind is not reading at all: its session ends
      // rather than have what it was sent go missing from the middle of the stream.
      backpressureLimit: HELD_FOR_BROWSER,
      closeOnBackpressureLimit: true,
      open(ws) {
        const session = ws.data as Session
        // PostgreSQL waits for the client to speak first, so a session that says nothing
        // needs no connection there, and gets none. It has this long to sign in.
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
        if (!session.opened) {
          session.opened = true
          const socket = upstream()
          session.socket = socket
          socket.on('data', (chunk) => {
            const bytes = chunk as Buffer
            // The role is read before the bytes are carried: a session that is refused must
            // not look to the client like a session that has signed in.
            if (readRole(ws, session, bytes)) return
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
        if (session.socket && !session.socket.write(bytes)) ws.pause()
      },
      drain(ws) {
        ;(ws.data as Session).socket?.resume()
      },
      close(ws) {
        const session = ws.data as Session
        session.socket?.end()
        session.socket?.destroy()
        session.socket = null
        if (session.counted && session.role) forget(sessions, session.role)
        loggedIn(session)
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
  const perRole = Number(env.RELAY_SESSIONS_PER_ROLE ?? '20')
  if (!Number.isInteger(perRole) || perRole < 1)
    throw new Error('RELAY_SESSIONS_PER_ROLE must be a number')
  const pending = Number(env.RELAY_SESSIONS_LOGGING_IN ?? '64')
  if (!Number.isInteger(pending) || pending < 1)
    throw new Error('RELAY_SESSIONS_LOGGING_IN must be a number')
  const loginSeconds = Number(env.RELAY_LOGIN_SECONDS ?? '30')
  if (!Number.isFinite(loginSeconds) || loginSeconds <= 0)
    throw new Error('RELAY_LOGIN_SECONDS must be a number of seconds')
  const proxies = (env.RELAY_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((block) => block.trim())
    .filter(Boolean)
  // Read here, so that a block that is not one stops the relay before it listens.
  addressList(proxies)
  const upstreamTls = (env.RELAY_UPSTREAM_TLS ?? '').trim().toLowerCase()
  if (!['', 'off', 'verify'].includes(upstreamTls))
    throw new Error('RELAY_UPSTREAM_TLS must be verify or off')
  const upstreamCa = env.RELAY_UPSTREAM_CA
  if (upstreamCa && upstreamTls !== 'verify')
    throw new Error('RELAY_UPSTREAM_CA needs RELAY_UPSTREAM_TLS=verify')
  const tlsCert = env.RELAY_TLS_CERT
  const tlsKey = env.RELAY_TLS_KEY
  if (Boolean(tlsCert) !== Boolean(tlsKey))
    throw new Error('RELAY_TLS_CERT and RELAY_TLS_KEY are both needed, or neither')
  return {
    upstream: {
      host,
      port: Number(port),
      ...(upstreamTls === 'verify'
        ? { tls: upstreamCa ? { ca: readFileSync(upstreamCa, 'utf8') } : {} }
        : {}),
    },
    port: Number(env.RELAY_PORT ?? '8081'),
    allowedOrigins: origins,
    sessionsPerAddress: sessions,
    sessionsPerRole: perRole,
    sessionsLoggingIn: pending,
    loginTimeoutMs: loginSeconds * 1000,
    trustedProxies: proxies,
    ...(tlsCert && tlsKey
      ? { tls: { cert: readFileSync(tlsCert, 'utf8'), key: readFileSync(tlsKey, 'utf8') } }
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
      : 'No origin is restricted: set RELAY_ORIGINS to the address of the site.'
  )
  console.log(
    `Sessions: ${options.sessionsPerAddress} logging in at once per address and ${options.sessionsLoggingIn} in all, ${options.loginTimeoutMs / 1000} seconds to log in, ${options.sessionsPerRole} open at once per role.`
  )
  if (options.trustedProxies.length)
    console.log(`Proxies whose X-Forwarded-For is believed: ${options.trustedProxies.join(', ')}`)
}
