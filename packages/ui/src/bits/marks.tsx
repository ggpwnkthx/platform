import { Group, ThemeIcon } from '@mantine/core'
import { Database, Globe, Table2, User, Users } from 'lucide-react'
import { DynamicIcon, type IconName, iconNames } from 'lucide-react/dynamic'
import { Link } from 'react-router'
import type { Hold } from '@platform/core'
import { tone } from './palette.ts'

/** The icons offered for an item's mark; any name the icon set holds is drawn. */
export const itemIcons =
  'newspaper globe building-2 briefcase folder database boxes book-open graduation-cap landmark factory store file-text camera film audio-lines clipboard-list list-todo calendar-days mail message-square bell users tags star shopping-bag package truck wallet receipt chart-column map-pin pencil-ruler megaphone rss lightbulb wrench puzzle heart-pulse scale'.split(
    ' '
  )
export const isIcon = (name: unknown): name is IconName =>
  typeof name === 'string' && (iconNames as string[]).includes(name)
export function ItemIcon({
  name,
  size = 16,
  table,
}: {
  name?: string | null
  size?: number
  table?: boolean
}) {
  if (isIcon(name)) return <DynamicIcon name={name} size={size} />
  return table ? <Table2 size={size} /> : <Database size={size} />
}
/** An item's mark: its icon on its colour, and nowhere else. */
export function ItemMark(props: {
  icon?: string | null
  color?: string | null
  size?: number
  table?: boolean
}) {
  const drawn = tone(props.color)
  const size = props.size ?? 34
  return (
    <ThemeIcon
      size={size}
      radius="sm"
      color={drawn?.fill ?? 'var(--bg-subdued)'}
      c={drawn?.ink ?? '#383838'}
    >
      <ItemIcon name={props.icon} size={size / 2} table={props.table} />
    </ThemeIcon>
  )
}

/** A privilege, drawn the same way everywhere: PostgreSQL's own name and one mark. */
export function Privilege({
  name,
  held,
  count,
}: {
  name: string
  held: Hold | boolean
  count?: string
}) {
  const hold = held === true ? 'all' : held === false ? 'none' : held
  return (
    <span
      className={`privilege ${hold}`}
      title={
        { all: 'Held on the whole collection', some: 'Held on some fields', none: 'Not held' }[hold]
      }
    >
      <i />
      {name}
      {count && hold === 'some' ? ` ${count}` : ''}
    </span>
  )
}
export const PrivilegeLegend = () => (
  <Group gap="md">
    <Privilege name="whole collection" held="all" />
    <Privilege name="some fields" held="some" />
    <Privilege name="not held" held="none" />
  </Group>
)
/** A role, drawn the same wherever access is read: a person, a group or everyone, and its name. */
export function RoleName({ name, group, link }: { name: string; group?: boolean; link?: string }) {
  const Icon = name.toLowerCase() === 'public' ? Globe : group ? Users : User
  const shown = (
    <Group gap={6} wrap="nowrap" className="mono">
      <Icon size={14} />
      {name}
    </Group>
  )
  return link ? (
    <Link to={link} style={{ color: 'inherit', textDecoration: 'none' }}>
      {shown}
    </Link>
  ) : (
    shown
  )
}
