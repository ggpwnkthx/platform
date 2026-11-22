import clsx from 'clsx'
import { useState } from 'preact/hooks'
import type { Module } from '../routes.ts'
import { useSession } from '../session.tsx'
import { href } from '../url.ts'
import { Initials } from '../ui/bits.tsx'
import {
  AccessIcon,
  ActivityIcon,
  ContentIcon,
  ModelIcon,
  SignOutIcon,
  SqlIcon,
} from '../ui/icons.tsx'
import { Menu } from '../ui/overlay.tsx'
import { useWorkspace } from '../workspace/view.ts'

const modules: { id: Module; label: string; path: string; icon: typeof ContentIcon }[] = [
  { id: 'content', label: 'Content', path: '/content', icon: ContentIcon },
  { id: 'model', label: 'Data model', path: '/model', icon: ModelIcon },
  { id: 'access', label: 'Access', path: '/access', icon: AccessIcon },
  { id: 'activity', label: 'Activity', path: '/activity', icon: ActivityIcon },
  { id: 'sql', label: 'SQL', path: '/sql', icon: SqlIcon },
]

export function ModuleBar({ module }: { module: Module | null }) {
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
