import type { MembershipInfo } from '@platform/data'
import { Statement } from '../../ui/bits.tsx'
import { Confirm } from '../../ui/overlay.tsx'
import type { Runner } from '../runner.tsx'

/** A membership taken away: what it was, and what the database will do. */
export function RemoveMembership({
  removing,
  statement,
  runner,
  onClose,
  onConfirm,
}: {
  removing: MembershipInfo | null
  /** The statement that takes the membership away. */
  statement: string
  runner: Runner
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Confirm
      open={removing !== null}
      title="Remove this membership?"
      confirm="Revoke"
      busy={runner.busy}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      {removing && (
        <>
          <p>
            {removing.member} stops holding what {removing.role} is granted, in every workspace,
            from its next statement.
          </p>
          <Statement sql={statement} />
        </>
      )}
    </Confirm>
  )
}
