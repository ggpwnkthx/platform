import clsx from 'clsx'
import type { ColumnInfo, TableInfo } from '@platform/data'

/** The privileges a reader holds on a collection, in PostgreSQL's own names. */
const privileges = [
  { key: 'can_select', name: 'SELECT' },
  { key: 'can_insert', name: 'INSERT' },
  { key: 'can_update', name: 'UPDATE' },
  { key: 'can_delete', name: 'DELETE' },
] as const

export type Hold = 'all' | 'some' | 'none'

/** One privilege, drawn the same way everywhere: a full, half or empty mark. */
export function Mark({ hold, label }: { hold: Hold; label: string }) {
  return (
    <span class={clsx('perm', `perm-${hold}`)} title={label || undefined}>
      <span class="perm-mark" aria-hidden="true" />
    </span>
  )
}

const words: Record<Hold, string> = {
  all: 'on the whole collection',
  some: 'on some fields',
  none: 'not held',
}

/** The key to the marks, shown wherever they are. */
export function Legend() {
  return (
    <p class="legend">
      <span>
        <Mark hold="all" label="" /> whole collection
      </span>
      <span>
        <Mark hold="some" label="" /> some fields
      </span>
      <span>
        <Mark hold="none" label="" /> not held
      </span>
    </p>
  )
}

/**
 * What the reader may do with a collection, as PostgreSQL's privilege functions answered.
 * A half mark means the privilege is held on some of its columns rather than the table.
 */
export function Rights({
  table,
  columns,
  compact,
}: {
  table: TableInfo
  columns?: ColumnInfo[]
  compact?: boolean
}) {
  const holdOf = (key: (typeof privileges)[number]['key']): Hold => {
    if (table[key]) return 'all'
    if (key !== 'can_delete' && columns?.some((c) => c[key])) return 'some'
    return 'none'
  }
  return (
    <ul class={clsx('rights', compact && 'rights-compact')} aria-label="Your privileges">
      {privileges.map((p) => {
        const hold = holdOf(p.key)
        return (
          <li key={p.key} class={clsx('right', `right-${hold}`)}>
            <Mark hold={hold} label={`${p.name}: ${words[hold]}`} />
            <span class="right-name">{p.name}</span>
            <span class="sr-only">{words[hold]}</span>
          </li>
        )
      })}
      {table.can_alter && (
        <li
          class="right right-owner"
          title="You own this collection: its model and access are yours"
        >
          owner
        </li>
      )}
    </ul>
  )
}
