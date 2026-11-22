import { useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { beginSignIn, completeSignIn, expiresAt, roleOf } from '../identity/oidc.ts'
import { runtimeConfig, type RuntimeConfig } from '../config.ts'
import { type Credentials, type Person, withoutIssuer } from '../pg/connect.ts'
import { describe } from './errors.ts'
import type { Phase } from './types.ts'

/** The person chosen for this page, when this build lets people in without an issuer. */
function personChosen(): Person | undefined {
  const chosen = withoutIssuer.chosen()
  return chosen ? withoutIssuer.people.find((person) => person.role === chosen) : undefined
}

/**
 * The start of the page: read the configuration, finish a sign-in the issuer sent back, or
 * stay signed out. A reload starts signed out: the token lives in memory and nowhere else.
 */
export function useStart({
  load,
  setConfig,
  setPhase,
  setNotice,
  onFailure,
}: {
  /** Signs the reader in with a login, and reads what the installation holds. */
  load: (who: Credentials, cfg: RuntimeConfig) => Promise<void>
  setConfig: (cfg: RuntimeConfig) => void
  setPhase: (phase: Phase) => void
  setNotice: (notice: string | null) => void
  /** What to do when the start fails: the token is dropped and the reader is told why. */
  onFailure: () => void
}) {
  const location = useLocation()
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
        if (!role) throw new Error(`The token names no database role in its ${cfg.claim} claim.`)
        await load({ role, token: signed.token }, cfg)
        location.route(
          signed.returnTo && signed.returnTo !== '/' ? signed.returnTo : '/content',
          true
        )
      } catch (error) {
        onFailure()
        setNotice(describe(error).title)
        setPhase('signed-out')
      }
    })()
    return () => {
      live = false
    }
    // Runs once per page load: a reload starts signed out.
  }, [])
}

/** What the page watches for while the reader is signed in. */
export function useWatch({
  phase,
  path,
  token,
  notify,
  route,
}: {
  phase: Phase
  /** The page's own path. */
  path: string
  /** The token the reader holds, if they hold one. */
  token: string | undefined
  notify: (toast: { tone: 'success' | 'error' | 'info'; title: string; detail?: string }) => void
  route: (path: string, replace?: boolean) => void
}) {
  // Signed in, and sitting on the sign-in page: go to the content.
  useEffect(() => {
    if (phase === 'ready' && path === '/') route('/content', true)
  }, [phase, path, route])

  // A token is a login until it expires: say so a minute before.
  useEffect(() => {
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
  }, [phase, notify, token])
}
