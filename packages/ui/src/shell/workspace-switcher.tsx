import clsx from 'clsx'
import { useState } from 'preact/hooks'
import {
  presentationOf,
  systemWorkspace,
  systemWorkspaceName,
  tablesIn,
  userSchemas,
} from '@platform/data'
import { useSession } from '../session.tsx'
import { href } from '../url.ts'
import { Avatar } from '../ui/avatar.tsx'
import { ChevronDownIcon, PlusIcon, SettingsIcon, WorkspaceIcon } from '../ui/icons.tsx'
import { Menu } from '../ui/overlay.tsx'
import { useWorkspace } from '../workspace/view.ts'

export function WorkspaceSwitcher({ path }: { path: string }) {
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
