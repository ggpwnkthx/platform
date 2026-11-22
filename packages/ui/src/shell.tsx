import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Module } from './routes.ts'
import { MenuIcon } from './ui/icons.tsx'
import { ModuleBar } from './shell/module-bar.tsx'
import { NavPane } from './shell/nav-pane.tsx'

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
