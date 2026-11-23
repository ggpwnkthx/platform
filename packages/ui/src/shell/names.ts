import { presentationOf } from '@platform/core'
import { useSession } from '../session/context.ts'
/** A name people read: the item's own display name, or the name PostgreSQL holds. */
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
