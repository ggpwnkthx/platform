import type { RoleInfo } from '@platform/data'
import { Button } from '../../ui/button.tsx'
import { Field } from '../../ui/form.tsx'
import { PlusIcon } from '../../ui/icons.tsx'
import { named } from '../names.ts'
import { RoleInput } from '../roles/input.tsx'

/** Another role is given this field: one with nothing on the collection yet. */
export function FieldAccessRole({
  grantees,
  owner,
  roles,
  adding,
  setAdding,
  onAdd,
}: {
  grantees: string[]
  /** The owner of the collection: it is not offered as another role. */
  owner: string | undefined
  roles: RoleInfo[]
  adding: string
  setAdding: (name: string) => void
  onAdd: () => void
}) {
  return (
    <div class="form">
      <Field
        label="Another role"
        id="field-role"
        wide
        hint="A role with nothing on this collection yet. PUBLIC is everyone."
      >
        <div class="input-row">
          <RoleInput
            id="field-role"
            value={adding}
            roles={roles}
            without={[...grantees, owner ?? '']}
            withEveryone
            onChange={setAdding}
          />
          <Button icon={<PlusIcon size={16} />} disabled={!named(adding)} onClick={onAdd}>
            Add
          </Button>
        </div>
      </Field>
    </div>
  )
}
