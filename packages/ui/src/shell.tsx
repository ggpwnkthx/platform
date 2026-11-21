import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Module } from './routes.ts'
import { useSession } from './session.tsx'
import { systemWorkspace, systemWorkspaceName, tablesIn, userSchemas } from '@platform/data'
import { toneClass } from './metadata/color.ts'
import { presentationOf, type Presentation } from '@platform/data'
import { href, type Place } from './url.ts'
import { Initials } from './ui/bits.tsx'
import { Avatar } from './ui/avatar.tsx'
import {
  AccessIcon,
  ActivityIcon,
  ChevronDownIcon,
  CollectionIcon,
  ContentIcon,
  GroupIcon,
  iconFor,
  KeyIcon,
  MenuIcon,
  ModelIcon,
  PlusIcon,
  PolicyIcon,
  SettingsIcon,
  SidebarIcon,
  SignOutIcon,
  SqlIcon,
  WorkspaceIcon,
} from './ui/icons.tsx'
import { Menu } from './ui/overlay.tsx'

/**
 * The workspace in view: the address names it, else the last one chosen, else the first of
 * the installation's own. The platform's own is a workspace too, but nobody lands in it:
 * it is in view when it is asked for.
 */
export function useWorkspace(): string {
  const { query } = useLocation()
  const { catalog, lastWorkspace, rememberWorkspace } = useSession()
  const named = query.ws
  const known = (name: string | null | undefined) =>
    Boolean(name && catalog.schemas.some((s) => s.name === name))
  const ws =
    named ?? (known(lastWorkspace) ? lastWorkspace! : (userSchemas(catalog)[0]?.name ?? ''))
  useEffect(() => {
    if (named && named !== lastWorkspace) rememberWorkspace(named)
  }, [named])
  return ws
}

/**
 * The workspace in view, with what the database says about it and how it presents itself:
 * the three things every page about a workspace reads, read in one place.
 */
export function useWorkspaceView() {
  const { catalog, presentations } = useSession()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  return { ws, schema, shown, catalog }
}

/** Statements worth starting from: questions the database answers about the reader. */
const snippets = (ws: string) => [
  { label: 'Who am I', sql: 'SELECT session_user, current_user, current_database(), version();' },
  {
    label: 'My roles',
    sql: 'SELECT name FROM platform.visible_roles() ORDER BY 1;',
  },
  {
    label: `My grants in ${ws || 'a workspace'}`,
    sql: `SELECT table_name, privilege_type, grantee FROM information_schema.role_table_grants WHERE table_schema = '${ws.replaceAll("'", "''")}' ORDER BY 1, 2;`,
  },
  {
    label: 'Row policies',
    sql: 'SELECT schemaname, tablename, policyname, cmd, roles, qual FROM pg_policies ORDER BY 1, 2, 3;',
  },
  {
    label: 'Latest revisions',
    sql: 'SELECT id, at, actor, schema_name, table_name, operation FROM platform.activity ORDER BY id DESC LIMIT 20;',
  },
]

const modules: { id: Module; label: string; path: string; icon: typeof ContentIcon }[] = [
  { id: 'content', label: 'Content', path: '/content', icon: ContentIcon },
  { id: 'model', label: 'Data model', path: '/model', icon: ModelIcon },
  { id: 'access', label: 'Access', path: '/access', icon: AccessIcon },
  { id: 'activity', label: 'Activity', path: '/activity', icon: ActivityIcon },
  { id: 'sql', label: 'SQL', path: '/sql', icon: SqlIcon },
]

function ModuleBar({ module }: { module: Module | null }) {
  const { identity, signOut } = useSession()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  return (
    <nav class="modules" aria-label="Modules">
      <a class="modules-brand" href={href('/content', { ws })}>
        <span class="sr-only">Platform home</span>
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
          <rect x="3" y="3" width="26" height="26" rx="7" class="mark-ground" />
          <path d="M10 22V10h7a4.5 4.5 0 0 1 0 9h-7" class="mark-line" />
        </svg>
      </a>
      <ul>
        {modules.map((m) => (
          <li key={m.id}>
            <a
              href={href(m.path, m.id === 'access' || m.id === 'sql' ? {} : { ws })}
              class={clsx('module', module === m.id && 'is-active')}
              aria-current={module === m.id ? 'page' : undefined}
              title={m.label}
            >
              <m.icon size={22} aria-hidden="true" />
              <span class="sr-only">{m.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <div class="modules-foot">
        <button
          type="button"
          class="module-user"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={identity?.username}
        >
          <Initials name={identity?.username ?? '?'} />
          <span class="sr-only">Your account</span>
        </button>
        <Menu open={open} onClose={() => setOpen(false)} align="start">
          <div class="menu-head">
            <strong>{identity?.username}</strong>
            <span>
              {identity?.effective_role !== identity?.username
                ? `acting as ${identity?.effective_role}`
                : 'Database role'}
            </span>
            <span>
              {identity?.database} · Database {identity?.server_version?.split(' ')[0]} · Platform{' '}
              {identity?.platform_version}
            </span>
          </div>
          <button type="button" class="menu-item" onClick={() => signOut()}>
            <SignOutIcon size={16} aria-hidden="true" /> Sign out
          </button>
        </Menu>
      </div>
    </nav>
  )
}

function WorkspaceSwitcher({ path }: { path: string }) {
  const { catalog, identity, presentations } = useSession()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const current = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  const own = userSchemas(catalog)
  const platform = systemWorkspace(catalog)
  const inPlatform = current?.kind === 'system'
  return (
    <div class="switcher">
      <button
        type="button"
        class="switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Avatar presentation={shown} fallback={WorkspaceIcon} class="switcher-icon" size={18} />
        <span class="switcher-text">
          <strong>
            {inPlatform ? systemWorkspaceName : (shown.displayName ?? (ws || 'No workspace'))}
          </strong>
          <small>
            {inPlatform
              ? 'the platform’s own collections'
              : current
                ? `owned by ${current.owner}`
                : 'Choose a workspace'}
          </small>
        </span>
        <ChevronDownIcon size={16} aria-hidden="true" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="start">
        <p class="menu-label">Workspaces you may use</p>
        {own.map((s) => {
          const item = presentationOf(presentations, s.name)
          return (
            <a
              key={s.name}
              class={clsx('menu-item', s.name === ws && 'is-current')}
              href={href(path, { ws: s.name })}
              title={item.displayName ? s.name : undefined}
              onClick={() => setOpen(false)}
            >
              <Avatar presentation={item} fallback={WorkspaceIcon} class="menu-avatar" size={14} />
              <span>{item.displayName ?? s.name}</span>
              <small>{tablesIn(catalog, s.name).length}</small>
            </a>
          )
        })}
        {!own.length && <p class="menu-note">The database gives you USAGE on no workspace yet.</p>}
        {platform && (
          <>
            <div class="menu-sep" />
            <p class="menu-label">The platform’s own</p>
            <a
              class={clsx('menu-item', inPlatform && 'is-current')}
              href={href(path, { ws: platform.name })}
              title={`${platform.name}: what the platform itself holds, each collection under its own row security`}
              onClick={() => setOpen(false)}
            >
              <SettingsIcon size={14} aria-hidden="true" />
              <span>{systemWorkspaceName}</span>
              <small>{tablesIn(catalog, platform.name).length}</small>
            </a>
          </>
        )}
        <div class="menu-sep" />
        {current && !inPlatform && (
          <a
            class="menu-item"
            href={href('/workspace/settings', { ws })}
            onClick={() => setOpen(false)}
          >
            <SettingsIcon size={16} aria-hidden="true" /> Workspace settings
          </a>
        )}
        {identity?.can_create_workspace && (
          <a class="menu-item" href={href('/workspace/new')} onClick={() => setOpen(false)}>
            <PlusIcon size={16} aria-hidden="true" /> New workspace
          </a>
        )}
      </Menu>
    </div>
  )
}

function CollectionList({ base }: { base: string }) {
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

function NavPane({ module }: { module: Module | null }) {
  const location = useLocation()
  const ws = useWorkspace()
  const { catalog } = useSession()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const link = (path: string, label: string, icon: ComponentChildren, place: Place = {}) => (
    <a
      href={href(path, place)}
      class={clsx('nav-item', location.path === path && 'is-active')}
      aria-current={location.path === path ? 'page' : undefined}
    >
      {icon}
      <span class="nav-text">{label}</span>
    </a>
  )
  if (module === 'access')
    return (
      <>
        <h2 class="nav-title">Access</h2>
        <ul class="nav-list">
          <li>{link('/access', 'Roles', <GroupIcon size={18} aria-hidden="true" />)}</li>
          <li>
            {link('/access/grants', 'Permissions', <KeyIcon size={18} aria-hidden="true" />, {
              ws,
            })}
          </li>
          <li>
            {link('/access/policies', 'Row policies', <PolicyIcon size={18} aria-hidden="true" />, {
              ws,
            })}
          </li>
        </ul>
        <p class="nav-foot">
          Roles, memberships, grants and policies are the database's own. What you change here is a
          statement you run as yourself. A collection's access is also on its own page, under Data
          model.
        </p>
      </>
    )
  if (module === 'sql')
    return (
      <>
        <h2 class="nav-title">SQL</h2>
        <p class="nav-foot">
          One statement at a time, run as your own role. The database checks every GRANT, REVOKE,
          DDL and row it touches.
        </p>
        <h2 class="nav-title">Ask the database</h2>
        <ul class="nav-list">
          {snippets(ws).map((snippet) => (
            <li key={snippet.label}>
              <a class="nav-item" href={href('/sql', { q: snippet.sql })}>
                <SqlIcon size={18} aria-hidden="true" />
                <span class="nav-text">{snippet.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </>
    )
  const base =
    module === 'model'
      ? '/model/collection'
      : module === 'activity'
        ? '/activity'
        : '/content/records'
  return (
    <>
      <WorkspaceSwitcher
        path={module === 'model' ? '/model' : module === 'activity' ? '/activity' : '/content'}
      />
      <div class="nav-section">
        <h2 class="nav-title">{module === 'activity' ? 'Filter by collection' : 'Collections'}</h2>
        {module === 'model' && schema?.can_create && (
          <a
            class="nav-add"
            href={href('/model/new', { ws })}
            title="New collection"
            aria-label="New collection"
          >
            <PlusIcon size={16} />
          </a>
        )}
      </div>
      <CollectionList base={base} />
    </>
  )
}

export function Shell({
  module,
  children,
}: {
  module: Module | null
  children: ComponentChildren
}) {
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => setNavOpen(false), [location.url])
  return (
    <div class={clsx('app', navOpen && 'nav-open')}>
      <ModuleBar module={module} />
      <nav class="nav" aria-label="Navigation">
        <NavPane module={module} />
      </nav>
      <button
        type="button"
        class="nav-scrim"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />
      <div class="main-wrap">
        <button
          type="button"
          class="nav-toggle icon-button"
          aria-label="Open navigation"
          onClick={() => setNavOpen(true)}
        >
          <MenuIcon size={20} />
        </button>
        {children}
      </div>
    </div>
  )
}

export interface Crumb {
  label: string
  href?: string
}

/** A page: its header (breadcrumb, title, actions), its body, and an optional sidebar. */
export function Page({
  title,
  crumbs = [],
  icon,
  actions,
  toolbar,
  sidebar,
  children,
  subtitle,
  presentation,
}: {
  title: ComponentChildren
  crumbs?: Crumb[]
  icon?: ComponentChildren
  actions?: ComponentChildren
  toolbar?: ComponentChildren
  sidebar?: ComponentChildren
  subtitle?: ComponentChildren
  children: ComponentChildren
  /** The item this page is about: its colour marks the icon in the header. */
  presentation?: Presentation | null
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  return (
    <div class={clsx('page', sidebar && sidebarOpen && 'has-sidebar')}>
      <main class="main" id="main">
        <header class="header">
          {icon && (
            <span class={clsx('header-icon', toneClass(presentation?.color))} aria-hidden="true">
              {icon}
            </span>
          )}
          <div class="header-title">
            {/* A crumb is a way back; one that leads nowhere is left out. */}
            {crumbs.some((crumb) => crumb.href) && (
              <nav class="crumbs" aria-label="Breadcrumb">
                {crumbs
                  .filter((crumb) => crumb.href)
                  .map((crumb) => (
                    <span key={crumb.href}>
                      <a href={crumb.href}>{crumb.label}</a>
                    </span>
                  ))}
              </nav>
            )}
            <h1>{title}</h1>
            {subtitle && <p class="header-subtitle">{subtitle}</p>}
          </div>
          <div class="header-actions">
            {actions}
            {sidebar && (
              <button
                type="button"
                class={clsx('icon-button', 'sidebar-toggle', sidebarOpen && 'is-on')}
                aria-label={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
                aria-pressed={sidebarOpen}
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <SidebarIcon size={20} />
              </button>
            )}
          </div>
        </header>
        {toolbar && <div class="toolbar">{toolbar}</div>}
        <div class="body">{children}</div>
      </main>
      {sidebar && sidebarOpen && (
        <aside class="sidebar" aria-label="Details">
          {sidebar}
        </aside>
      )}
    </div>
  )
}

/** One collapsible group of the sidebar. */
export function SideGroup({
  title,
  icon,
  children,
  open = true,
  count,
}: {
  title: string
  icon: ComponentChildren
  children: ComponentChildren
  open?: boolean
  count?: number
}) {
  return (
    <details class="side-group" open={open}>
      <summary>
        <span class="side-icon" aria-hidden="true">
          {icon}
        </span>
        <span>{title}</span>
        {count !== undefined && <span class="side-count">{count}</span>}
        <ChevronDownIcon class="side-chevron" size={16} aria-hidden="true" />
      </summary>
      <div class="side-body">{children}</div>
    </details>
  )
}

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
