import type { RoleInfo } from '@platform/data'
import { Checkbox } from '../../ui/form.tsx'
import { Button } from '../../ui/button.tsx'
import { PlusIcon } from '../../ui/icons.tsx'
import { RoleInput } from '../roles/input.tsx'
import { isSystemRole } from '../names.ts'

/**
 * The roles a policy applies to: those the reader may see, and any other by name. A policy
 * with no role chosen applies to everyone.
 */
export function PolicyRoles({
  offered,
  chosen,
  other,
  setOther,
  onToggle,
  onAdd,
}: {
  /** The roles that may be chosen. */
  offered: string[]
  /** The roles the policy applies to. */
  chosen: string[]
  other: string
  setOther: (name: string) => void
  onToggle: (name: string, on: boolean) => void
  onAdd: () => void
}) {
  return (
    <fieldset class="field field-wide">
      <legend class="field-label">Applies to</legend>
      <p class="field-hint">
        {chosen.length
          ? 'The roles named, and every role that inherits from them.'
          : 'No role chosen: the policy applies to everyone (PUBLIC).'}
      </p>
      <div class="checks checks-columns">
        {offered.map((name) => (
          <Checkbox
            key={name}
            label={<span class="mono">{name}</span>}
            checked={chosen.includes(name)}
            onChange={(on) => onToggle(name, on)}
          />
        ))}
      </div>
      <div class="input-row">
        <RoleInput
          id="pol-role"
          value={other}
          roles={[]}
          placeholder="A role you cannot see, by name"
          onChange={setOther}
        />
        <Button
          icon={<PlusIcon size={16} />}
          disabled={!other.trim() || chosen.includes(other.trim())}
          onClick={onAdd}
        >
          Add
        </Button>
      </div>
    </fieldset>
  )
}

/** The roles offered to a policy: those the reader may see, and those it already names. */
export function offeredRoles(roles: RoleInfo[], chosen: string[]): string[] {
  return [
    ...roles.filter((r) => !isSystemRole(r.name)).map((r) => r.name),
    ...chosen.filter((name) => !roles.some((r) => r.name === name)),
  ]
}
