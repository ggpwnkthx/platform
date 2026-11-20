import clsx from 'clsx'
import type { ColumnInfo, Hold, RoleInfo, TableInfo } from '@platform/data'
import { href } from '../url.ts'
import { EveryoneIcon, GroupIcon, KeyIcon, UserIcon } from '../ui/icons.tsx'
import { everyone } from './model.ts'

/** The privileges a reader holds on a collection, in the database's own names. */
const privileges = [
  { key: 'can_select', name: 'SELECT' },
  { key: 'can_insert', name: 'INSERT' },
  { key: 'can_update', name: 'UPDATE' },
  { key: 'can_delete', name: 'DELETE' },
] as const

export type { Hold }

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
export function Legend({ of = 'collection' }: { of?: 'collection' | 'field' | 'workspace' }) {
  if (of !== 'collection')
    return (
      <p class="legend">
        <span>
          <Mark hold="all" label="" /> held
        </span>
        <span>
          <Mark hold="none" label="" /> not held
        </span>
      </p>
    )
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
 * A role's name, drawn the same way wherever access is read: a person, a group or everyone,
 * in the database's own letters. It leads to the role's page when the reader may see the
 * role; a role the database only names in an ACL is a name and nothing more.
 */
export function RoleLabel({
  name,
  roles,
  plain,
}: {
  name: string
  /** The roles the reader may see. */
  roles: RoleInfo[]
  /** A name only: no link, where the row itself is the way in. */
  plain?: boolean
}) {
  const known = roles.find((role) => role.name === name)
  const Icon =
    name === everyone ? EveryoneIcon : known ? (known.login ? UserIcon : GroupIcon) : KeyIcon
  const kind =
    name === everyone
      ? 'Everyone'
      : known
        ? known.login
          ? 'User'
          : 'Group'
        : 'A role you may not see'
  const body = (
    <>
      <Icon size={16} aria-hidden="true" />
      <span class="mono">{name}</span>
    </>
  )
  if (!known || plain)
    return (
      <span class="role-label" title={kind}>
        {body}
      </span>
    )
  return (
    <a class="role-label" href={href('/access/role', { r: name })} title={kind}>
      {body}
    </a>
  )
}

/**
 * What the reader may do with a collection, as the database's privilege functions answered.
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
