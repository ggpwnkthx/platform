import { createPool, type Pool } from 'generic-pool'
import { ConnectionError, type Login, PgError } from './wire.ts'

/**
 * The logins kept open: a few sessions to PostgreSQL that last as long as the client does.
 *
 * A client used to open a login for every action and close it again, so every save, every
 * read and every page load cost a fork on the server and another check of the reader's
 * token. Here the login is opened once and kept: the actions share it, and another one is
 * opened only when this one has died or the sign-in has expired.
 *
 * It is a pool of a few logins rather than one, so that two actions running at the same
 * time do not wait for each other. An action holds one of them for as long as it runs, so
 * a transaction is never interrupted by another action.
 */
export type KeptSessionOptions = {
  /** How many logins the page may hold open at once. */
  size?: number
  /** Opens a login: the client's own way in. */
  open: () => Promise<Login>
  /** When the sign-in expires, in milliseconds since the epoch; null when it does not. */
  expiresAt: () => number | null
}

export class KeptSession {
  private readonly pool: Pool<Login>
  private readonly expiryOf: () => number | null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  /** Rejects when the session ends, so that an action waiting for a login is not left waiting. */
  private readonly ended: Promise<never>
  private end: (error: Error) => void = () => undefined

  constructor(options: KeptSessionOptions) {
    this.expiryOf = options.expiresAt
    this.ended = new Promise<never>((_, reject) => {
      this.end = reject
    })
    // The end of the session is a rejection nobody may be waiting for: it is caught here,
    // and every action that is waiting for a login hears of it through the race below.
    this.ended.catch(() => undefined)
    this.pool = createPool<Login>(
      {
        create: options.open,
        destroy: async (db: Login) => {
          try {
            db.close()
          } catch {
            // It is already gone.
          }
        },
      },
      {
        max: Math.max(1, options.size ?? 2),
        min: 0,
        // A login is kept until the sign-in ends, not until it has been idle a while.
        evictionRunIntervalMillis: 0,
      }
    )
  }

  /**
   * Runs the work on a login of its own, and gives the login back afterwards. A login the
   * work has broken is thrown away rather than given back.
   */
  async run<T>(work: (db: Login) => Promise<T>): Promise<T> {
    const db = await this.acquire()
    let spoiled = false
    try {
      return await work(db)
    } catch (error) {
      spoiled = broken(error)
      throw error
    } finally {
      this.release(db, spoiled)
    }
  }

  /** A login to work on: one that is free, or a new one, or a wait for one to come back. */
  async acquire(): Promise<Login> {
    if (this.closed) throw new Error('The sign-in has ended.')
    const loan = this.pool.acquire()
    // A login that is given to a waiter after the session has ended is closed at once.
    void loan.then(
      (db) => {
        if (this.closed) void this.pool.destroy(db)
      },
      () => undefined
    )
    const db = await Promise.race([loan, this.ended])
    this.arm()
    return db
  }

  /** Gives a login back. A login that is broken, or that the session has ended, is thrown away. */
  release(db: Login, spoiled = false): void {
    if (this.closed || spoiled || db.isClosed) void this.pool.destroy(db)
    else void this.pool.release(db)
  }

  /** Ends the session: every login is closed and no new one is opened. */
  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.end(new Error('The sign-in has ended.'))
    void this.pool.clear()
  }

  /** Closes the logins when the sign-in expires: a session must not outlive the token. */
  private arm(): void {
    const expiry = this.expiryOf()
    if (expiry === null) return
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.max(0, expiry - Date.now())
    const longest = 2147483647
    this.timer = setTimeout(
      () => {
        this.timer = null
        if (this.closed) return
        if (wait > longest) {
          this.arm()
          return
        }
        this.close()
      },
      Math.min(wait, longest)
    )
  }
}

/**
 * Whether the login itself is finished, and the session has to be opened again. A refused
 * statement is not: the session is as good as it was.
 */
export function broken(error: unknown): boolean {
  if (error instanceof ConnectionError) return true
  if (!(error instanceof PgError)) return false
  return (
    error.code === '25P02' || // the transaction failed, and the session is in limbo
    error.code === '25001' || // a transaction was already open, and this one is not
    error.code.startsWith('08') || // the connection is gone
    error.code.startsWith('28') || // the sign-in was refused
    error.code === '57P01' || // the server is shutting down
    error.code === '57P02' || // the server has crashed
    error.code === '57P03' // the server cannot take connections now
  )
}
