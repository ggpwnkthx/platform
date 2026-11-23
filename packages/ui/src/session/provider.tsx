import { notifications } from '@mantine/notifications'
import { describe, expiresAt, roleOf, transaction } from '@platform/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { startInPage } from 'virtual:platform-site'
import type { RuntimeConfig } from '../config.ts'
import { openSession, type Session } from '../connect.ts'
import { GateContext, ReadyContext } from './context.ts'
import { issuer, loadConfig, readInstallation } from './installation.ts'
import type { Phase } from './types.ts'

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
  const gate = useMemo(
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
      signInAs: (role: string) => {
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
  const ready = useMemo(() => {
    if (phase !== 'ready' || !login || !installation.data) return null
    const refresh = () => queryClient.invalidateQueries()
    return {
      ...installation.data,
      db: login.db,
      refresh,
      signOut,
      run: async (statements: string[]) => {
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
