import type { RoleInfo } from '@platform/data'
import type { Wanted } from '@platform/vocabulary'
import { Field, Select } from '../../ui/form.tsx'
import { RoleInput } from '../roles/input.tsx'

/** What the drawer is opened on: the collection, the role, or both; the rest is chosen in it. */
export interface GrantTarget {
  table?: string
  grantee?: string
}

/** The role and the collection the grants are made on: neither is fixed, unless it is. */
export function GrantTargetForm({
  fixedGrantee,
  fixedTable,
  owned,
  roles,
  setEdits,
  setTable,
  setTyped,
  table,
  typed,
}: {
  fixedGrantee: boolean
  fixedTable: boolean
  owned: { name: string }[]
  roles: RoleInfo[]
  setEdits: (edits: Record<string, Wanted>) => void
  setTable: (table: string) => void
  setTyped: (name: string) => void
  table: string
  typed: string
}) {
  return (
    <div class="form">
      {!fixedGrantee && (
        <Field
          label="Role"
          id="grant-role"
          required
          wide={fixedTable}
          hint="A group is granted once for all its members. PUBLIC is everyone."
        >
          <RoleInput
            id="grant-role"
            value={typed}
            roles={roles}
            withEveryone
            onChange={(name) => {
              setTyped(name)
              setEdits({})
            }}
          />
        </Field>
      )}
      {!fixedTable && (
        <Field label="Collection" id="grant-table" required wide={fixedGrantee}>
          <Select
            id="grant-table"
            value={table}
            onChange={(e) => {
              setTable(e.currentTarget.value)
              setEdits({})
            }}
          >
            {owned.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  )
}
