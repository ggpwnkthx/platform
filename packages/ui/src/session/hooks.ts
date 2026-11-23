import { useSearchParams } from 'react-router'
import { sqlState } from '@platform/core'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '../connect.ts'
import { useSession } from './context.ts'

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
