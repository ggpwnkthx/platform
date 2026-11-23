import type { Catalog, Identity, PresentationIndex } from '@platform/core'
import type { Session } from '../connect.ts'

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
export interface Installation {
  identity: Identity
  catalog: Catalog
  presentations: PresentationIndex
}
export type Phase = 'starting' | 'signed-out' | 'signing-in' | 'ready'
export interface Gate {
  phase: Phase
  notice: string | null
  people: Person[]
  signIn(returnTo?: string): void
  signInAs(role: string): void
  signOut(reason?: string): void
}
export interface Ready extends Installation {
  db: Session
  /** Runs statements as the reader, in one transaction, then reads everything again. */
  run(statements: string[]): Promise<void>
  refresh(): Promise<void>
  signOut(reason?: string): void
}
