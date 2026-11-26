import { presentationOf } from '@platform/core'
import { useLocation } from 'react-router-dom'
import { useSession } from '../session/session.ts'
let lastSchema = ''
/**
 * The schema in view. A schema is the unit of ownership and of permission, so the
 * interface reads in one at a time, and the address says which: a table is
 * `schema.table`, and a schema's own pages carry its name.
 */
export function useSchema() {
  const { catalog } = useSession()
  const [, first = '', second = ''] = useLocation().pathname.split('/')
  const said = ['w', 'activity'].includes(first)
    ? second
    : first.includes('.')
      ? first.split('.')[0]!
      : ''
  const found =
    catalog.schemas.find((s) => s.name === decodeURIComponent(said)) ??
    catalog.schemas.find((s) => s.name === lastSchema) ??
    catalog.schemas.find((s) => s.kind === 'user') ??
    catalog.schemas[0]
  if (found) lastSchema = found.name
  return found
}
/** The name people read for a schema or a table, and the mark it carries. */
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
