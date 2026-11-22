import {
  Alert,
  AppShell,
  Avatar,
  Burger,
  Button,
  Group,
  Loader,
  Menu,
  NavLink,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { presentationOf, tablesIn } from '@platform/core'
import {
  Boxes,
  Database,
  History,
  KeyRound,
  Library,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ItemIcon } from './bits.tsx'
import { useGate, usePlace, useSession } from './session.tsx'

const modules = [
  ['content', 'Content', Library],
  ['model', 'Data model', Boxes],
  ['access', 'Access', ShieldCheck],
  ['activity', 'Activity', History],
  ['sql', 'SQL', TerminalSquare],
] as const

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

/** The studio's frame: the module bar, the navigation pane with the workspace in view, the page. */
export function Shell({ children }: { children: ReactNode }) {
  const { identity, catalog, signOut } = useSession()
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [opened, nav] = useDisclosure(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pane closes when the address changes
  useEffect(nav.close, [pathname, search])
  const module = pathname.split('/')[1] === 'workspace' ? 'content' : pathname.split('/')[1]
  const collections = tablesIn(catalog, place.ws)
  const link = (path: string, label: ReactNode, icon: ReactNode, more?: Record<string, string>) => {
    const to = place.to(path, more)
    return (
      <NavLink
        key={to}
        component={Link}
        to={to}
        label={label}
        leftSection={icon}
        active={pathname === path && (!more?.c || more.c === place.c)}
      />
    )
  }
  return (
    <AppShell navbar={{ width: 328, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding={0}>
      <AppShell.Navbar>
        <div className="frame">
          <nav className="modules" aria-label="Modules">
            <div className="brand">
              <Database color="var(--orange)" />
            </div>
            {modules.map(([path, label, Icon]) => (
              <Link
                key={path}
                to={place.to(`/${path}`)}
                className={module === path ? 'active' : ''}
                title={label}
                aria-label={label}
              >
                <Icon size={20} />
              </Link>
            ))}
            <div style={{ flex: 1 }} />
            <Menu position="right-end">
              <Menu.Target>
                <UnstyledButton aria-label="Your account">
                  <Avatar size={36} color="orange" variant="filled">
                    {identity.username.slice(0, 2).toUpperCase()}
                  </Avatar>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label className="mono">{identity.username}</Menu.Label>
                <Menu.Label>
                  PostgreSQL {identity.server_version} · Platform {identity.platform_version}
                </Menu.Label>
                <Menu.Item component={Link} to={place.to('/access/role', { r: identity.username })}>
                  What you may do
                </Menu.Item>
                <Menu.Item onClick={() => signOut()}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </nav>
          <div className="pane">
            <Select
              aria-label="Workspace"
              mb="sm"
              allowDeselect={false}
              leftSection={<ItemIcon name={names(place.ws).icon} />}
              data={catalog.schemas.map((s) => ({ value: s.name, label: names(s.name).name }))}
              value={place.ws || null}
              placeholder="No workspace"
              onChange={(ws) => ws && navigate(`/${module}?ws=${encodeURIComponent(ws)}`)}
            />
            {module === 'access' && [
              link('/access', 'Roles', <Users size={16} />),
              link('/access/grants', 'Permissions', <KeyRound size={16} />),
              link('/access/policies', 'Row policies', <ScrollText size={16} />),
            ]}
            {(module === 'content' || module === 'model') && (
              <>
                <Text fz={12} fw={600} c="dimmed" px="xs" py={6}>
                  Collections
                </Text>
                {collections.map((t) =>
                  link(
                    module === 'model' ? '/model/collection' : '/content/records',
                    names(t.schema, t.name).name,
                    <ItemIcon name={names(t.schema, t.name).icon} table />,
                    { c: t.name }
                  )
                )}
                {!collections.length && (
                  <Text fz="sm" c="dimmed" px="xs">
                    No collection here that you may reach.
                  </Text>
                )}
                {place.schema?.can_create &&
                  link('/model/new', 'New collection', <Plus size={16} />)}
                <Text fz={12} fw={600} c="dimmed" px="xs" pt="md" pb={6}>
                  Workspace
                </Text>
                {place.ws && link('/workspace/settings', 'Settings', <Settings size={16} />)}
                {identity.can_create_workspace &&
                  link('/workspace/new', 'New workspace', <Plus size={16} />)}
              </>
            )}
          </div>
        </div>
      </AppShell.Navbar>
      <AppShell.Main>
        <Burger
          opened={opened}
          onClick={nav.toggle}
          hiddenFrom="sm"
          size="sm"
          m="xs"
          aria-label="Navigation"
        />
        {children}
      </AppShell.Main>
    </AppShell>
  )
}

const steps = [
  ['Your sign-in', 'The issuer vouches for who you are'],
  ['PostgreSQL', 'Checks the token and logs in your role'],
  ['Your role and rows', 'Every grant and policy applies, as in psql'],
]
/** Light like the rest: what happens when you sign in, and the way in. */
export function SignIn() {
  const { phase, notice, people, signIn, signInAs } = useGate()
  return (
    <div className="signin">
      <div className="art">
        <Stack maw={360} mx="auto" gap="xs">
          {steps.map(([title, note], at) => (
            <Paper
              key={title}
              withBorder
              p="md"
              radius="md"
              shadow="xs"
              style={at === 1 ? { borderColor: 'var(--orange)' } : undefined}
            >
              <Text fw={650} c={at === 1 ? 'orange.8' : undefined}>
                {title}
              </Text>
              <Text fz="sm" c="dimmed">
                {note}
              </Text>
            </Paper>
          ))}
        </Stack>
      </div>
      <div>
        <Stack maw={440} gap="md">
          <Title fz={28} lts="-0.025em">
            Sign in to Platform
          </Title>
          <Text c="dimmed">
            You are a PostgreSQL role. What you may do here is exactly what you may do in psql: the
            database decides, and the interface shows its answer.
          </Text>
          {notice && <Alert color={people.length ? 'blue' : 'red'}>{notice}</Alert>}
          {phase === 'signing-in' ? (
            <Group>
              <Loader size="sm" />
              <Text c="dimmed">
                {people.length ? 'Starting PostgreSQL in the page' : 'Signing in'}
              </Text>
            </Group>
          ) : people.length ? (
            people.map((person) => (
              <UnstyledButton key={person.role} onClick={() => signInAs(person.role)}>
                <Paper withBorder p="md" radius="md">
                  <Text className="mono">{person.role}</Text>
                  <Text fz="sm" c="dimmed">
                    {person.note}
                  </Text>
                </Paper>
              </UnstyledButton>
            ))
          ) : (
            <Button size="lg" onClick={() => signIn()}>
              Sign in
            </Button>
          )}
        </Stack>
      </div>
    </div>
  )
}
