import { useLocation } from 'preact-iso'
import { systemWorkspaceName } from '@platform/data'
import { useSession } from '../session.tsx'
import { href, type Place } from '../url.ts'
import { ChevronDownIcon } from '../ui/icons.tsx'
import { useWorkspace } from '../workspace/view.ts'

/** Chooses the workspace a page reads, for pages whose navigation pane has no switcher. */
export function WorkspaceSelect({ path, place = {} }: { path: string; place?: Place }) {
  const { catalog } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  return (
    <label class="inline-select">
      <span>Workspace</span>
      <span class="select">
        <select
          value={ws}
          onChange={(e) => location.route(href(path, { ...place, ws: e.currentTarget.value }))}
        >
          {catalog.schemas.map((s) => (
            <option key={s.name} value={s.name}>
              {s.kind === 'system' ? `${systemWorkspaceName} (${s.name})` : s.name}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={16} aria-hidden="true" />
      </span>
    </label>
  )
}
