import { useState } from 'preact/hooks'
import type { RoleInfo } from '@platform/data'
import { createRoleStatements, membershipStatement } from '@platform/vocabulary'
import { Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Checkbox, Field, Input, Toggle } from '../../ui/form.tsx'
import { Drawer } from '../../ui/overlay.tsx'
import { changeOf } from '../grants/change.ts'
import { isSystemRole } from '../names.ts'
import { RunnerProblem, useRunner } from '../runner.tsx'

/** The form a new role is made with, and the groups it joins as it is made. */
export function NewRole({
  open,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  roles: RoleInfo[]
  onClose: () => void
  onDone: (name: string) => void
}) {
  const runner = useRunner()
  const [draft, setDraft] = useState({ name: '', login: true })
  const [groups, setGroups] = useState<string[]>([])
  // The groups the reader may admit a new role to.
  const joinable = roles.filter(
    (r) => !r.login && r.admits && !isSystemRole(r.name) && !r.name.startsWith('platform_')
  )
  const change = changeOf(() =>
    draft.name.trim()
      ? [
          ...createRoleStatements(draft),
          ...groups.map((group) =>
            membershipStatement({ role: group, member: draft.name.trim(), admin: false })
          ),
        ]
      : []
  )
  const statements = change.statements
  const invalid = change.problem
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New role"
      subtitle="A user is a role that logs in; a group is one that others belong to."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={runner.busy}
            disabled={!statements.length || !!invalid}
            onClick={async () => {
              if (await runner.runStatements(statements, `Created ${draft.name.trim()}`))
                onDone(draft.name.trim())
            }}
          >
            Create role
          </Button>
        </>
      }
    >
      <RunnerProblem runner={runner} />
      <div class="form">
        <div class="field field-wide">
          <Toggle
            checked={draft.login}
            onChange={(login) => setDraft({ ...draft, login })}
            label={draft.login ? 'A user: logs in with a token' : 'A group: does not log in'}
          />
        </div>
        <Field
          label="Name"
          id="role-name"
          wide
          required
          error={invalid}
          hint={
            draft.login
              ? 'For a person: the email their sign-in reports. The database logs them in by it.'
              : 'For a group: what its members do, such as newsroom_editor.'
          }
        >
          <Input
            id="role-name"
            mono
            value={draft.name}
            onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            placeholder={draft.login ? 'carol@example.com' : 'newsroom_editor'}
          />
        </Field>
        {joinable.length > 0 && (
          <fieldset class="field field-wide">
            <legend class="field-label">Member of</legend>
            <p class="field-hint">
              The groups it joins as it is made. A role holds nothing of its own until it is
              granted: its groups are where its rights come from.
            </p>
            <div class="checks checks-columns">
              {joinable.map((group) => (
                <Checkbox
                  key={group.name}
                  label={<span class="mono">{group.name}</span>}
                  checked={groups.includes(group.name)}
                  onChange={(on) =>
                    setGroups(on ? [...groups, group.name] : groups.filter((g) => g !== group.name))
                  }
                />
              ))}
            </div>
          </fieldset>
        )}
      </div>
      {statements.length > 0 && (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      )}
    </Drawer>
  )
}
