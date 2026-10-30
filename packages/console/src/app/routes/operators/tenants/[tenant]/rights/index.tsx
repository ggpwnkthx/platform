/**
 * The rights of a tenant: who holds what, where, and until when; and
 * the acts that grant a right and revoke it.
 *
 * The grant form is checked before Access is called: a role is one of
 * the tenant's roles, and a permission no grant or role names is created
 * only once the operator said so. A refused form comes back filled in,
 * on the page it was sent from.
 */

import { createRoute } from 'honox/factory'
import { AccessError, type GrantInput } from '../../../../../../domains/access'
import { safeRedirect } from '../../../../../../domains/authentication'
import {
  checkGrant,
  isFiltered,
  knownPermissionsOf,
  matchesRightsFilter,
  type RightsFilter,
} from '../../../../../../domains/operators'
import {
  adminFor,
  GRANT_FORM,
  GrantForm,
  HowRightsWork,
  holderOf,
  RightsTable,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import { Empty, Notice, OffsetPager, Refusal, refusalOf } from '../../../../../components/page'
import { formOf } from '../../../../../middleware/forms'
import { flash, keepDraft, sessionOf, takeDraft } from '../../../../../middleware/session'

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const form = await formOf(c)
  const back = safeRedirect(form.get('back') || `${tenantPath(slug)}/rights`)
  if (form.get('_action') === 'revoke') {
    try {
      await admin.revokeGrant(form.get('grant'))
      flash(c, { kind: 'ok', text: 'The right was revoked.' })
    } catch (error) {
      if (!(error instanceof AccessError) || error.status >= 500) throw error
      flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
    }
    return c.redirect(back)
  }

  const [grants, roles] = await Promise.all([
    admin.all((page) => admin.grants({ tenant: slug, ...page })),
    admin.all((page) => admin.roles({ tenant: slug, ...page })),
  ])
  const checked = checkGrant(
    {
      holder: form.get('holder'),
      kind: form.get('kind'),
      role: form.get('role'),
      permission: form.get('permission'),
      createPermission: form.get('createPermission') === 'yes',
      workspace: form.get('workspace'),
      workspaceId: form.get('workspaceId'),
      routeId: form.get('routeId'),
      expires: form.get('expires'),
      expiresAt: form.get('expiresAt'),
    },
    {
      permissions: knownPermissionsOf(grants.rows, roles.rows),
      roles: roles.rows.map((role) => role.key),
    }
  )
  if ('problems' in checked) {
    keepDraft(c, { form: GRANT_FORM, values: form.fields, problems: checked.problems })
    flash(c, { kind: 'error', text: 'The right was not granted: the form needs a change.' })
    return c.redirect(back)
  }
  const session = sessionOf(c)
  const input: GrantInput = {
    tenant: slug,
    ...checked.grant,
    grantedBy: session.principal.email ?? session.principal.id,
  }
  try {
    const grant = await admin.saveGrant(input)
    flash(c, {
      kind: 'ok',
      text: grant.role
        ? `The role ${grant.role} was granted.`
        : `The permission ${grant.permission} was granted.`,
    })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    keepDraft(c, { form: GRANT_FORM, values: form.fields, problems: [] })
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
      ? (c.req.query('state') as 'all' | 'ended')
      : 'live'
  const filter: RightsFilter = {
    holder: c.req.query('holder') ?? '',
    right: c.req.query('right') ?? '',
    workspace: c.req.query('workspace') ?? '',
  }
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
  const limit = 50
  const base = `${tenantPath(slug)}/rights`
  const live = state === 'live' ? true : state === 'ended' ? false : undefined
  const [users, groups, roles, every] = await Promise.all([
    admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.groups({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.roles({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets }), 400),
  ])
  const byId = new Map(users.rows.map((user) => [user.id, user]))

  // A filter reads the rights of the tenant and pages them here; without
  // one, Access pages them.
  let rows = null
  let total = 0
  let partial = false
  let refusal = null
  try {
    if (isFiltered(filter)) {
      const all = await admin.all((offsets) =>
        admin.grants({ tenant: slug, ...(live === undefined ? {} : { live }), ...offsets })
      )
      const matched = all.rows.filter((grant) =>
        matchesRightsFilter(grant, holderOf(slug, grant, byId).label, filter)
      )
      total = matched.length
      partial = !all.complete
      rows = matched.slice(offset, offset + limit)
    } else {
      const page = await admin.grants({
        tenant: slug,
        ...(live === undefined ? {} : { live }),
        limit,
        offset,
      })
      total = page.total
      rows = page.rows
    }
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }

  const query = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams()
    const values: Record<string, string | number> = { state, ...filter, offset: 0, ...changes }
    for (const [key, value] of Object.entries(values)) {
      if (key === 'state' && value === 'live') continue
      if (key === 'offset' && Number(value) === 0) continue
      if (String(value).trim() !== '') params.set(key, String(value).trim())
    }
    const suffix = params.toString()
    return suffix ? `${base}?${suffix}` : base
  }
  const here = query({ offset })
  const states = [
    { id: 'live', label: 'Live' },
    { id: 'ended', label: 'Revoked or ended' },
    { id: 'all', label: 'All' },
  ]
  const draft = takeDraft(c, GRANT_FORM)
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Rights"
        lede="Who holds which role or permission, where, and until when. Access decides with these."
      />
      <TenantTabs slug={slug} current="rights" />
      <HowRightsWork />
      <details
        class="card disclosure"
        open={draft !== null || (rows !== null && total === 0 && !isFiltered(filter))}
      >
        <summary>Grant a right</summary>
        <GrantForm
          tenant={slug}
          back={base}
          grants={every.rows}
          roles={roles.rows}
          users={users.rows}
          groups={groups.rows}
          consoleRoute={c.get('services').config.routeId}
          draft={draft}
        />
      </details>
      <form method="get" class="toolbar" aria-label="Filter the rights">
        {state !== 'live' ? <input type="hidden" name="state" value={state} /> : null}
        <label class="field">
          <span>Held by</span>
          <input name="holder" value={filter.holder} placeholder="a name, an e-mail or a group" />
        </label>
        <label class="field">
          <span>Role or permission</span>
          <input name="right" value={filter.right} class="mono" placeholder="content.read" />
        </label>
        <label class="field">
          <span>Workspace</span>
          <input
            name="workspace"
            value={filter.workspace}
            class="mono"
            placeholder="a part of its ID"
          />
        </label>
        <button type="submit" class="button quiet">
          Filter
        </button>
        {isFiltered(filter) ? (
          <a class="button quiet" href={query({ holder: '', right: '', workspace: '' })}>
            Clear
          </a>
        ) : null}
      </form>
      <nav class="segmented" aria-label="The state of the rights">
        {states.map((entry) => (
          <a
            href={query({ state: entry.id })}
            aria-current={state === entry.id ? 'true' : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {refusal ? <Refusal refusal={refusal} /> : null}
      {partial ? (
        <Notice tone="warn" title="The filter read the first thousand rights of the tenant">
          A right beyond them is not in this list.
        </Notice>
      ) : null}
      {rows && rows.length === 0 ? (
        <Empty>
          {isFiltered(filter)
            ? 'No right matches the filter.'
            : state === 'live'
              ? 'No live right yet. Grant one above.'
              : 'No right here.'}
        </Empty>
      ) : null}
      {rows && rows.length > 0 ? (
        <>
          <RightsTable
            showHolder
            roles={roles.rows}
            rows={rows.map((grant) => ({ grant, holder: holderOf(slug, grant, byId) }))}
            back={here}
          />
          <OffsetPager
            total={total}
            limit={limit}
            offset={offset}
            href={(next) => query({ offset: next })}
          />
        </>
      ) : null}
    </>,
    {
      title: `Rights of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Rights' }),
    }
  )
})
