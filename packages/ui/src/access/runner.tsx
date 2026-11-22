import { useState } from 'preact/hooks'
import { transaction } from '@platform/vocabulary'
import { describe, useSession } from '../session.tsx'
import { Notice } from '../ui/bits.tsx'

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

/** The runner a drawer holds while it works. */
export type Runner = ReturnType<typeof useRunner>

/** What the database said when the reader's statements could not run. */
export function RunnerProblem({ runner }: { runner: Runner }) {
  if (!runner.problem) return null
  return (
    <Notice tone="danger" title={runner.problem.title}>
      {runner.problem.detail}
    </Notice>
  )
}
