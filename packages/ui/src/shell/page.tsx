import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import type { Presentation } from '@platform/data'
import { toneClass } from '../metadata/color.ts'
import { ChevronDownIcon, SidebarIcon } from '../ui/icons.tsx'

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
