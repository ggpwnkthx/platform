import type { connect } from 'node:net'

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
 * taking PostgreSQL's connections: a session has no connection at all until it has sent a
 * whole startup packet, anything else it might open with is refused, and one that does not
 * finish its login is closed. The cap on a role keeps one person
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
 * holds only the first packet, until it is whole, and delays nothing after it.
 *
 * Of the client's stream it reads one thing too: that the first packet is a startup packet
 * of protocol 3. A request for TLS inside the stream, for GSSAPI or to cancel another
 * session's statement is not a login, and PostgreSQL answers the first two with a single
 * byte that is no message at all, which would leave the relay reading the role from the
 * wrong place. None of them is carried.
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
   * A WebSocket handshake is not a request a CORS policy decides: a browser sends it from
   * any page, so a platform's CORS settings do not stand in for this list.
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

export type Session = {
  socket: ReturnType<typeof connect> | null
  /** Whether the session has had a connection to PostgreSQL, open or not. */
  opened: boolean
  /** How many bytes the client has sent before PostgreSQL signed it in. */
  sent: number
  /** The client's first packet, held until it is whole. */
  first: Buffer
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
export type Scan = {
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
