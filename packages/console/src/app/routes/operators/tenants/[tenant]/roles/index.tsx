/**
 * The roles of a tenant: the named sets of permissions, and the roles
 * they include.
 *
 * A role is created here and changed on its own page. The creation
 * refuses a key that is already a role: Access upserts by key, and the
 * form would otherwise replace the role it names without a word.
 */

import { createRoute } from 'honox/factory'
import { AccessError } from '../../../../../../domains/access'
import { knownPermissionsOf, permissionsOfRole } from '../../../../../../domains/operators'
import {
  adminFor,
  HowRightsWork,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import { Empty, Moment, Refusal, refusalOf } from '../../../../../components/page'
import { ROLE_FORM, RoleForm, roleDraftOf, roleInputOf } from '../../../../../components/role-form'
import { formOf } from '../../../../../middleware/forms'
import { flash, keepDraft, takeDraft } from '../../../../../middleware/session'

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const form = await formOf(c)
  const base = `${tenantPath(slug)}/roles`
  const input = roleInputOf(form, slug)
  const existing = await admin.roles({ tenant: slug, key: input.key, limit: 1 })
  if (existing.rows.some((role) => role.key === input.key)) {
    keepDraft(
      c,
      roleDraftOf(form, [
        { field: 'key', message: `A role ${input.key} exists already: change it on its page.` },
      ])
    )
    flash(c, { kind: 'error', text: `The role ${input.key} was not created.` })
    return c.redirect(base)
  }
  try {
    const role = await admin.saveRole(input)
    flash(c, { kind: 'ok', text: `The role ${role.key} was created. Grant it on the Rights tab.` })
    return c.redirect(`${base}/${encodeURIComponent(role.key)}`)
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    keepDraft(c, roleDraftOf(form, []))
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
    return c.redirect(base)
  }
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const base = `${tenantPath(slug)}/roles`
  let roles = null
  let refusal = null
  try {
    roles = await admin.all((offsets) => admin.roles({ tenant: slug, ...offsets }))
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const grants = await admin
    .all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets }))
    .catch(() => null)
  const all = roles?.rows ?? []
  const sorted = [...all].sort((left, right) => left.key.localeCompare(right.key))
  const draft = takeDraft(c, ROLE_FORM)
  const grantsOf = (key: string) =>
    grants ? grants.rows.filter((grant) => grant.role === key).length : null
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Roles"
        lede="A role is a named set of permissions, and can include other roles. Grant a role to a user or a group on the Rights tab."
      />
      <TenantTabs slug={slug} current="roles" />
      <HowRightsWork />
      {refusal ? <Refusal refusal={refusal} /> : null}
      {roles && all.length === 0 ? (
        <Empty>No role yet. Create one below to grant many permissions at once.</Empty>
      ) : null}
      {sorted.length > 0 ? (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Holds</th>
                <th>Includes</th>
                <th class="num">Live grants</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((role) => {
                const holds = permissionsOfRole(role.key, all)
                return (
                  <tr>
                    <td>
                      <a href={`${base}/${encodeURIComponent(role.key)}`}>
                        <strong>{role.displayName ?? role.key}</strong>
                      </a>
                      <div class="small muted mono">{role.key}</div>
                      {role.description ? <div class="small">{role.description}</div> : null}
                    </td>
                    <td class="small">
                      {holds.length === 0 ? (
                        <span class="muted">no permission</span>
                      ) : (
                        <div class="chips" title={holds.join(', ')}>
                          {holds.slice(0, 4).map((permission) => (
                            <span class="chip">
                              <code>{permission}</code>
                            </span>
                          ))}
                          {holds.length > 4 ? (
                            <span class="muted">+{holds.length - 4} more</span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td class="small">
                      {role.roles.length > 0 ? (
                        <div class="chips">
                          {role.roles.map((named) => (
                            <a class="chip" href={`${base}/${encodeURIComponent(named)}`}>
                              <code>{named}</code>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span class="muted">—</span>
                      )}
                    </td>
                    <td class="num">{grantsOf(role.key) ?? '—'}</td>
                    <td class="small">
                      <Moment at={role.createdAt} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <details
        class="card disclosure"
        open={draft !== null || (roles !== null && all.length === 0)}
      >
        <summary>Create a role</summary>
        <RoleForm
          action={base}
          roles={all}
          permissions={knownPermissionsOf(grants?.rows ?? [], all)}
          draft={draft}
        />
      </details>
    </>,
    {
      title: `Roles of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Roles' }),
    }
  )
})
