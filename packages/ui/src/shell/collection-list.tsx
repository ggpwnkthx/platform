import clsx from 'clsx'
import { useLocation } from 'preact-iso'
import { presentationOf, tablesIn } from '@platform/data'
import { useSession } from '../session.tsx'
import { href } from '../url.ts'
import { CollectionIcon, iconFor } from '../ui/icons.tsx'
import { useWorkspace } from '../workspace/view.ts'

export function CollectionList({ base }: { base: string }) {
  const { catalog, presentations } = useSession()
  const { query } = useLocation()
  const ws = useWorkspace()
  const tables = tablesIn(catalog, ws)
  return (
    <ul class="nav-list">
      {tables.map((t) => {
        const item = presentationOf(presentations, ws, t.name)
        const Icon = iconFor(item.icon) ?? CollectionIcon
        return (
          <li key={t.name}>
            <a
              href={href(base, { ws, c: t.name })}
              class={clsx('nav-item', query.c === t.name && 'is-active')}
              aria-current={query.c === t.name ? 'page' : undefined}
              title={item.displayName ? t.name : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span class="nav-text">{item.displayName ?? t.name}</span>
              {t.kind === 'v' && <small class="nav-tag">view</small>}
            </a>
          </li>
        )
      })}
      {!tables.length && ws && <li class="nav-note">No collection here that you may reach.</li>}
    </ul>
  )
}
