import { createContext, type ComponentChildren } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { beginSignIn, completeSignIn, expiresAt, roleOf } from './identity/oidc.ts'
import { type RuntimeConfig, runtimeConfig } from './config.ts'
import { connect, type Credentials, type Db, type Person, withoutIssuer } from './pg/connect.ts'
import { KeptSession } from '@platform/pg-client'
import {
  catalog as readCatalog,
  type Catalog,
  identity as readIdentity,
  type Identity,
  presentations as readPresentations,
  workspacesWithMetadata,
} from '@platform/data'
import { ConnectionError, PgError } from '@platform/pg-client'
import { indexPresentations, type PresentationIndex } from '@platform/data'
import { versionProblem } from './version.ts'

export type Phase = 'starting' | 'signed-out' | 'signing-in' | 'ready'

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

export interface Session {
  phase: Phase
  /** Why the reader is signed out, when there is a reason worth saying. */
  notice: string | null
  config: RuntimeConfig | null
  identity: Identity | null
  catalog: Catalog
  /** How each item presents itself: its display name, its icon and its colour. */
  presentations: PresentationIndex
  /**
   * Runs the work as the reader, on a login the page keeps open: one for the whole page,
   * not one for every action.
   */
  withDb: <T>(work: (db: Db) => Promise<T>) => Promise<T>
  /**
   * Runs the reader's own statement as them, on a login of their own that is closed again
   * afterwards: their SQL never shares a login with the platform's, so a transaction they
   * leave open cannot reach the platform's work.
   */
  withReaderDb: <T>(work: (db: Db) => Promise<T>) => Promise<T>
  /** Reads the catalog again: after a change to the model or to a right. */
  refresh: () => Promise<void>
  signIn: (returnTo?: string) => Promise<void>
  /** Signs in as one of the people who may sign in without an issuer. */
  signInAs: (role: string) => Promise<void>
  signOut: (notice?: string) => void
  toasts: Toast[]
  notify: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  /** The workspace the reader last chose, for pages whose address names none. */
  lastWorkspace: string | null
  rememberWorkspace: (name: string) => void
}

const emptyCatalog: Catalog = {
  schemas: [],
  tables: [],
  columns: [],
  relations: [],
  constraints: [],
  types: [],
}

/** The person chosen for this page, when this build lets people in without an issuer. */
function personChosen(): Person | undefined {
  const chosen = withoutIssuer.chosen()
  return chosen ? withoutIssuer.people.find((person) => person.role === chosen) : undefined
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('The session is missing')
  return session
}

/** What went wrong, in words for the reader. */
export function describe(error: unknown): { title: string; detail?: string } {
  if (error instanceof PgError) {
    const parts = [error.detail, error.hint && `Hint: ${error.hint}`].filter(Boolean)
    return {
      title: `${error.message} (${error.code})`,
      detail: parts.length ? parts.join(' ') : undefined,
    }
  }
  if (error instanceof ConnectionError) return { title: error.message }
  if (error instanceof Error) return { title: error.message }
  return { title: String(error) }
}

/** A sign-in that PostgreSQL no longer accepts: the token expired or the role went away. */
const loginRefused = (error: unknown) =>
  error instanceof PgError && (error.code === '28000' || error.code === '28P01')

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const location = useLocation()
  const [phase, setPhase] = useState<Phase>('starting')
  const [notice, setNotice] = useState<string | null>(null)
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog)
  const [presentations, setPresentations] = useState<PresentationIndex>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null)
  // The token lives here and nowhere else: not a cookie, not storage.
  const credentials = useRef<Credentials | null>(null)
  // The logins the page keeps open while the reader is signed in.
  const keeper = useRef<KeptSession | null>(null)
  const counter = useRef(0)

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++counter.current
    setToasts((all) => [...all.slice(-3), { ...toast, id }])
    if (toast.tone !== 'error')
      setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 5000)
  }, [])
  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    []
  )

  const signOut = useCallback(
    (reason?: string) => {
      credentials.current = null
      keeper.current?.close()
      keeper.current = null
      setIdentity(null)
      setCatalog(emptyCatalog)
      setPresentations({})
      setNotice(reason ?? null)
      setPhase('signed-out')
      withoutIssuer.forget()
      location.route('/')
    },
    [location]
  )

  const withDb = useCallback(
    async <T,>(work: (db: Db) => Promise<T>): Promise<T> => {
      const who = credentials.current
      if (!who || !config) throw new Error('Sign in first.')
      const expiry = expiresAt(who.token)
      if (expiry !== null && expiry <= Date.now()) {
        signOut('Your sign-in expired. Sign in again to continue.')
        throw new Error('Your sign-in expired.')
      }
      const kept = keeper.current
      if (!kept) throw new Error('Sign in first.')
      try {
        return await kept.run(work)
      } catch (error) {
        if (loginRefused(error))
          signOut(`PostgreSQL refused the sign-in: ${(error as PgError).message}`)
        throw error
      }
    },
    [config, signOut]
  )

  const withReaderDb = useCallback(
    async <T,>(work: (db: Db) => Promise<T>): Promise<T> => {
      const who = credentials.current
      if (!who || !config) throw new Error('Sign in first.')
      const expiry = expiresAt(who.token)
      if (expiry !== null && expiry <= Date.now()) {
        signOut('Your sign-in expired. Sign in again to continue.')
        throw new Error('Your sign-in expired.')
      }
      const db = await connect(config, who)
      try {
        return await work(db)
      } finally {
        db.close()
      }
    },
    [config, signOut]
  )

  const load = useCallback(async (who: Credentials, cfg: RuntimeConfig) => {
    credentials.current = who
    // The login the page keeps: opened once, and shared by every action that follows.
    keeper.current?.close()
    const kept = new KeptSession({
      open: () => connect(cfg, who),
      expiresAt: () => expiresAt(who.token),
    })
    keeper.current = kept
    try {
      const found = await kept.run(async (db) => {
        // The identity first: it says which version the installation is, and the rest of the
        // platform's schema is that version's.
        const me = await readIdentity(db)
        const wrong = versionProblem(me.platform_version)
        if (wrong) throw new Error(wrong)
        const found = await readCatalog(db)
        // Every workspace keeps its own metadata: the catalog says which of them the reader reaches.
        const shown = await readPresentations(db, workspacesWithMetadata(found))
        return { identity: me, catalog: found, presentations: indexPresentations(shown) }
      })
      setIdentity(found.identity)
      setCatalog(found.catalog)
      setPresentations(found.presentations)
      setPhase('ready')
      setNotice(null)
    } catch (error) {
      kept.close()
      keeper.current = null
      throw error
    }
  }, [])

  const refresh = useCallback(async () => {
    const found = await withDb(async (db) => {
      const me = await readIdentity(db)
      const wrong = versionProblem(me.platform_version)
      if (wrong) throw new Error(wrong)
      const read = await readCatalog(db)
      return {
        identity: me,
        catalog: read,
        presentations: await readPresentations(db, workspacesWithMetadata(read)),
      }
    })
    setIdentity(found.identity)
    setCatalog(found.catalog)
    setPresentations(indexPresentations(found.presentations))
  }, [withDb])

  // Start: read the configuration, finish a sign-in the issuer sent back, or stay signed out.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const cfg = await runtimeConfig()
        if (!live) return
        setConfig(cfg)
        if (withoutIssuer.people.length > 0) {
          const person = personChosen()
          if (person) {
            setPhase('signing-in')
            await load({ role: person.role, token: person.token }, cfg)
            return
          }
          setPhase('signed-out')
          return
        }
        const signed = await completeSignIn(cfg)
        if (!signed) {
          // A link may ask for the sign-in to begin at once, by ending in `#signin`. It names
          // nobody and carries nothing: it only saves the click that sends the reader to the
          // issuer, where they sign in as they always do.
          // The page's own address: `location` here is the router's.
          const here = window.location
          if (here.hash === '#signin') {
            history.replaceState(null, '', here.pathname + here.search)
            setPhase('signing-in')
            await beginSignIn(cfg, here.pathname === '/' ? '/content' : here.pathname + here.search)
            return
          }
          setPhase('signed-out')
          return
        }
        setPhase('signing-in')
        const role = roleOf(signed.token, cfg.claim)
        if (!role) throw new Error(`The token names no PostgreSQL role in its ${cfg.claim} claim.`)
        await load({ role, token: signed.token }, cfg)
        location.route(
          signed.returnTo && signed.returnTo !== '/' ? signed.returnTo : '/content',
          true
        )
      } catch (error) {
        credentials.current = null
        setNotice(describe(error).title)
        setPhase('signed-out')
      }
    })()
    return () => {
      live = false
    }
    // Runs once per page load: a reload starts signed out.
  }, [])

  // Signed in, and sitting on the sign-in page: go to the content.
  useEffect(() => {
    if (phase === 'ready' && location.path === '/') location.route('/content', true)
  }, [phase, location.path])

  // A token is a login until it expires: say so a minute before.
  useEffect(() => {
    const token = credentials.current?.token
    if (phase !== 'ready' || !token) return
    const expiry = expiresAt(token)
    if (expiry === null) return
    const warn = setTimeout(
      () =>
        notify({
          tone: 'info',
          title: 'Your sign-in expires in a minute',
          detail: 'Sign in again to keep working; unsaved changes stay on the page until then.',
        }),
      Math.max(0, expiry - Date.now() - 60000)
    )
    return () => clearTimeout(warn)
  }, [phase, notify])

  const signIn = useCallback(
    async (returnTo = '/content') => {
      if (!config) return
      try {
        setPhase('signing-in')
        await beginSignIn(config, returnTo)
      } catch (error) {
        setNotice(describe(error).title)
        setPhase('signed-out')
      }
    },
    [config]
  )

  const signInAs = useCallback(
    async (role: string) => {
      if (!config) return
      const person = withoutIssuer.people.find((one) => one.role === role)
      if (!person) return
      withoutIssuer.choose(person.role)
      setPhase('signing-in')
      try {
        await load({ role: person.role, token: person.token }, config)
      } catch (error) {
        setNotice(describe(error).title)
        setPhase('signed-out')
      }
    },
    [config, load]
  )

  const session = useMemo<Session>(
    () => ({
      phase,
      notice,
      config,
      identity,
      catalog,
      presentations,
      withDb,
      withReaderDb,
      refresh,
      signIn,
      signInAs,
      signOut,
      toasts,
      notify,
      dismiss,
      lastWorkspace,
      rememberWorkspace: setLastWorkspace,
    }),
    [
      phase,
      notice,
      config,
      identity,
      catalog,
      presentations,
      withDb,
      withReaderDb,
      refresh,
      signIn,
      signInAs,
      signOut,
      toasts,
      notify,
      dismiss,
      lastWorkspace,
    ]
  )
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export interface Loaded<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
}

/** Reads something on its own connection whenever its inputs change. */
export function useLoad<T>(work: ((db: Db) => Promise<T>) | null, deps: unknown[]): Loaded<T> {
  const { withDb, phase } = useSession()
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (phase !== 'ready' || !work) return
    let live = true
    setLoading(true)
    setError(null)
    withDb(work)
      .then((value) => {
        if (live) setData(value)
      })
      .catch((reason) => {
        if (live) setError(reason)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [phase, tick, ...deps])
  return { data, error, loading, reload: () => setTick((n) => n + 1) }
}
