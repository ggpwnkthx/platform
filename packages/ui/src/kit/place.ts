import { presentationOf } from '@platform/core'
import { useLocation } from 'react-router-dom'
import { useSession } from '../session/session.ts'
let lastWorkspace = ''
/**
 * The workspace in view. A workspace is the unit of ownership and of permission, so the
 * interface reads in one at a time, and the address says which: a collection is
 * `workspace.collection`, and a workspace's own pages carry its name.
 */
export function useWorkspace() {
  const { catalog } = useSession()
  const [, first = '', second = ''] = useLocation().pathname.split('/')
  const said = ['w', 'activity'].includes(first)
    ? second
    : first.includes('.')
      ? first.split('.')[0]!
      : ''
  const found =
    catalog.schemas.find((s) => s.name === decodeURIComponent(said)) ??
    catalog.schemas.find((s) => s.name === lastWorkspace) ??
    catalog.schemas.find((s) => s.kind === 'user') ??
    catalog.schemas[0]
  if (found) lastWorkspace = found.name
  return found
}
/** The name people read for a workspace or a collection, and the mark it carries. */
export function useNames() {
  const { presentations } = useSession()
  return (schema: string, table?: string) => {
    const said = presentationOf(presentations, schema, table)
    return {
      ...said,
      name: said.displayName ?? (schema === 'platform' && !table ? 'Platform' : (table ?? schema)),
    }
  }
}
