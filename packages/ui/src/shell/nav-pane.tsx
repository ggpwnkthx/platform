import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { useLocation } from 'preact-iso'
import type { Module } from '../routes.ts'
import { useSession } from '../session.tsx'
import { href, type Place } from '../url.ts'
import { GroupIcon, KeyIcon, PlusIcon, PolicyIcon, SqlIcon } from '../ui/icons.tsx'
import { CollectionList } from './collection-list.tsx'
import { useWorkspace } from '../workspace/view.ts'
import { WorkspaceSwitcher } from './workspace-switcher.tsx'

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

export function NavPane({ module }: { module: Module | null }) {
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
