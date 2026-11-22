import { Notice, Statement } from '../../ui/bits.tsx'
import type { GrantState } from './state.ts'

/** What the grants would do: the statements, or what there is to say about them. */
export function GrantOutcome({ editor }: { editor: GrantState }) {
  const { grantee, isOwner, problem, statements } = editor
  if (problem) return <Notice tone="warning" title={problem} />
  if (statements.length)
    return <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
  if (isOwner) return null
  return (
    <p class="drawer-note">
      {grantee ? 'Nothing changes yet: the ACL already says this.' : 'Choose a role.'}
    </p>
  )
}
