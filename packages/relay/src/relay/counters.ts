import { keyOf } from './startup.ts'
import type { Session } from './types.ts'

/** A websocket, as far as the counts are concerned: it is closed, or it is not. */
export interface Closable {
  close: (code: number, reason: string) => void
}

/**
 * The counts the relay keeps: the sessions that are still logging in, by address and in
 * all, and the open sessions, by role.
 */
export function counters(options: { sessionsPerRole: number }) {
  /** Sessions per address that have not been signed in yet. */
  const loggingIn = new Map<string, number>()
  /** Open sessions per role. */
  const sessions = new Map<string, number>()
  /** Sessions that have not been signed in yet, from every address together. */
  let pending = 0

  /** One session less is counted against a key. */
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

  const overCap = (role: string) => (sessions.get(keyOf(role)) ?? 0) >= options.sessionsPerRole

  /** Refuses a session: the role already holds as many sessions as it may. */
  const refuse = (ws: Closable, session: Session, role: string) => {
    try {
      ws.close(1008, `Too many open sessions for role ${role}`)
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
  const signedIn = (ws: Closable, session: Session, role: string): boolean => {
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

  /** A session from this address has begun to log in. */
  const beginLogin = (address: string) => {
    loggingIn.set(address, (loggingIn.get(address) ?? 0) + 1)
    pending++
  }

  /** A session from this address is no longer logging in. */
  const endLogin = (address: string) => {
    forget(loggingIn, address)
    pending--
  }

  /** How many sessions are logging in, from every address together. */
  const pendingCount = () => pending

  return {
    loggingIn,
    sessions,
    beginLogin,
    endLogin,
    pendingCount,
    loggedIn,
    signedIn,
    forget,
  }
}
