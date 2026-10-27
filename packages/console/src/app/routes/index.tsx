/**
 * The overview: where a caller starts.
 */

import { createRoute } from 'honox/factory'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../domains/ability'
import { Badge, PageHead, StateBadge } from '../components/page'
import { boardOf } from '../middleware/board'
import { operatorScope } from '../middleware/scope'

export default createRoute(async (c) => {
  const session = c.get('session')
  const board = await boardOf(c)
  const status = (
    <a class="card card-link" href="/status">
      <header>
        <h2>Status</h2>
        <StateBadge state={board.overall} />
      </header>
      <div class="stack" style="gap: 0.4rem">
        {board.services.map((service) => (
          <div class="row spread">
            <span>{service.name}</span>
            <StateBadge state={service.state} />
          </div>
        ))}
      </div>
    </a>
  )

  if (!session) {
    return c.render(
      <>
        <PageHead
          title="The console of the platform"
          lede="The place where people read the data of their workspaces and where operators administer the access to it. The console is a client of the gateway, the access service and the data service: every answer it shows is theirs."
          actions={
            <a class="button" href="/auth/login">
              Sign in
            </a>
          }
        />
        <div class="grid grid-wide">
          <article class="card">
            <h2>The data of a workspace</h2>
            <p class="muted">
              Browse the collections of a workspace, search and filter their records, create and
              edit them, read their history and roll them back, and shape the model of the workspace
              — within the policies the data service holds for you.
            </p>
          </article>
          <article class="card">
            <h2>The administration</h2>
            <p class="muted">
              Tenants, users, groups and rights, and the audit of every change, for the operators
              the access service names on the route of the console.
            </p>
          </article>
          {status}
        </div>
      </>,
      { title: 'Overview', section: 'home' }
    )
  }

  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const who = session.principal.name ?? session.principal.email ?? 'there'
  return c.render(
    <>
      <PageHead
        title={`Hello, ${who}`}
        lede={
          <>
            You are signed in to the tenant <strong>{session.principal.tenant}</strong>.
          </>
        }
      />
      <div class="grid grid-wide">
        <a class="card card-link" href="/workspaces">
          <header>
            <h2>Workspaces</h2>
            <Badge tone="accent" plain>
              data
            </Badge>
          </header>
          <p class="muted">
            The collections, the records, the model and the audit of the workspaces you hold a right
            on.
          </p>
          {session.workspaces.length > 0 ? (
            <span class="small">
              {session.workspaces.length} opened in this session · continue where you were
            </span>
          ) : null}
        </a>
        {ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT) ? (
          <a class="card card-link" href="/operators">
            <header>
              <h2>Operators</h2>
              <Badge tone="accent" plain>
                {ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)
                  ? 'every tenant'
                  : scope.tenant}
              </Badge>
            </header>
            <p class="muted">
              {ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)
                ? 'The tenants of the platform, their users, groups and rights, and the audit of every change.'
                : 'The users, the groups and the rights of your tenant, and the audit of every change.'}
            </p>
          </a>
        ) : null}
        {status}
        <a class="card card-link" href="/me">
          <header>
            <h2>You</h2>
          </header>
          <p class="muted">
            What the access service says about you: your identity, your tenant, and the keys you
            hold on the console.
          </p>
        </a>
      </div>
    </>,
    { title: 'Overview', section: 'home' }
  )
})
