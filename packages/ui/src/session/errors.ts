import { ConnectionError, PgError } from '@platform/pg-client'
import { expiresAt } from '../identity/oidc.ts'
import type { RuntimeConfig } from '../config.ts'
import type { Credentials } from '../pg/connect.ts'

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

/** A sign-in that the database no longer accepts: the token expired or the role went away. */
export const loginRefused = (error: unknown) =>
  error instanceof PgError && (error.code === '28000' || error.code === '28P01')

/**
 * The login the reader holds, if it is still good: it must be there, and it must not have
 * expired. A login that has expired is signed out of, and the reader is told why.
 */
export function currentLogin(
  credentials: Credentials | null,
  config: RuntimeConfig | null,
  signOut: (reason?: string) => void
): { who: Credentials; config: RuntimeConfig } {
  if (!credentials || !config) throw new Error('Sign in first.')
  const expiry = expiresAt(credentials.token)
  if (expiry !== null && expiry <= Date.now()) {
    signOut('Your sign-in expired. Sign in again to continue.')
    throw new Error('Your sign-in expired.')
  }
  return { who: credentials, config }
}
