import type { GrantInfo, MembershipInfo, RoleInfo } from '@platform/data'
import { Notice } from '../../ui/bits.tsx'
import { Drawer } from '../../ui/overlay.tsx'
import { GrantFooter } from './footer.tsx'
import { GrantOutcome } from './outcome.tsx'
import { GrantPrivileges } from './privileges.tsx'
import { useGrantEditor } from './state.ts'
import { GrantTargetForm, type GrantTarget } from './target.tsx'
import { useLast, useOpening } from '../hooks.ts'
import { RunnerProblem, useRunner } from '../runner.tsx'

/**
 * What one role holds on one collection, and the statements that change it. Each privilege
 * is not held, held on the whole collection, or held on chosen fields; the statements are
 * the difference between what the ACL records and what is asked for, and they run as the
 * reader, in one transaction.
 */
export function GrantDrawer({
  schema,
  target,
  grants,
  roles,
  memberships,
  onClose,
  onDone,
}: {
  schema: string
  /** Null while the drawer is closed. */
  target: GrantTarget | null
  /** The workspace's grants, as its ACLs record them. */
  grants: GrantInfo[]
  roles: RoleInfo[]
  memberships: MembershipInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(target !== null)
  const last = useLast(target)
  return (
    <GrantEditor
      key={opening}
      calls={{ onClose, onDone }}
      grant={{
        open: target !== null,
        schema,
        target: last ?? {},
        grants,
        roles,
        memberships,
      }}
    />
  )
}

function GrantEditor({
  calls,
  grant,
}: {
  /** What the reader is told when the grants are done, or when the drawer is closed. */
  calls: { onClose: () => void; onDone: () => void }
  /** The grant itself: the role, the collection, and what the ACL holds. */
  grant: {
    open: boolean
    schema: string
    target: GrantTarget
    grants: GrantInfo[]
    roles: RoleInfo[]
    memberships: MembershipInfo[]
  }
}) {
  const { open, schema, target, grants, roles, memberships } = grant
  const { onClose, onDone } = calls
  const runner = useRunner()
  const editor = useGrantEditor({ open, schema, target, grants, memberships })
  const {
    grantee,
    grantsSomething,
    isOwner,
    owned,
    problem,
    setEdits,
    setTable,
    setTyped,
    statements,
    table,
    typed,
  } = editor
  const fixedTable = Boolean(target.table)
  const fixedGrantee = Boolean(target.grantee)
  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={
        <>
          {grantee ? <span class="mono">{grantee}</span> : 'A role'} on{' '}
          <span class="mono">{table || 'a collection'}</span>
        </>
      }
      subtitle="What the role holds on this collection itself. The database lets the collection’s owner change it."
      footer={
        <GrantFooter
          statements={statements}
          problem={problem}
          grantee={grantee}
          revoking={Boolean(statements.length && !grantsSomething)}
          runner={runner}
          onDone={onDone}
          onClose={onClose}
        />
      }
    >
      <RunnerProblem runner={runner} />
      {(!fixedGrantee || !fixedTable) && (
        <GrantTargetForm
          fixedGrantee={fixedGrantee}
          fixedTable={fixedTable}
          owned={owned}
          roles={roles}
          setEdits={setEdits}
          setTable={setTable}
          setTyped={setTyped}
          table={table}
          typed={typed}
        />
      )}
      {isOwner ? (
        <Notice tone="info" title={`${grantee} owns ${table}`}>
          An owner holds every privilege on what it owns, and its row policies do not filter it.
          There is nothing to grant.
        </Notice>
      ) : (
        <GrantPrivileges editor={editor} />
      )}
      <GrantOutcome editor={editor} />
    </Drawer>
  )
}
