import {
  ActionIcon,
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Drawer,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { describe, type Hold } from '@platform/core'
import { Database, Globe, Table2, User, Users, X } from 'lucide-react'
import { DynamicIcon, type IconName, iconNames } from 'lucide-react/dynamic'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useSession } from './session.tsx'

// ------------------------------------------------------------------------------- palette

/** The pinned palette: every family's bright step, and the dark one that carries text. */
export const palette: Record<string, [fill: string, ink: string]> = {
  mint: ['#65c081', '#366745'],
  steel: ['#5379a3', '#2f445c'],
  cyan: ['#43c1d8', '#2a7785'],
  teal: ['#60c5bc', '#346c67'],
  pink: ['#ed2c8f', '#861b51'],
  purple: ['#aa519f', '#66305f'],
  violet: ['#8553a2', '#5a3a6d'],
  indigo: ['#5e54a3', '#3b3567'],
  olive: ['#bebf4f', '#6f6f2e'],
  bronze: ['#be964e', '#574422'],
  clay: ['#bf704e', '#804a33'],
  // The studio's own five come last: they already mean action, information and status.
  orange: ['#f15a2b', '#ad401e'],
  blue: ['#449fd8', '#3379a5'],
  green: ['#6cbe4f', '#3e702d'],
  amber: ['#f1ad29', '#7f5c24'],
  red: ['#ee2a3d', '#ab1d2b'],
}
const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
/** The family a colour belongs to: its name, or the nearest to a colour written as #rrggbb. */
export function familyOf(colour: unknown): string | null {
  if (typeof colour !== 'string') return null
  const text = colour.trim().toLowerCase()
  if (text in palette) return text
  if (!/^#[0-9a-f]{6}$/.test(text)) return null
  const distance = (family: string) =>
    rgb(palette[family]![0]).reduce((sum, part, at) => sum + (part - rgb(text)[at]!) ** 2, 0)
  return Object.keys(palette).sort((a, b) => distance(a) - distance(b))[0]!
}
/** The fill of a family and the ink that reads on it: the palette's black or its white. */
export function tone(colour: unknown): { fill: string; ink: string; text: string } | null {
  const family = familyOf(colour)
  if (!family) return null
  const [fill, text] = palette[family]!
  const [r, g, b] = rgb(fill)
  return { fill, text, ink: 0.299 * r! + 0.587 * g! + 0.114 * b! > 140 ? '#141414' : '#ffffff' }
}

// --------------------------------------------------------------------------------- marks

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

// --------------------------------------------------------------------------------- pages

export function Page(props: {
  title: ReactNode
  crumbs?: ReactNode[]
  mark?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <header className="page-head">
        {props.mark}
        <div style={{ flex: 1, minWidth: 0 }}>
          {props.crumbs && (
            <Breadcrumbs fz="xs" c="dimmed" fw={600}>
              {props.crumbs}
            </Breadcrumbs>
          )}
          <Title order={1} fz={22} lts="-0.02em" lineClamp={1}>
            {props.title}
          </Title>
        </div>
        <Group gap="xs">{props.actions}</Group>
      </header>
      <div className={props.aside ? 'page-split' : undefined}>
        <main className="page-body">{props.children}</main>
        {props.aside && <aside className="page-aside">{props.aside}</aside>}
      </div>
    </>
  )
}
/** A page section: a heading, a short description and a hairline above it; never a box. */
export function Section(props: {
  title: ReactNode
  note?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section">
      <Group justify="space-between" mb="sm" align="start">
        <div>
          <Title order={2} fz={16}>
            {props.title}
          </Title>
          {props.note && (
            <Text fz="sm" c="dimmed" maw="72ch">
              {props.note}
            </Text>
          )}
        </div>
        <Group gap="xs">{props.actions}</Group>
      </Group>
      {props.children}
    </section>
  )
}
export const Empty = ({ children }: { children: ReactNode }) => (
  <Text c="dimmed" fz="sm" py="md">
    {children}
  </Text>
)
/** A refusal, with PostgreSQL's own words and its SQLSTATE. */
export function Problem({ error }: { error: unknown }) {
  if (!error) return null
  const said = describe(error)
  return (
    <Alert color="red" title={said.title} my="sm">
      {said.detail}
    </Alert>
  )
}
export const Tag = ({ children, color = 'gray' }: { children: ReactNode; color?: string }) => (
  <Badge variant="light" color={color} radius="xl" tt="none" fw={600}>
    {children}
  </Badge>
)
export const Remove = (props: { onClick: () => void; label: string }) => (
  <ActionIcon
    variant="subtle"
    color="red"
    aria-label={props.label}
    title={props.label}
    onClick={props.onClick}
  >
    <X size={16} />
  </ActionIcon>
)

// ---------------------------------------------------------------------------- statements

export function Statements({ sql }: { sql: string[] }) {
  if (!sql.length) return null
  return (
    <figure className="statement" style={{ margin: 0 }}>
      <figcaption>Runs as you, in one transaction</figcaption>
      <pre>{sql.join('\n')}</pre>
    </figure>
  )
}
/**
 * Every change to the model or to access goes through here: the form, the SQL it writes —
 * shown before the button that runs it — and PostgreSQL's answer. Nothing runs unseen.
 */
export function Change(props: {
  title: string
  opened: boolean
  onClose: () => void
  /** The statements the form asks for; throwing says why there are none yet. */
  statements: () => string[]
  label?: string
  danger?: boolean
  /** Withholds the button until the form is ready, e.g. a name typed to confirm. */
  ready?: boolean
  done?: () => void
  children?: ReactNode
}) {
  const { run } = useSession()
  const [error, setError] = useState<unknown>(null)
  const [running, setRunning] = useState(false)
  const change = useMemo(() => {
    try {
      return { sql: props.statements(), problem: null }
    } catch (problem) {
      return { sql: [], problem: problem instanceof Error ? problem.message : String(problem) }
    }
  }, [props.statements])
  const close = () => {
    setError(null)
    props.onClose()
  }
  const submit = async () => {
    setRunning(true)
    setError(null)
    try {
      await run(change.sql)
      notifications.show({
        color: 'green',
        title: props.title,
        message: `${change.sql.length} statement${change.sql.length === 1 ? '' : 's'} ran as you.`,
      })
      close()
      props.done?.()
    } catch (refused) {
      setError(refused)
    } finally {
      setRunning(false)
    }
  }
  return (
    <Drawer
      opened={props.opened}
      onClose={close}
      title={
        <Text fw={650} fz={19}>
          {props.title}
        </Text>
      }
      position="right"
      size={560}
    >
      <Stack>
        {props.children}
        {change.problem && (
          <Text fz="sm" c="dimmed">
            {change.problem}
          </Text>
        )}
        <Statements sql={change.sql} />
        <Problem error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button
            color={props.danger ? 'red' : undefined}
            loading={running}
            disabled={!change.sql.length || props.ready === false}
            onClick={submit}
          >
            {props.label ?? 'Run'}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  )
}
