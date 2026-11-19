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
  private readonly size: number
  private readonly open: () => Promise<Login>
  private readonly expiryOf: () => number | null
  /** Logins nobody is using. */
  private free: Login[] = []
  /** Logins an action is using. */
  private busy = new Set<Login>()
  /** Actions waiting for a login. */
  private waiting: { resolve: (db: Login) => void; reject: (error: unknown) => void }[] = []
  /** Logins on their way. */
  private opening = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(options: KeptSessionOptions) {
    this.size = Math.max(1, options.size ?? 2)
    this.open = options.open
    this.expiryOf = options.expiresAt
  }

  /**
   * Runs the work on a login of its own, and gives the login back afterwards. A login the
   * work has broken is thrown away rather than given back.
   */
  async run<T>(work: (db: Login) => Promise<T>): Promise<T> {
    const db = await this.acquire()
    try {
      return await work(db)
    } catch (error) {
      if (broken(error)) this.drop(db)
      throw error
    } finally {
      this.release(db)
    }
  }

  /** A login to work on: one that is free, or a new one, or a wait for one to come back. */
  async acquire(): Promise<Login> {
    if (this.closed) throw new Error('The sign-in has ended.')
    this.pump()
    const free = this.free.pop()
    if (free) {
      this.busy.add(free)
      return free
    }
    if (this.live < this.size) return this.newLogin()
    return new Promise<Login>((resolve, reject) => this.waiting.push({ resolve, reject }))
  }

  /** Gives a login back. */
  release(db: Login): void {
    this.busy.delete(db)
    if (this.closed || db.isClosed) this.drop(db)
    else this.free.push(db)
    this.pump()
  }

  /** Throws a login away: it cannot be used again. */
  drop(db: Login): void {
    this.busy.delete(db)
    this.free = this.free.filter((other) => other !== db)
    try {
      db.close()
    } catch {
      // It is already gone.
    }
  }

  /** Ends the session: every login is closed and no new one is opened. */
  close(): void {
    this.closed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const db of [...this.free, ...this.busy]) this.drop(db)
    this.free = []
    this.busy.clear()
    for (const waiter of this.waiting.splice(0)) waiter.reject(new Error('The sign-in has ended.'))
  }

  /** How many logins the page holds: the ones in use, the ones waiting, and the ones coming. */
  private get live(): number {
    return this.free.length + this.busy.size + this.opening
  }

  /** Opens a login and hands it to the action that asked for one. */
  private async newLogin(): Promise<Login> {
    this.opening++
    try {
      const db = await this.open()
      if (this.closed) {
        db.close()
        throw new Error('The sign-in has ended.')
      }
      this.busy.add(db)
      this.arm()
      return db
    } finally {
      this.opening--
    }
  }

  /** Hands free logins to whoever is waiting, and opens more when the pool is below its size. */
  private pump(): void {
    this.free = this.free.filter((db) => !db.isClosed)
    while (this.waiting.length > 0) {
      const free = this.free.pop()
      if (free) {
        this.busy.add(free)
        this.waiting.shift()!.resolve(free)
        continue
      }
      if (this.live >= this.size) return
      const waiter = this.waiting.shift()!
      this.opening++
      this.open()
        .then((db) => {
          this.opening--
          if (this.closed) {
            db.close()
            waiter.reject(new Error('The sign-in has ended.'))
            return
          }
          this.busy.add(db)
          this.arm()
          waiter.resolve(db)
        })
        .catch((error) => {
          this.opening--
          waiter.reject(error)
        })
    }
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
