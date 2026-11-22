import { Button } from '../../ui/button.tsx'
import type { Runner } from '../runner.tsx'

/**
 * The foot of a grant drawer: cancel, and the button that applies the statements — or
 * revokes them, when what they take away is what the role already holds.
 */
export function GrantFooter({
  statements,
  problem,
  grantee,
  revoking,
  runner,
  onDone,
  onClose,
}: {
  statements: string[]
  problem: string | null
  grantee: string
  revoking: boolean
  runner: Runner
  onDone: () => void
  onClose: () => void
}) {
  return (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        tone={revoking ? 'danger' : 'primary'}
        busy={runner.busy}
        disabled={!statements.length || !!problem}
        onClick={async () => {
          if (await runner.runStatements(statements, `Changed what ${grantee} holds`)) {
            onDone()
            onClose()
          }
        }}
      >
        {revoking ? 'Revoke' : 'Apply'}
      </Button>
    </>
  )
}
