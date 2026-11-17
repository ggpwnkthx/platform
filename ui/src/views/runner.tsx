import { useState } from 'preact/hooks'
import { transaction } from '../db/platform.ts'
import { describe, useSession } from '../session.tsx'

/**
 * Runs statements the reader has seen, as the reader, in one transaction: all of them happen
 * or none do. The catalog is read again afterwards, since a statement may change what the
 * reader may reach.
 */
export function useRunner() {
  const { withDb, refresh, notify } = useSession()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null)
  const runStatements = async (statements: string[], success: string): Promise<boolean> => {
    setBusy(true)
    setProblem(null)
    try {
      await withDb((db) =>
        transaction(db, async () => {
          for (const statement of statements) await db.query(statement)
        })
      )
      notify({ tone: 'success', title: success })
      await refresh().catch(() => undefined)
      return true
    } catch (error) {
      setProblem(describe(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, problem, setProblem, runStatements }
}
