/**
 * The rights of a tenant: who holds what, where, and until when; and
 * the acts that grant a right and revoke it.
 */

import { createRoute } from 'honox/factory'
import { AccessError, type GrantInput } from '../../../../../../domains/access'
import { safeRedirect } from '../../../../../../domains/authentication'
import {
  adminFor,
  GrantForm,
  knownOf,
  RightsTable,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
  userLabel,
} from '../../../../../components/operators'
import { Empty, OffsetPager, Refusal, refusalOf } from '../../../../../components/page'
import { formOf } from '../../../../../middleware/forms'
import { flash, sessionOf } from '../../../../../middleware/session'

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const form = await formOf(c)
  const back = safeRedirect(form.get('back') || `${tenantPath(slug)}/rights`)
  try {
    if (form.get('_action') === 'revoke') {
      await access.admin.revokeGrant(form.get('grant'))
      flash(c, { kind: 'ok', text: 'The right was revoked.' })
      return c.redirect(back)
    }
    const [kind, holder = ''] = form.get('holder').split(/:(.*)/s)
    const expires = form.get('expiresAt').trim()
    const session = sessionOf(c)
    const value = form.get('value').trim()
    const role = form.get('kind') === 'role'
    const input: GrantInput = {
      tenant: slug,
      ...(kind === 'group' ? { group: holder } : { userId: holder }),
      ...(role ? { role: value } : { permission: value }),
      workspaceId: form.get('workspaceId').trim() || null,
      routeId: form.get('routeId').trim() || null,
      expiresAt: expires
        ? new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(expires) ? expires : `${expires}Z`).toISOString()
        : null,
      grantedBy: session.principal.email ?? session.principal.id,
    }
    const grant = await access.admin.saveGrant(input)
    flash(c, { kind: 'ok', text: `The right ${grant.permission ?? grant.role} was granted.` })
  } catch (error) {
    if (error instanceof RangeError) {
      flash(c, { kind: 'error', text: 'The moment the right expires is not a moment.' })
      return c.redirect(back)
    }
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, {
      kind: 'error',
      text: error.message,
      detail: `${error.status} ${error.code}${error.requestId ? ` · request ${error.requestId}` : ''}`,
    })
  }
  return c.redirect(back)
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const state =
    c.req.query('state') === 'all' || c.req.query('state') === 'ended'
      ? c.req.query('state')
      : 'live'
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
  const limit = 50
  const base = `${tenantPath(slug)}/rights`
  let page = null
  let refusal = null
  const [users, groups, roles, every] = await Promise.all([
    admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.groups({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.roles({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets }), 400),
  ])
  try {
    page = await admin.grants({
      tenant: slug,
      ...(state === 'live' ? { live: true } : state === 'ended' ? { live: false } : {}),
      limit,
      offset,
    })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const byId = new Map(users.rows.map((user) => [user.id, user]))
  const holderOf = (grant: { userId?: string | null; group?: string | null }) => {
    if (grant.group) return `group ${grant.group}`
    const user = grant.userId ? byId.get(grant.userId) : undefined
    return user ? userLabel(user) : (grant.userId ?? '—')
  }
  const states = [
    { id: 'live', label: 'Live' },
    { id: 'ended', label: 'Revoked or expired' },
    { id: 'all', label: 'All' },
  ]
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Rights"
        lede="A right is a permission or role on a workspace and route, held by a user or a group. The access service decides with them."
      />
      <TenantTabs slug={slug} current="rights" />
      <nav class="segmented" aria-label="The state of the rights">
        {states.map((entry) => (
          <a
            href={entry.id === 'live' ? base : `${base}?state=${entry.id}`}
            aria-current={state === entry.id ? 'true' : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {refusal ? <Refusal refusal={refusal} /> : null}
      {page && page.rows.length === 0 ? <Empty>No right.</Empty> : null}
      {page && page.rows.length > 0 ? (
        <>
          <RightsTable
            showHolder
            rows={page.rows.map((grant) => ({ grant, holder: holderOf(grant) }))}
            back={state === 'live' ? base : `${base}?state=${state}`}
          />
          <OffsetPager
            total={page.total}
            limit={limit}
            offset={offset}
            href={(next) => {
              const params = new URLSearchParams()
              if (state !== 'live') params.set('state', state ?? 'live')
              if (next > 0) params.set('offset', String(next))
              const suffix = params.toString()
              return suffix ? `${base}?${suffix}` : base
            }}
          />
        </>
      ) : null}
      <section class="card">
        <h2>Grant a right</h2>
        <GrantForm
          tenant={slug}
          back={base}
          users={users.rows}
          groups={groups.rows}
          roles={roles.rows}
          known={knownOf(every.rows)}
        />
      </section>
    </>,
    {
      title: `Rights of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Rights' }),
    }
  )
})
