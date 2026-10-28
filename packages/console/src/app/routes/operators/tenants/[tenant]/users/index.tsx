/**
 * The users of a tenant, and their registration.
 *
 * A user is registered before its first login by the identity its
 * provider gives it — its external subject — and the e-mail the access
 * service publishes until the provider says otherwise. A batch registers
 * a whole team at once: every line is written on its own, and the page
 * says what happened to each one.
 */

import { createRoute } from 'honox/factory'
import { AccessError } from '../../../../../../domains/access'
import {
  adminFor,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
  UserStatus,
  userLabel,
} from '../../../../../components/operators'
import { Empty, Moment, OffsetPager, Refusal, refusalOf } from '../../../../../components/page'
import { formOf } from '../../../../../middleware/forms'
import { flash } from '../../../../../middleware/session'

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const form = await formOf(c)
  const base = `${tenantPath(slug)}/users`
  try {
    if (form.get('_action') === 'batch') {
      const lines = form
        .get('lines')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .slice(0, 1000)
      const outcomes = await access.admin.savePrincipals(
        lines.map((line) => {
          const [externalSubject = '', email = '', displayName = ''] = line
            .split(',')
            .map((part) => part.trim())
          return {
            tenant: slug,
            externalSubject,
            ...(email ? { email } : {}),
            ...(displayName ? { displayName } : {}),
          }
        })
      )
      const written = outcomes.filter((outcome) => outcome.id !== null).length
      const failed = outcomes
        .filter((outcome) => outcome.id === null)
        .map(
          (outcome) =>
            `${outcome.externalSubject ?? '?'}: ${outcome.message ?? outcome.error ?? 'refused'}`
        )
      flash(c, {
        kind: failed.length === 0 ? 'ok' : 'error',
        text: `${written} of ${lines.length} users were registered.`,
        ...(failed.length > 0 ? { detail: failed.slice(0, 10).join(' · ') } : {}),
      })
      return c.redirect(base)
    }
    const { principal, created } = await access.admin.savePrincipal({
      tenant: slug,
      externalSubject: form.get('externalSubject').trim(),
      ...(form.get('email').trim() ? { email: form.get('email').trim() } : {}),
      ...(form.get('displayName').trim() ? { displayName: form.get('displayName').trim() } : {}),
    })
    flash(c, {
      kind: 'ok',
      text: created
        ? `${userLabel(principal)} was registered.`
        : `${userLabel(principal)} was updated.`,
    })
    return c.redirect(`${base}/${principal.id}`)
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, {
      kind: 'error',
      text: error.message,
      detail: `${error.status} ${error.code}`,
    })
    return c.redirect(base)
  }
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const status =
    c.req.query('status') === 'active' || c.req.query('status') === 'disabled'
      ? c.req.query('status')
      : ''
  const email = (c.req.query('email') ?? '').trim()
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
  const limit = 50
  const base = `${tenantPath(slug)}/users`
  let page = null
  let refusal = null
  try {
    page = await access.admin.principals({ tenant: slug, status, email, limit, offset })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const href = (next: number) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (email) params.set('email', email)
    if (next > 0) params.set('offset', String(next))
    const suffix = params.toString()
    return suffix ? `${base}?${suffix}` : base
  }
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Users"
        lede="People in this tenant, as the access service knows them."
      />
      <TenantTabs slug={slug} current="users" />
      <form method="get" class="toolbar">
        <label class="field">
          <span>E-mail</span>
          <input type="email" name="email" value={email} placeholder="the exact e-mail" />
        </label>
        <label class="field narrow">
          <span>Status</span>
          <select name="status">
            <option value="">any</option>
            <option value="active" selected={status === 'active'}>
              active
            </option>
            <option value="disabled" selected={status === 'disabled'}>
              disabled
            </option>
          </select>
        </label>
        <button type="submit" class="button quiet">
          Filter
        </button>
      </form>
      {refusal ? <Refusal refusal={refusal} /> : null}
      {page && page.rows.length === 0 ? <Empty>No user matches.</Empty> : null}
      {page && page.rows.length > 0 ? (
        <>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Identity at the provider</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((user) => (
                  <tr>
                    <td>
                      <a href={`${base}/${user.id}`}>
                        <strong>{userLabel(user)}</strong>
                      </a>
                      {user.email && user.displayName ? (
                        <div class="small muted">{user.email}</div>
                      ) : null}
                    </td>
                    <td class="small mono">{user.externalSubject}</td>
                    <td>
                      <UserStatus user={user} />
                    </td>
                    <td class="small">
                      <Moment at={user.lastLoginAt} />
                    </td>
                    <td class="small">
                      <Moment at={user.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <OffsetPager total={page.total} limit={limit} offset={offset} href={href} />
        </>
      ) : null}
      <div class="grid grid-wide">
        <section class="card">
          <h2>Register a user</h2>
          <form method="post" class="form">
            <label class="field">
              <span>Identity at the provider</span>
              <input
                name="externalSubject"
                required
                class="mono"
                placeholder="the sub of the provider"
              />
            </label>
            <label class="field">
              <span>E-mail</span>
              <input name="email" type="email" />
            </label>
            <label class="field">
              <span>Name</span>
              <input name="displayName" />
            </label>
            <div class="row">
              <button type="submit" class="button">
                Register
              </button>
            </div>
          </form>
        </section>
        <section class="card">
          <h2>Register a team</h2>
          <form method="post" class="form">
            <input type="hidden" name="_action" value="batch" />
            <label class="field">
              <span>One user per line</span>
              <textarea
                name="lines"
                rows={7}
                class="code"
                placeholder="00u1a2b3c4d5, alice@acme.example, Alice"
              />
              <span class="hint">
                identity, e-mail, name · at most 1 000 lines · a line that fails does not stop the
                others
              </span>
            </label>
            <div class="row">
              <button type="submit" class="button quiet">
                Register them
              </button>
            </div>
          </form>
        </section>
      </div>
    </>,
    {
      title: `Users of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Users' }),
    }
  )
})
