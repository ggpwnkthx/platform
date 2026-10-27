/**
 * The sessions of the console.
 *
 * A session is a record of the server. The browser holds an opaque
 * identifier of it, and the token of the caller never leaves the server
 * of the console: the console forwards it to the gateway for the calls
 * of the data, and the browser never sees it.
 *
 * The store is the memory of the process. A deployment of the console
 * runs one replica, or pins a browser to a replica: a session that lives
 * in the memory of one replica is unknown to the others.
 */

import { randomBytes } from 'node:crypto'

/** The principal of a session, as the id token of the access service names it. */
export interface SessionPrincipal {
  /** The id of the principal: the `sub` of the token. */
  readonly id: string
  /** The slug of the tenant: the `tid` of the token. */
  readonly tenant: string
  readonly email: string | null
  readonly name: string | null
  /** The keys of the permissions of the principal when the token was issued. */
  readonly roles: readonly string[]
}

/** A message for the next page the caller reads. */
export interface Flash {
  readonly kind: 'ok' | 'error'
  readonly text: string
  /** The detail of a refusal: the code and the request of the service. */
  readonly detail?: string
}

/** A session of the console. */
export interface Session {
  readonly id: string
  readonly createdAt: number
  touchedAt: number
  readonly principal: SessionPrincipal
  /** The access token of the caller: the gateway accepts it as a bearer token. */
  accessToken: string
  accessTokenExpiresAt: number
  /** The workspaces the caller opened, the latest first. */
  workspaces: string[]
  flash: Flash | null
}

/** The bounds of the sessions. */
export interface SessionBounds {
  /** How long a session survives without being used. */
  readonly ttlMs: number
  /** How long a session may be used at all. */
  readonly maxAgeMs: number
}

/** The clock of the store: the tests move it. */
export type Clock = () => number

/** Creates an opaque identifier of 32 random bytes. */
export function newIdentifier(): string {
  return randomBytes(32).toString('base64url')
}

/** The store of the sessions. */
export class SessionStore {
  readonly #sessions = new Map<string, Session>()
  readonly #bounds: SessionBounds
  readonly #clock: Clock

  constructor(bounds: SessionBounds, clock: Clock = Date.now) {
    this.#bounds = bounds
    this.#clock = clock
  }

  /** Creates a session for a principal. */
  create(options: {
    principal: SessionPrincipal
    accessToken: string
    accessTokenExpiresAt: number
  }): Session {
    this.#sweep()
    const now = this.#clock()
    const session: Session = {
      id: newIdentifier(),
      createdAt: now,
      touchedAt: now,
      principal: options.principal,
      accessToken: options.accessToken,
      accessTokenExpiresAt: options.accessTokenExpiresAt,
      workspaces: [],
      flash: null,
    }
    this.#sessions.set(session.id, session)
    return session
  }

  /** Reads a session that is alive, and refreshes it. */
  read(id: string): Session | null {
    const session = this.#sessions.get(id)
    if (!session) return null
    const now = this.#clock()
    if (!this.#alive(session, now)) {
      this.#sessions.delete(id)
      return null
    }
    session.touchedAt = now
    return session
  }

  /** The milliseconds the cookie of a session may live. */
  remainingMs(session: Session): number {
    const now = this.#clock()
    const idle = session.touchedAt + this.#bounds.ttlMs - now
    const age = session.createdAt + this.#bounds.maxAgeMs - now
    return Math.max(0, Math.min(idle, age))
  }

  /** Destroys a session. */
  destroy(id: string): void {
    this.#sessions.delete(id)
  }

  /** The number of the sessions that are alive. */
  get size(): number {
    this.#sweep()
    return this.#sessions.size
  }

  #alive(session: Session, now: number): boolean {
    return (
      now - session.touchedAt < this.#bounds.ttlMs &&
      now - session.createdAt < this.#bounds.maxAgeMs
    )
  }

  #sweep(): void {
    const now = this.#clock()
    for (const [id, session] of this.#sessions) {
      if (!this.#alive(session, now)) this.#sessions.delete(id)
    }
  }
}

/** A login in flight: what the console needs to finish it. */
export interface PendingLogin {
  readonly state: string
  readonly nonce: string
  readonly verifier: string
  /** The page the caller comes back to. */
  readonly redirect: string
  readonly createdAt: number
}

/**
 * The logins in flight.
 *
 * The state of a login is single use: it is taken from the store when the
 * browser comes back, whatever the outcome, and it lives ten minutes.
 */
export class LoginStore {
  readonly #logins = new Map<string, PendingLogin>()
  readonly #clock: Clock
  readonly #ttlMs: number

  constructor(clock: Clock = Date.now, ttlMs = 10 * 60 * 1000) {
    this.#clock = clock
    this.#ttlMs = ttlMs
  }

  /** Records a login in flight. */
  begin(options: Omit<PendingLogin, 'createdAt'>): PendingLogin {
    this.#sweep()
    const login = { ...options, createdAt: this.#clock() }
    this.#logins.set(login.state, login)
    return login
  }

  /** Takes a login in flight out of the store. */
  take(state: string): PendingLogin | null {
    const login = this.#logins.get(state)
    this.#logins.delete(state)
    if (!login) return null
    if (this.#clock() - login.createdAt >= this.#ttlMs) return null
    return login
  }

  #sweep(): void {
    const now = this.#clock()
    for (const [state, login] of this.#logins) {
      if (now - login.createdAt >= this.#ttlMs) this.#logins.delete(state)
    }
  }
}
