import { useState } from 'preact/hooks'
import type { Held, Wanted } from '@platform/vocabulary'
import { wantedOf } from '../model.ts'
import { sameWanted } from './wishes.ts'

/**
 * What the reader has changed of the privileges: the edits are theirs, and everything they
 * have not touched is still what the ACL says.
 */
export function useEdits(held: Record<string, Held>, columns: string[]) {
  const [edits, setEdits] = useState<Record<string, Wanted>>({})
  const wanted = (privilege: string): Wanted => edits[privilege] ?? wantedOf(held[privilege])
  const set = (privilege: string, next: Wanted) => {
    const stored = wantedOf(held[privilege])
    const rest = { ...edits }
    if (sameWanted(next, stored)) delete rest[privilege]
    else rest[privilege] = next
    setEdits(rest)
  }
  const choose = (privilege: string, mode: string) => {
    if (mode === 'none' || mode === 'all') return set(privilege, mode)
    const now = wanted(privilege)
    // Narrowing the whole collection starts from every field, so that one may be taken out.
    set(privilege, now === 'all' ? [...columns] : now === 'none' ? [] : now)
  }
  return { edits, setEdits, wanted, set, choose }
}
