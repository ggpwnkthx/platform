import { useEffect, useState } from 'preact/hooks'
import type { Db } from '../pg/connect.ts'
import { useSession } from './types.ts'

export interface Loaded<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
}

/** Reads something on its own connection whenever its inputs change. */
export function useLoad<T>(work: ((db: Db) => Promise<T>) | null, deps: unknown[]): Loaded<T> {
  const { withDb, phase } = useSession()
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (phase !== 'ready' || !work) return
    let live = true
    setLoading(true)
    setError(null)
    withDb(work)
      .then((value) => {
        if (live) setData(value)
      })
      .catch((reason) => {
        if (live) setError(reason)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [phase, tick, ...deps])
  return { data, error, loading, reload: () => setTick((n) => n + 1) }
}
