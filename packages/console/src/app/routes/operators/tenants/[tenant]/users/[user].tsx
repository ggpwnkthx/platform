/**
 * The access of one user: the rights it holds by itself, the rights it
 * holds through its groups, and its registration.
 */

import { createRoute } from 'honox/factory'
import { AccessError, type AdminClient, type Principal } from '../../../../../../domains/access'
import { groupsOf, isLive, rightsOf } from '../../../../../../domains/operators'
import {
  adminFor,
  GrantForm,
  knownOf,
  RightsTable,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
  UserStatus,
  userLabel,
} from '../../../../../components/operators'
import { Empty, KeyValues, Moment, Notice } from '../../../../../components/page'
import CopyText from '../../../../../islands/copy-text'
import { formOf } from '../../../../../middleware/forms'
import { flash } from '../../../../../middleware/session'

async function userOf(
  admin: AdminClient,
  tenant: string,
  id: string
): Promise<{ user: Principal | null; complete: boolean }> {
  const all = await admin.all((page) => admin.principals({ tenant, ...page }))
  return { user: all.rows.find((row) => row.id === id) ?? null, complete: all.complete }
}

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const id = c.req.param('user') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { user } = await userOf(access.admin, slug, id)
  if (!user) return c.notFound()
  const form = await formOf(c)
  const path = `${tenantPath(slug)}/users/${id}`
  try {
    const status = form.get('status') === 'disabled' ? 'disabled' : 'active'
    await access.admin.savePrincipal({
      tenant: slug,
      externalSubject: user.externalSubject,
      ...(form.get('email').trim() ? { email: form.get('email').trim() } : {}),
      ...(form.get('displayName').trim() ? { displayName: form.get('displayName').trim() } : {}),
      status,
    })
    flash(c, {
      kind: 'ok',
      text:
        status !== user.status
          ? status === 'disabled'
            ? `${userLabel(user)} is disabled: the access service refuses every decision for them.`
            : `${userLabel(user)} is active again.`
          : `${userLabel(user)} was saved.`,
    })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
  }
  return c.redirect(path)
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const id = c.req.param('user') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const [{ user, complete }, grants, groups] = await Promise.all([
    userOf(admin, slug, id),
    admin.all((page) => admin.grants({ tenant: slug, ...page })),
    admin.all((page) => admin.groups({ tenant: slug, ...page })),
  ])
  if (!user) {
    if (!complete) {
      c.status(404)
      return c.render(
        <Notice tone="warn" title="The user is not among the first thousand of the tenant">
          The console reads a thousand users of a tenant at most.
        </Notice>,
        { title: 'User', section: 'operators', crumbs: tenantCrumbs(slug, { label: 'Users' }) }
      )
    }
    return c.notFound()
  }
  const showAll = c.req.query('all') === '1'
  const rights = rightsOf(user, grants.rows, groups.rows).filter(
    (right) => showAll || isLive(right.grant)
  )
  const own = rights.filter((right) => right.group === null)
  const inherited = rights.filter((right) => right.group !== null)
  const memberOf = groupsOf(user, groups.rows)
  const path = `${tenantPath(slug)}/users/${id}`

  return c.render(
    <>
      <TenantHead slug={slug} title={userLabel(user)} />
      <TenantTabs slug={slug} current="users" />
      <div class="split">
        <div class="stack">
          <section class="card">
            <header>
              <h2>Rights of their own</h2>
              <a class="small" href={showAll ? path : `${path}?all=1`}>
                {showAll ? 'only the live rights' : 'with the revoked and the expired'}
              </a>
            </header>
            {own.length === 0 ? (
              <Empty>No right of their own.</Empty>
            ) : (
              <RightsTable rows={own.map((right) => ({ grant: right.grant }))} back={path} />
            )}
            <details class="disclosure">
              <summary>Grant a right</summary>
              <GrantForm tenant={slug} back={path} fixedUser={user} known={knownOf(grants.rows)} />
            </details>
          </section>
          <section class="card">
            <h2>Rights through their groups</h2>
            {inherited.length === 0 ? (
              <p class="muted">No group of theirs holds a right.</p>
            ) : (
              <RightsTable
                rows={inherited.map((right) => ({ grant: right.grant, through: right.group }))}
                back={path}
              />
            )}
            <p class="small muted">A right of a group is revoked on the page of the group.</p>
          </section>
        </div>
        <aside class="stack">
          <section class="card">
            <header>
              <h2>The user</h2>
              <UserStatus user={user} />
            </header>
            <KeyValues
              rows={[
                ['Principal', <CopyText text={user.id} short />],
                ['At the provider', <CopyText text={user.externalSubject} short />],
                ['E-mail', user.email ?? '—'],
                ['Last login', <Moment at={user.lastLoginAt} />],
                ['Registered', <Moment at={user.createdAt} />],
              ]}
            />
          </section>
          <section class="card">
            <h2>Groups</h2>
            {memberOf.length === 0 ? (
              <p class="muted">Member of no group.</p>
            ) : (
              <div class="chips">
                {memberOf.map((group) => (
                  <a
                    class="chip"
                    href={`${tenantPath(slug)}/groups/${encodeURIComponent(group.key)}`}
                  >
                    {group.displayName ?? group.key}
                  </a>
                ))}
              </div>
            )}
          </section>
          <section class="card">
            <h2>Registration</h2>
            <form method="post" class="form">
              <label class="field">
                <span>Name</span>
                <input name="displayName" value={user.displayName ?? ''} />
              </label>
              <label class="field">
                <span>E-mail</span>
                <input name="email" type="email" value={user.email ?? ''} />
              </label>
              <label class="field">
                <span>Status</span>
                <select name="status">
                  <option value="active" selected={user.status === 'active'}>
                    active
                  </option>
                  <option value="disabled" selected={user.status === 'disabled'}>
                    disabled
                  </option>
                </select>
                <span class="hint">a disabled user is refused by every decision</span>
              </label>
              <div class="row">
                <button type="submit" class="button">
                  Save
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </>,
    {
      title: userLabel(user),
      section: 'operators',
      crumbs: tenantCrumbs(
        slug,
        { label: 'Users', href: `${tenantPath(slug)}/users` },
        { label: userLabel(user) }
      ),
    }
  )
})
