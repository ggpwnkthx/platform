/**
 * The overview: where a caller starts.
 */

import type { Child } from 'hono/jsx'
import { createRoute } from 'honox/factory'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../domains/ability'
import { Badge, PageHead, StateBadge } from '../components/page'
import { boardOf } from '../middleware/board'
import { operatorScope } from '../middleware/scope'

/** A card that leads to a place of the console. */
function PlaceCard(props: {
  href: string
  eyebrow: string
  title: string
  text: string
  go: string
  badge?: Child
}) {
  return (
    <a class="card card-link" href={props.href}>
      <div class="eyebrow">{props.eyebrow}</div>
      <header>
        <h2>{props.title}</h2>
        {props.badge ?? null}
      </header>
      <p class="muted small">{props.text}</p>
      <span class="card-go">{props.go} →</span>
    </a>
  )
}

export default createRoute(async (c) => {
  const session = c.get('session')
  const board = await boardOf(c)
  const status = (
    <a class="card card-link" href="/status">
      <div class="eyebrow">Health</div>
      <header>
        <h2>Status</h2>
        <StateBadge state={board.overall} />
      </header>
      <div class="stack" style="gap: 0.45rem">
        {board.services.map((service) => (
          <div class="row spread small">
            <span>{service.name}</span>
            <StateBadge state={service.state} />
          </div>
        ))}
      </div>
      <span class="card-go">Open the status page →</span>
    </a>
  )

  if (!session) {
    return c.render(
      <>
        <PageHead
          eyebrow="Platform console"
          title="Console"
          lede="Browse and edit workspace data, administer tenants and their access, and check the platform's health. Every answer comes from the gateway, the access service or the data service."
          actions={
            <a class="button" href="/auth/login">
              Sign in
            </a>
          }
        />
        <div class="split">
          <div class="grid">
            <PlaceCard
              href="/auth/login?redirect=%2Fworkspaces"
              eyebrow="Data"
              title="Workspaces"
              text="Search, filter and edit records, read their history and roll them back, and shape the workspace model — within the policies the data service holds for you."
              go="Sign in to open"
            />
            <PlaceCard
              href="/auth/login?redirect=%2Foperators"
              eyebrow="Access"
              title="Administration"
              text="Tenants, users, groups, roles and rights, with an audit of every change. For operators named on the console's route."
              go="Sign in to open"
            />
            <PlaceCard
              href="/docs"
              eyebrow="Guides"
              title="Documentation"
              text="How the platform fits together, how to run it, and the contract of each service."
              go="Read the docs"
            />
          </div>
          {status}
        </div>
      </>,
      { title: 'Overview', section: 'home' }
    )
  }

  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const who = session.principal.name ?? session.principal.email ?? 'there'
  const platform = ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)
  return c.render(
    <>
      <PageHead
        eyebrow={`Tenant ${session.principal.tenant}`}
        title={`Hello, ${who}`}
        lede="Pick up where you left off, or check how the platform is doing."
      />
      <div class="split">
        <div class="grid">
          <PlaceCard
            href="/workspaces"
            eyebrow="Data"
            title="Workspaces"
            text={
              session.workspaces.length > 0
                ? `Collections, records, model and audit. ${session.workspaces.length} opened in this session.`
                : 'Collections, records, model and audit of the workspaces you hold a right on.'
            }
            go="Open workspaces"
          />
          {ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT) ? (
            <PlaceCard
              href="/operators"
              eyebrow="Access"
              title="Operators"
              text={
                platform
                  ? 'Every tenant of the platform: users, groups, roles, rights and audit.'
                  : 'Your tenant: users, groups, roles, rights and audit.'
              }
              go={platform ? 'Manage tenants' : 'Manage your tenant'}
              badge={
                <Badge tone="accent" plain>
                  {platform ? 'every tenant' : scope.tenant}
                </Badge>
              }
            />
          ) : null}
          <PlaceCard
            href="/me"
            eyebrow="Account"
            title="You"
            text="Your identity, your tenant, and the keys you hold on the console."
            go="View your access"
          />
          <PlaceCard
            href="/docs"
            eyebrow="Guides"
            title="Documentation"
            text="How the platform fits together, how to run it, and the contract of each service."
            go="Read the docs"
          />
        </div>
        {status}
      </div>
    </>,
    { title: 'Overview', section: 'home' }
  )
})
