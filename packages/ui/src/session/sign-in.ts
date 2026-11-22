import { useCallback } from 'preact/hooks'
import { beginSignIn } from '../identity/oidc.ts'
import type { RuntimeConfig } from '../config.ts'
import type { Credentials } from '../pg/connect.ts'
import { withoutIssuer } from '../pg/connect.ts'
import { describe } from './errors.ts'
import type { Phase } from './types.ts'

/**
 * The ways in: with the issuer, or as one of the people this build lets in without one.
 */
export function useSignIn({
  config,
  load,
  setPhase,
  setNotice,
}: {
  config: RuntimeConfig | null
  /** Signs the reader in with a login, and reads what the installation holds. */
  load: (who: Credentials, cfg: RuntimeConfig) => Promise<void>
  setPhase: (phase: Phase) => void
  setNotice: (notice: string | null) => void
}) {
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
    [config, setPhase, setNotice]
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
    [config, load, setPhase, setNotice]
  )

  return { signIn, signInAs }
}
