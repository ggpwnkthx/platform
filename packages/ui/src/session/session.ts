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
  sqlState,
  VERSION,
  versionMismatch,
} from '@platform/core'
import type { AuthProvider } from 'react-admin'
import { useSyncExternalStore } from 'react'
import { startInPage } from 'virtual:platform-site'
import { loadConfig, type RuntimeConfig } from '../config.ts'
import { openSession, type Session } from './connect.ts'
import { signedIn, signIn } from './signin.ts'

/**
 * The reader's sign-in: one PostgreSQL login, who PostgreSQL says they are, and the catalog
 * as they may see it. It lives in memory and nowhere else, so a page load starts signed out.
 */
export interface Signed {
  db: Session
  identity: Identity
  catalog: Catalog
  presentations: PresentationIndex
}
const chosenKey = 'platform.dev.person'
let config: RuntimeConfig | null = null
let signed: Signed | null = null
let notice: string | null = startInPage?.notice ?? null
let expiry: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((listener) => void listener())
const read = async (db: Session) => {
  const identity = await readIdentity(db)
  const mismatch = versionMismatch(identity.platform_version)
  if (mismatch)
    throw new Error(
      `This database is at version ${identity.platform_version}, ${mismatch} than this interface (${VERSION}). ` +
        (mismatch === 'older'
          ? 'Install the matching migration.'
          : 'Publish the matching interface.')
    )
  const catalog = await readCatalog(db)
  return { db, identity, catalog, presentations: indexPresentations(await readPresentations(db)) }
}
async function enter(role: string, token: string | null) {
  const db = startInPage
    ? await startInPage.open(role)
    : openSession({ ...config!, role, token: token ?? '' })
  try {
    signed = await read(db)
  } catch (error) {
    void db.close()
    throw error
  }
  notice = null
  const ends = token ? expiresAt(token) : null
  // A sign-in ends when its token does.
  if (ends !== null)
    expiry = setTimeout(
      () => leave('Your sign-in expired. Sign in again to continue.'),
      Math.min(Math.max(0, ends - Date.now()), 2 ** 31 - 1)
    )
  tell()
}
function leave(reason?: string) {
  clearTimeout(expiry)
  void signed?.db.close()
  signed = null
  sessionStorage.removeItem(chosenKey)
  notice = reason ?? startInPage?.notice ?? null
  tell()
}

/** Before anything is drawn: the configuration, and a sign-in that is coming back or kept. */
export async function start() {
  try {
    config = await loadConfig()
    if (startInPage) {
      const chosen = sessionStorage.getItem(chosenKey)
      if (chosen && (await startInPage.people()).some((p) => p.role === chosen))
        await enter(chosen, null)
      return
    }
    const answer = await signedIn(config)
    if (answer) await enter(answer.role, answer.token)
  } catch (error) {
    notice = describe(error).title
  }
}

export const session = {
  get: () => signed,
  notice: () => notice,
  /** Reads the catalog again: after a change, what PostgreSQL says may be different. */
  async refresh() {
    if (!signed) return
    signed = await read(signed.db)
    tell()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}
export const useSigned = () => useSyncExternalStore(session.subscribe, session.get)
/** The sign-in a page inside the frame works with: there is one, or the page is not drawn. */
export const useSession = () => useSigned()!

/**
 * What react-admin asks about the sign-in. It reflects PostgreSQL's answers and holds none of
 * its own: there is no `canAccess` here, and a login PostgreSQL refuses signs the reader out.
 */
export const authProvider: AuthProvider = {
  async login({ role, returnTo }: { role?: string; returnTo: string }) {
    if (!startInPage) return signIn(config!, returnTo)
    await enter(role!, null).catch((error) => {
      throw new Error(describe(error).title)
    })
    sessionStorage.setItem(chosenKey, role!)
  },
  async logout() {
    leave()
  },
  checkAuth: () => (signed ? Promise.resolve() : Promise.reject({ message: false })),
  async checkError(error) {
    if (!sqlState(error)?.startsWith('28')) return
    leave(`The database refused the sign-in: ${describe(error).title}`)
    throw error
  },
  getIdentity: async () => ({ id: signed!.identity.username, fullName: signed!.identity.username }),
}
