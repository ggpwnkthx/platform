import type { RoleInfo } from '@platform/data'
import { useLast, useOpening } from '../hooks.ts'
import { PolicyEditor, type PolicyTarget } from './editor.tsx'

export type { PolicyTarget }

/** The row policy of one collection: written, or changed, in a drawer of its own. */
export function PolicyDrawer({
  schema,
  target,
  roles,
  onClose,
  onDone,
}: {
  schema: string
  /** Null while the drawer is closed. */
  target: PolicyTarget | null
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(target !== null)
  const last = useLast(target)
  return (
    <PolicyEditor
      key={opening}
      open={target !== null}
      schema={schema}
      target={last ?? { table: '' }}
      roles={roles}
      onClose={onClose}
      onDone={onDone}
    />
  )
}
