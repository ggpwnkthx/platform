import { notifications } from '@mantine/notifications'
import {
  type Catalog,
  catalog as readCatalog,
  describe,
  expiresAt,
  type Identity,
  identity as readIdentity,
  indexPresentations,
  type PresentationIndex,
  presentations as readPresentations,
  roleOf,
  sqlState,
  transaction,
  VERSION,
  versionMismatch,
} from '@platform/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { startInPage } from 'virtual:platform-site'
import { defaultRuntimeConfig, type RuntimeConfig } from './config.ts'
import { openSession, type Session } from './connect.ts'

export interface Person {
  role: string
  note: string
}
/** The dev mode's stand-in for an issuer and a relay: PostgreSQL in the page, and its people. */
export interface InPage {
  people: Person[]
  notice: string
  open(role: string): Promise<Session>
}
interface Installation {
  identity: Identity
  catalog: Catalog
  presentations: PresentationIndex
}
type Phase = 'starting' | 'signed-out' | 'signing-in' | 'ready'
interface Gate {
  phase: Phase
  notice: string | null
  people: Person[]
  signIn(returnTo?: string): void
  signInAs(role: string): void
  signOut(reason?: string): void
}
interface Ready extends Installation {
  db: Session
  /** Runs statements as the reader, in one transaction, then reads everything again. */
  run(statements: string[]): Promise<void>
  refresh(): Promise<void>
  signOut(reason?: string): void
}

async function readInstallation(db: Session): Promise<Installation> {
  const identity = await readIdentity(db)
  const mismatch = versionMismatch(identity.platform_version)
  if (mismatch)
    throw new Error(
      mismatch === 'older'
        ? `This database is at version ${identity.platform_version}; the interface is ${VERSION}. Run \`bun run cli migrate\`.`
        : `This database is at version ${identity.platform_version}, newer than this interface (${VERSION}). Publish the matching interface.`
    )
  return {
    identity,
    catalog: await readCatalog(db),
    presentations: indexPresentations(await readPresentations(db)),
  }
}

const loadConfig = async (): Promise<RuntimeConfig> => {
  const response = await fetch('/config.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('The interface has no configuration: config.json is missing.')
  const config = { ...defaultRuntimeConfig, ...(await response.json()) } as RuntimeConfig
  // A path is resolved against the page; ws:// on an http page and wss:// on an https one.
  const relay = new URL(config.relay, location.href)
  if (!/^wss?:$/.test(relay.protocol))
    relay.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { ...config, issuer: config.issuer.replace(/\/+$/, ''), relay: relay.toString() }
}
/** The token lives in memory only, so a page load always starts signed out. */
const issuer = (config: RuntimeConfig) =>
  new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${location.origin}/`,
    scope: 'openid email',
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  })

const GateContext = createContext<Gate | null>(null)
const ReadyContext = createContext<Ready | null>(null)
export const useGate = () => useContext(GateContext)!
export function useSession(): Ready {
  const session = useContext(ReadyContext)
  if (!session) throw new Error('Sign in first.')
  return session
}
const chosenKey = 'platform.dev.as'

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('starting')
  const [notice, setNotice] = useState<string | null>(startInPage?.notice ?? null)
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [login, setLogin] = useState<{ db: Session; token: string | null } | null>(null)

  const signOut = useCallback(
    (reason?: string) => {
      setLogin((held) => {
        void held?.db.close()
        return null
      })
      sessionStorage.removeItem(chosenKey)
      queryClient.clear()
      setNotice(reason ?? startInPage?.notice ?? null)
      setPhase('signed-out')
      navigate('/')
    },
    [queryClient, navigate]
  )
  const fail = useCallback((error: unknown) => {
    setNotice(describe(error).title)
    setPhase('signed-out')
  }, [])
  const enter = useCallback(
    async (cfg: RuntimeConfig, role: string, token: string | null) => {
      setPhase('signing-in')
      const db = startInPage
        ? await startInPage.open(role)
        : openSession({ ...cfg, role, token: token ?? '' })
      try {
        queryClient.setQueryData(['installation'], await readInstallation(db))
      } catch (error) {
        void db.close()
        throw error
      }
      setLogin({ db, token })
      setNotice(null)
      setPhase('ready')
    },
    [queryClient]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: the page starts once
  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig()
      setConfig(cfg)
      if (startInPage) {
        const chosen = sessionStorage.getItem(chosenKey)
        if (chosen && startInPage.people.some((p) => p.role === chosen))
          return enter(cfg, chosen, null)
        return setPhase('signed-out')
      }
      const answer = new URLSearchParams(location.search)
      if (!answer.has('state') || !(answer.has('code') || answer.has('error')))
        return setPhase('signed-out')
      setPhase('signing-in')
      const user = await issuer(cfg).signinCallback()
      // Back to the page the reader asked for, before anything is drawn there: the address no
      // longer carries the issuer's answer, and the sign-in finishes on the right page.
      navigate(typeof user?.state === 'string' ? user.state : '/content', { replace: true })
      // PostgreSQL's validator reads a signed token: whichever of the two is one.
      const token = [user?.access_token, user?.id_token].find((t) => t?.split('.').length === 3)
      if (!token) throw new Error('The issuer returned no signed token.')
      const role = roleOf(token, cfg.claim)
      if (!role) throw new Error(`The token names no database role in its ${cfg.claim} claim.`)
      await enter(cfg, role, token)
    })().catch(fail)
  }, [])

  // A sign-in ends when its token does: warned a minute before, then signed out.
  useEffect(() => {
    const expiry = login?.token ? expiresAt(login.token) : null
    if (expiry === null) return
    const left = Math.max(0, expiry - Date.now())
    const warn = setTimeout(
      () =>
        notifications.show({
          title: 'Your sign-in expires in a minute',
          message: 'Sign in again to keep working.',
        }),
      Math.max(0, left - 60000)
    )
    const end = setTimeout(
      () => signOut('Your sign-in expired. Sign in again to continue.'),
      Math.min(left, 2 ** 31 - 1)
    )
    return () => {
      clearTimeout(warn)
      clearTimeout(end)
    }
  }, [login, signOut])

  const installation = useQuery({
    queryKey: ['installation'],
    queryFn: () => readInstallation(login!.db),
    enabled: !!login,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const gate = useMemo<Gate>(
    () => ({
      phase,
      notice,
      people: startInPage?.people ?? [],
      signOut,
      // Signing in returns the reader to the page they asked for.
      signIn: (
        returnTo = location.pathname === '/' ? '/content' : location.pathname + location.search
      ) => {
        if (!config) return
        setPhase('signing-in')
        issuer(config)
          .signinRedirect({ state: returnTo })
          .catch(() => fail(new Error(`The sign-in service at ${config.issuer} did not answer.`)))
      },
      signInAs: (role) => {
        if (!config) return
        sessionStorage.setItem(chosenKey, role)
        enter(config, role, null).then(
          () => location.pathname === '/' && navigate('/content'),
          fail
        )
      },
    }),
    [phase, notice, config, signOut, enter, fail, navigate]
  )
  const ready = useMemo<Ready | null>(() => {
    if (phase !== 'ready' || !login || !installation.data) return null
    const refresh = () => queryClient.invalidateQueries()
    return {
      ...installation.data,
      db: login.db,
      refresh,
      signOut,
      run: async (statements) => {
        await login.db.exclusive((db) =>
          transaction(db, async () => {
            for (const statement of statements) await db.query(statement)
          })
        )
        // A statement may change what the reader may reach.
        await refresh()
      },
    }
  }, [phase, login, installation.data, queryClient, signOut])
  return (
    <GateContext.Provider value={gate}>
      <ReadyContext.Provider value={ready}>{children}</ReadyContext.Provider>
    </GateContext.Provider>
  )
}

/** Something read from PostgreSQL as the reader. A login PostgreSQL refuses signs them out. */
export function useDb<T>(key: unknown[], work: (db: Session) => Promise<T>, enabled = true) {
  const { db, signOut } = useSession()
  return useQuery({
    queryKey: key,
    enabled,
    queryFn: () =>
      work(db).catch((error) => {
        if (sqlState(error)?.startsWith('28'))
          signOut(`The database refused the sign-in: ${error.message}`)
        throw error
      }),
  })
}

let lastWorkspace: string | null = null
/** What is in view is part of the address: the workspace in ?ws=, the collection in ?c=, a record in ?id=. */
export function usePlace() {
  const { catalog } = useSession()
  const [params, setParams] = useSearchParams()
  const named = params.get('ws')
  const ws =
    catalog.schemas.find((s) => s.name === (named ?? lastWorkspace))?.name ??
    catalog.schemas.find((s) => s.kind === 'user')?.name ??
    ''
  if (ws && catalog.schemas.find((s) => s.name === ws)?.kind === 'user') lastWorkspace = ws
  const c = params.get('c') ?? ''
  return {
    ws,
    c,
    id: params.get('id') ?? '',
    params,
    schema: catalog.schemas.find((s) => s.name === ws),
    /** An address in the interface, carrying the workspace in view. */
    to: (path: string, more: Record<string, string | undefined> = {}) => {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries({ ws, ...more })) if (value) query.set(key, value)
      return `${path}?${query}`
    },
    /** Changes what the address says, in place. */
    set: (changes: Record<string, string | null | undefined>, replace = true) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes))
            if (value) next.set(key, value)
            else next.delete(key)
          return next
        },
        { replace }
      ),
  }
}
