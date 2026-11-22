import type { GrantInfo, RoleInfo } from '@platform/data'
import { FieldAccessEditor } from './editor.tsx'
import { useLast, useOpening } from '../hooks.ts'

/**
 * Who holds what on one field, and the statements that change it. A privilege held on the
 * whole collection covers the field with it; taking the field out limits the privilege to
 * the other fields, by name.
 */
export function FieldAccessDrawer({
  schema,
  table,
  column,
  grants,
  roles,
  onClose,
  onDone,
}: {
  schema: string
  table: string
  /** Null while the drawer is closed. */
  column: string | null
  grants: GrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(column !== null)
  const last = useLast(column)
  return (
    <FieldAccessEditor
      key={opening}
      open={column !== null}
      schema={schema}
      table={table}
      column={last ?? ''}
      grants={grants}
      roles={roles}
      onClose={onClose}
      onDone={onDone}
    />
  )
}
