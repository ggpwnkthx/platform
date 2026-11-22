import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { Catalog, Identity, PresentationIndex } from '@platform/data'
import type { RuntimeConfig } from '../config.ts'
import type { Db } from '../pg/connect.ts'

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

/** The catalog before the database has been read: nothing is known of it yet. */
export const emptyCatalog: Catalog = {
  schemas: [],
  tables: [],
  columns: [],
  relations: [],
  constraints: [],
  types: [],
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('The session is missing')
  return session
}
