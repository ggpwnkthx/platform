import { ActionIcon, Alert, Badge, Breadcrumbs, Group, Text, Title } from '@mantine/core'
import { describe } from '@platform/core'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

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

/** The SQL a change runs, shown before the button that runs it. */
export function Statements({ sql }: { sql: string[] }) {
  if (!sql.length) return null
  return (
    <figure className="statement" style={{ margin: 0 }}>
      <figcaption>Runs as you, in one transaction</figcaption>
      <pre>{sql.join('\n')}</pre>
    </figure>
  )
}
