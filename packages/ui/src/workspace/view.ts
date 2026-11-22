import { useEffect } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { presentationOf, userSchemas } from '@platform/data'
import { useSession } from '../session.tsx'

/**
 * The workspace in view: the address names it, else the last one chosen, else the first of
 * the installation's own. The platform's own is a workspace too, but nobody lands in it:
 * it is in view when it is asked for.
 */
export function useWorkspace(): string {
  const { query } = useLocation()
  const { catalog, lastWorkspace, rememberWorkspace } = useSession()
  const named = query.ws
  const known = (name: string | null | undefined) =>
    Boolean(name && catalog.schemas.some((s) => s.name === name))
  const ws =
    named ?? (known(lastWorkspace) ? lastWorkspace! : (userSchemas(catalog)[0]?.name ?? ''))
  useEffect(() => {
    if (named && named !== lastWorkspace) rememberWorkspace(named)
  }, [named])
  return ws
}

/**
 * The workspace in view, with what the database says about it and how it presents itself:
 * the three things every page about a workspace reads, read in one place.
 */
export function useWorkspaceView() {
  const { catalog, presentations } = useSession()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  return { ws, schema, shown, catalog }
}
