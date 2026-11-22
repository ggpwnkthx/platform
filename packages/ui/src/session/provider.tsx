import type { ComponentChildren } from 'preact'
import { useCallback, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { KeptSession } from '@platform/pg-client'
import type { Catalog, Identity, PresentationIndex } from '@platform/data'
import type { PgError } from '@platform/pg-client'
import { expiresAt } from '../identity/oidc.ts'
import type { RuntimeConfig } from '../config.ts'
import { connect, type Credentials, type Db, withoutIssuer } from '../pg/connect.ts'
import { currentLogin, loginRefused } from './errors.ts'
import { readInstallation } from './installation.ts'
import { useSignIn } from './sign-in.ts'
import { useStart, useWatch } from './start.ts'
import { emptyCatalog, type Phase, type Session, type Toast, SessionContext } from './types.ts'

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
      currentLogin(credentials.current, config, signOut)
      const kept = keeper.current
      if (!kept) throw new Error('Sign in first.')
      try {
        return await kept.run(work)
      } catch (error) {
        if (loginRefused(error))
          signOut(`The database refused the sign-in: ${(error as PgError).message}`)
        throw error
      }
    },
    [config, signOut]
  )

  const withReaderDb = useCallback(
    async <T,>(work: (db: Db) => Promise<T>): Promise<T> => {
      const { who, config: cfg } = currentLogin(credentials.current, config, signOut)
      const db = await connect(cfg, who)
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
      const found = await kept.run(readInstallation)
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
    const found = await withDb(readInstallation)
    setIdentity(found.identity)
    setCatalog(found.catalog)
    setPresentations(found.presentations)
  }, [withDb])

  // Start: read the configuration, finish a sign-in the issuer sent back, or stay signed out.
  useStart({
    load,
    setConfig,
    setPhase,
    setNotice,
    onFailure: () => {
      credentials.current = null
    },
  })

  const { signIn, signInAs } = useSignIn({ config, load, setPhase, setNotice })

  useWatch({
    phase,
    path: location.path,
    token: credentials.current?.token,
    notify,
    route: location.route,
  })

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
