import { useState } from 'preact/hooks'
import type { RoleInfo } from '@platform/data'
import { membershipStatement } from '@platform/vocabulary'
import { Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Checkbox, Field, Select } from '../../ui/form.tsx'
import { Drawer } from '../../ui/overlay.tsx'
import { useLast, useOpening } from '../hooks.ts'
import { RunnerProblem, useRunner } from '../runner.tsx'

/** Adds a membership: a member to this group, or this role to a group. */
export function MembershipDrawer({
  adding,
  name,
  candidates,
  onClose,
  onDone,
}: {
  adding: 'member' | 'group' | null
  name: string
  candidates: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(adding !== null)
  const last = useLast(adding)
  return (
    <MembershipEditor
      key={opening}
      open={adding !== null}
      adding={last ?? 'group'}
      name={name}
      candidates={candidates}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function MembershipEditor({
  open,
  adding,
  name,
  candidates,
  onClose,
  onDone,
}: {
  open: boolean
  adding: 'member' | 'group'
  name: string
  candidates: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const runner = useRunner()
  const [other, setOther] = useState('')
  const [admin, setAdmin] = useState(false)
  let statement = ''
  try {
    statement = other
      ? membershipStatement(
          adding === 'member'
            ? { role: name, member: other, admin }
            : { role: other, member: name, admin }
        )
      : ''
  } catch {
    statement = ''
  }
  const offered = candidates.filter((r) => (adding === 'group' ? !r.login && r.admits : true))
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        adding === 'member' ? (
          <>
            Add a member to <span class="mono">{name}</span>
          </>
        ) : (
          <>
            Add <span class="mono">{name}</span> to a group
          </>
        )
      }
      subtitle={
        adding === 'member'
          ? 'The member holds everything granted to this group, in every workspace.'
          : 'It will hold everything granted to the group, in every workspace.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={runner.busy}
            disabled={!statement}
            onClick={async () => {
              if (await runner.runStatements([statement], 'Membership granted')) {
                onDone()
                onClose()
              }
            }}
          >
            Grant membership
          </Button>
        </>
      }
    >
      <RunnerProblem runner={runner} />
      <div class="form">
        <Field
          label={adding === 'member' ? 'Member' : 'Group'}
          id="mem-other"
          wide
          required
          hint={
            adding === 'group' && !offered.length
              ? 'There is no group you may admit members to.'
              : undefined
          }
        >
          <Select id="mem-other" value={other} onChange={(e) => setOther(e.currentTarget.value)}>
            <option value="">Choose a role</option>
            {offered.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
                {adding === 'member' && !r.login ? ' (group)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div class="field field-wide">
          <Checkbox
            checked={admin}
            onChange={setAdmin}
            label="With admin option"
            hint="They may admit others in turn, and remove them."
          />
        </div>
      </div>
      {statement && <Statement sql={statement} />}
    </Drawer>
  )
}
