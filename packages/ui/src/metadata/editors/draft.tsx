import { useState } from 'preact/hooks'
import { useRunner } from '../../access/runner.tsx'
import { Notice, Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'

/** What every editor of a reserved key shares: a draft that follows the database, and a save. */

/**
 * A draft of what the database holds. What the database holds is the truth: when it changes —
 * the editor's own save, or someone else's — the draft follows it.
 */
export function useDraft<T>(stored: T, same: (one: T, other: T) => boolean) {
  const [draft, setDraft] = useState(stored)
  const [seen, setSeen] = useState(stored)
  if (!same(seen, stored)) {
    setSeen(stored)
    setDraft(stored)
  }
  return [draft, setDraft] as const
}

/**
 * The end of an editor: the statements that will run, shown before they run, and the button
 * that runs them as the reader, in one transaction. A refusal is the database's own, and it is
 * shown as it was given.
 */
export function SaveStatements({
  statements,
  label,
  saved,
  disabled,
  onSaved,
}: {
  statements: string[]
  /** What the button says. */
  label: string
  /** What the reader is told once the database has run them. */
  saved: string
  /** The draft cannot be saved as it stands. */
  disabled?: boolean
  /** Told once the statements have run, so what was read may be read again. */
  onSaved?: () => void
}) {
  const runner = useRunner()
  return (
    <>
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {statements.length > 0 && (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      )}
      <div class="row-actions">
        <Button
          tone="primary"
          busy={runner.busy}
          disabled={!statements.length || disabled}
          onClick={async () => {
            if (await runner.runStatements(statements, saved)) onSaved?.()
          }}
        >
          {label}
        </Button>
      </div>
    </>
  )
}
