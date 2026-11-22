import clsx from 'clsx'
import { href } from '../../url.ts'
import { ChevronRightIcon } from '../../ui/icons.tsx'

/** The tabs of a collection: its fields, its note, and who reaches it. */
export function CollectionTabs({
  ws,
  table,
  tab,
}: {
  ws: string
  table: string
  /** The tab in view. */
  tab: string
}) {
  const tabLink = (id: string, label: string) => (
    <a
      href={href('/model/collection', { ws, c: table, tab: id === 'fields' ? undefined : id })}
      class={clsx('tab', tab === id && 'is-active')}
      aria-current={tab === id ? 'page' : undefined}
    >
      {label}
    </a>
  )
  return (
    <nav class="tabs" aria-label="Collection settings">
      {tabLink('fields', 'Fields')}
      {tabLink('about', 'About')}
      {tabLink('access', 'Access')}
      <a href={href('/content/records', { ws, c: table })} class="tab tab-end">
        Open records <ChevronRightIcon size={16} aria-hidden="true" />
      </a>
    </nav>
  )
}
