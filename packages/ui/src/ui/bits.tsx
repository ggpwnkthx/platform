import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { ErrorIcon, InfoIcon, SpinnerIcon, SuccessIcon, WarningIcon } from './icons.tsx'

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'outline'

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: BadgeTone
  children: ComponentChildren
  title?: string
}) {
  return (
    <span class={clsx('badge', `badge-${tone}`)} title={title}>
      {children}
    </span>
  )
}

export function Notice({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title: ComponentChildren
  children?: ComponentChildren
  actions?: ComponentChildren
}) {
  const Icon = { info: InfoIcon, warning: WarningIcon, danger: ErrorIcon, success: SuccessIcon }[
    tone
  ]
  return (
    <div class={clsx('notice', `notice-${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div class="notice-body">
        <p class="notice-title">{title}</p>
        {children && <div class="notice-text">{children}</div>}
      </div>
      {actions && <div class="notice-actions">{actions}</div>}
    </div>
  )
}

export function Empty({
  icon,
  title,
  children,
  actions,
}: {
  icon: ComponentChildren
  title: string
  children?: ComponentChildren
  actions?: ComponentChildren
}) {
  return (
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {children && <div class="empty-text">{children}</div>}
      {actions && <div class="empty-actions">{actions}</div>}
    </div>
  )
}

export function Loading({ label = 'Reading from PostgreSQL' }: { label?: string }) {
  return (
    <div class="loading" role="status">
      <SpinnerIcon class="spin" size={18} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/** A statement as it will run: the reader sees exactly what PostgreSQL will be asked. */
export function Statement({ sql, label = 'Runs as you' }: { sql: string; label?: string }) {
  return (
    <figure class="statement">
      <figcaption>{label}</figcaption>
      <pre>
        <code>{sql}</code>
      </pre>
    </figure>
  )
}

export function Initials({ name }: { name: string }) {
  const letters = name
    .replace(/@.*/, '')
    .split(/[._\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <span class="initials" aria-hidden="true">
      {letters || '?'}
    </span>
  )
}
