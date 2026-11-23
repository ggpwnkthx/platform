import { Autocomplete, Checkbox } from '@mantine/core'
import { membershipStatement } from '@platform/core'
import { useState } from 'react'
import { Change } from '../bits/change.tsx'
import { useRoles } from './shared.tsx'

/** Adding a role to a group, or a member to a group. */
export function AddMembership({
  name,
  side,
  onClose,
}: {
  name: string
  side: 'role' | 'member'
  onClose(): void
}) {
  const found = useRoles()
  const [other, setOther] = useState('')
  const [admin, setAdmin] = useState(false)
  const all = found.data?.roles ?? []
  return (
    <Change
      title={side === 'role' ? `Add ${name} to a group` : `Add a member to ${name}`}
      opened
      onClose={onClose}
      statements={() => [
        membershipStatement(
          side === 'role'
            ? { role: other, member: name, admin }
            : { role: name, member: other, admin }
        ),
      ]}
    >
      <Autocomplete
        label={side === 'role' ? 'Group' : 'Member'}
        className="mono"
        value={other}
        onChange={setOther}
        data={all
          .filter(
            (r) =>
              (side === 'role' ? !r.login && r.admits : true) &&
              r.name !== name &&
              !r.name.startsWith('pg_')
          )
          .map((r) => r.name)}
      />
      <Checkbox
        label="WITH ADMIN OPTION: it may admit others"
        checked={admin}
        onChange={(e) => setAdmin(e.currentTarget.checked)}
      />
    </Change>
  )
}
