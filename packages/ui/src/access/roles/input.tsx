import { useId } from 'preact/hooks'
import type { RoleInfo } from '@platform/data'
import { Input } from '../../ui/form.tsx'
import { everyone } from '../model.ts'
import { isSystemRole } from '../names.ts'

/**
 * Chooses a role by its name. The roles the reader may see are offered, and any other may be
 * typed: the database shows a reader only the roles they belong to, and a collection's owner
 * may still grant to one they cannot see.
 */
export function RoleInput({
  id,
  value,
  onChange,
  roles,
  without = [],
  withEveryone,
  placeholder = 'A role’s name',
}: {
  id: string
  value: string
  onChange: (name: string) => void
  roles: RoleInfo[]
  /** Roles left out of what is offered: the ones already there. */
  without?: string[]
  /** Offer PUBLIC, which is everyone. */
  withEveryone?: boolean
  placeholder?: string
}) {
  const list = useId()
  const offered = roles.filter((role) => !isSystemRole(role.name) && !without.includes(role.name))
  return (
    <>
      <Input
        id={id}
        mono
        list={list}
        value={value}
        autocomplete="off"
        spellcheck={false}
        placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      <datalist id={list}>
        {withEveryone && !without.includes(everyone) && <option value={everyone}>everyone</option>}
        {offered.map((role) => (
          <option key={role.name} value={role.name}>
            {role.login ? 'user' : 'group'}
          </option>
        ))}
      </datalist>
    </>
  )
}
