/**
 * What the console knows about the caller, and why it opens what it
 * opens.
 */

import { createRoute } from 'honox/factory'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../domains/ability'
import { CONSOLE_KEYS } from '../../domains/operators'
import { Badge, KeyValues, Moment, PageHead } from '../components/page'
import CopyText from '../islands/copy-text'
import { requireSession } from '../middleware/guards'
import { operatorScope } from '../middleware/scope'
import { sessionOf } from '../middleware/session'

export default createRoute(requireSession, async (c) => {
  const session = sessionOf(c)
  const services = c.get('services')
  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const keys = Object.values(CONSOLE_KEYS)
  return c.render(
    <>
      <PageHead
        title="You"
        lede="Your identity is the one the access service issued when you signed in. Your keys on the console are read from the access service on every page, never remembered."
      />
      <div class="grid grid-wide">
        <section class="card">
          <h2>Your identity</h2>
          <KeyValues
            rows={[
              ['Name', session.principal.name ?? '—'],
              ['E-mail', session.principal.email ?? '—'],
              ['Principal', <CopyText text={session.principal.id} />],
              ['Tenant', <code>{session.principal.tenant}</code>],
              ['Signed in', <Moment at={new Date(session.createdAt).toISOString()} />],
              [
                'Data access until',
                <Moment at={new Date(session.accessTokenExpiresAt).toISOString()} />,
              ],
            ]}
          />
        </section>
        <section class="card">
          <h2>Your keys on the console</h2>
          <p class="small muted">
            Read from the access context of the route <code>{services.config.routeId}</code>, for
            the workspace <code>{session.principal.tenant}</code>.
          </p>
          <div class="stack" style="gap: 0.4rem">
            {keys.map((key) => (
              <div class="row spread">
                <code>{key}</code>
                {scope.keys.includes(key) ? <Badge tone="ok">held</Badge> : <Badge>not held</Badge>}
              </div>
            ))}
          </div>
          <p class="small">
            {ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)
              ? 'You administer every tenant of the platform.'
              : ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)
                ? `You administer the tenant ${scope.tenant}.`
                : services.context
                  ? 'You administer nothing.'
                  : 'The console holds no credential of the access context: it opens the administration to nobody.'}
          </p>
        </section>
        <section class="card">
          <h2>Your rights when you signed in</h2>
          <p class="small muted">
            The keys of the token of your login: a snapshot of that moment, never the policy.
          </p>
          {session.principal.roles.length === 0 ? (
            <p class="muted">None.</p>
          ) : (
            <div class="chips">
              {session.principal.roles.map((role) => (
                <span class="chip">
                  <code>{role}</code>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </>,
    { title: 'You', section: 'me', crumbs: [{ label: 'Overview', href: '/' }, { label: 'You' }] }
  )
})
