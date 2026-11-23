import {
  AppShell,
  Avatar,
  Burger,
  Menu,
  NavLink,
  Select,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { tablesIn } from '@platform/core'
import {
  Database,
  History,
  KeyRound,
  Plus,
  Settings,
  ShieldCheck,
  Table2,
  TerminalSquare,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ItemIcon } from '../bits/marks.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useNames } from './names.ts'

const modules = [
  ['data', 'Data', Table2],
  ['access', 'Access', ShieldCheck],
  ['activity', 'Activity', History],
  ['sql', 'SQL', TerminalSquare],
] as const

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
  const first = pathname.split('/')[1]
  const module = first === 'workspace' || first === 'content' || first === 'model' ? 'data' : first
  // The users and groups are the cluster's, the same in every workspace: the page reads
  // them, not a workspace, so it is shown without the pane that picks one.
  const withPane = pathname !== '/access'
  // The data module has two views of a collection: its records and its shape.
  const modeling = pathname.startsWith('/data/model')
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
    <AppShell
      navbar={{
        width: withPane ? 328 : 64,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding={0}
    >
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
          {withPane && (
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
                link('/access', 'Users and groups', <Users size={16} />),
                link('/workspace/settings', 'Workspace permissions', <KeyRound size={16} />),
              ]}
              {module === 'data' && (
                <>
                  <Text fz={12} fw={600} c="dimmed" px="xs" py={6}>
                    Collections
                  </Text>
                  {collections.map((t) =>
                    link(
                      modeling ? '/data/model/collection' : '/data/records',
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
                    link('/data/model/new', 'New collection', <Plus size={16} />)}
                  <Text fz={12} fw={600} c="dimmed" px="xs" pt="md" pb={6}>
                    Workspace
                  </Text>
                  {place.ws && link('/workspace/settings', 'Settings', <Settings size={16} />)}
                  {identity.can_create_workspace &&
                    link('/workspace/new', 'New workspace', <Plus size={16} />)}
                </>
              )}
            </div>
          )}
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
