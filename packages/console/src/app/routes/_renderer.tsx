/**
 * The frame of every page: the masthead, the breadcrumbs, the message of
 * the page and the foot.
 */

import { getCookie } from 'hono/cookie'
import { jsxRenderer, useRequestContext } from 'hono/jsx-renderer'
import { Link, Script } from 'honox/server'
import type { Crumb, Section } from '../context'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../domains/ability'
import SessionClock from '../islands/session-clock'
import ThemeToggle from '../islands/theme-toggle'
import { operatorScope } from '../middleware/scope'
import { takeFlash } from '../middleware/session'
import { VERSION } from '../../runtime/version'

async function Masthead(props: { section?: Section }) {
  const c = useRequestContext()
  const session = c.get('session')
  const scope = session ? await operatorScope(c) : null
  const ability = scope ? consoleAbility(scope) : null
  const theme = getCookie(c, 'console_theme')
  const items: { href: string; label: string; section: Section; shown: boolean }[] = [
    { href: '/', label: 'Overview', section: 'home', shown: true },
    { href: '/workspaces', label: 'Workspaces', section: 'workspaces', shown: session !== null },
    {
      href: '/operators',
      label: 'Operators',
      section: 'operators',
      shown: ability?.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT) ?? false,
    },
    { href: '/status', label: 'Status', section: 'status', shown: true },
  ]
  return (
    <header class="masthead">
      <div class="masthead-inner">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">
            P
          </span>
          Console
        </a>
        <nav class="nav" aria-label="The console">
          {items
            .filter((item) => item.shown)
            .map((item) => (
              <a
                href={item.href}
                aria-current={item.section === props.section ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
        </nav>
        <div class="masthead-tools">
          <ThemeToggle initial={theme === 'light' || theme === 'dark' ? theme : 'system'} />
          {session ? (
            <>
              <SessionClock
                expiresAt={session.accessTokenExpiresAt}
                renewHref="/auth/login?redirect="
              />
              <a class="who" href="/me" style="text-decoration: none; color: inherit">
                <strong>{session.principal.name ?? session.principal.email ?? 'You'}</strong>
                <span class="small muted">{session.principal.tenant}</span>
              </a>
              <form method="post" action="/auth/logout">
                <button type="submit" class="button quiet small">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <a class="button small" href="/auth/login">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  )
}

function Crumbs(props: { crumbs: readonly Crumb[] }) {
  if (props.crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumbs">
      <ol class="crumbs">
        {props.crumbs.map((crumb) => (
          <li>
            {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span>{crumb.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Message() {
  const c = useRequestContext()
  const message = takeFlash(c)
  if (!message) return null
  return (
    <div class={`notice ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <strong>{message.text}</strong>
      {message.detail ? <span class="small">{message.detail}</span> : null}
    </div>
  )
}

export default jsxRenderer(({ children, title, section, crumbs }) => {
  const c = useRequestContext()
  const theme = getCookie(c, 'console_theme')
  return (
    <html lang="en" data-theme={theme === 'light' || theme === 'dark' ? theme : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="same-origin" />
        <title>{title ? `${title} · Console` : 'Console'}</title>
        <Link href="/src/app/style.css" rel="stylesheet" prod={import.meta.env.CONSOLE_BUILD} />
        <Script src="/src/app/client.ts" async prod={import.meta.env.CONSOLE_BUILD} />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to the content
        </a>
        <Masthead section={section} />
        <main id="main">
          <Crumbs crumbs={crumbs ?? []} />
          <Message />
          {children}
        </main>
        <footer class="foot">
          <div>
            <span>The console of the platform · {VERSION}</span>
            <span>
              A client of the gateway, the access service and the data service. It decides nothing.
            </span>
          </div>
        </footer>
      </body>
    </html>
  )
})
