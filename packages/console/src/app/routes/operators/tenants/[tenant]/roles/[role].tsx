/**
 * A role: what it holds in effect, who holds it, and its form.
 *
 * A role that a grant or another role names is not removed: Access
 * refuses the first, and the second would change what the naming role
 * holds. The page says which ones name it before the operator tries.
 */

import { createRoute } from 'honox/factory'
import { ACTIONS, permissionOf, reasonOf } from '../../../../../../domains/ability'
import { AccessError } from '../../../../../../domains/access'
import {
  administrationLostBy,
  administrationOf,
  expandRole,
  knownPermission,
  knownPermissionsOf,
  permissionsOfWrite,
  rolesIncluding,
} from '../../../../../../domains/operators'
import {
  adminFor,
  platformWrite,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import { Empty, KeyValues, Moment, Notice } from '../../../../../components/page'
import { holderOf, RightPlace, RightState, rightsViewOf } from '../../../../../components/rights'
import {
  CLOSES_ADMINISTRATION,
  closedFieldOf,
  ROLE_FORM,
  RoleForm,
  roleDraftOf,
  roleInputOf,
} from '../../../../../components/role-form'
import ConfirmButton from '../../../../../islands/confirm-button'
import { formOf } from '../../../../../middleware/forms'
import { flash, keepDraft, takeDraft } from '../../../../../middleware/session'

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const key = c.req.param('role') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const roles = await admin.all((offsets) => admin.roles({ tenant: slug, ...offsets }))
  const role = roles.rows.find((row) => row.key === key)
  if (!role) return c.notFound()
  const form = await formOf(c)
  const path = `${tenantPath(slug)}/roles/${encodeURIComponent(key)}`
  try {
    if (form.get('_action') === 'remove') {
      await admin.removeRole(role.id)
      flash(c, { kind: 'ok', text: `The role ${key} was removed.` })
      return c.redirect(`${tenantPath(slug)}/roles`)
    }
    const input = roleInputOf(form, slug)
    // A capability that is not relative to a tenant is the platform's:
    // only an operator that holds it may put it in a role — as it is, or
    // with a role that holds it — and the write is signed with the
    // credential of the platform.
    const write = await platformWrite(c, permissionsOfWrite(input, roles.rows))
    if (write.kind === 'refused') {
      keepDraft(c, roleDraftOf(form, [{ field: closedFieldOf(input), message: write.reason }]))
      flash(c, { kind: 'error', text: 'The role was not saved: the form needs a change.' })
      return c.redirect(path)
    }
    // A role written without the key that opens the administration
    // closes it to everybody who holds the role, the operator among
    // them: the console asks before it sends such a write.
    if (form.get(CLOSES_ADMINISTRATION) !== 'yes') {
      const [grants, users, groups] = await Promise.all([
        admin.all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets })),
        admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
        admin.all((offsets) => admin.groups({ tenant: slug, ...offsets })),
      ])
      const view = await rightsViewOf(c, slug, {
        grants: grants.rows,
        roles: roles.rows,
        groups: groups.rows,
        users: users.rows,
      })
      const lost = administrationLostBy(
        grants.rows,
        roles.rows,
        { key, permissions: input.permissions ?? [], roles: input.roles ?? [] },
        { tenant: slug, consoleRoute: view.consoleRoute }
      )
      if (lost.length > 0) {
        const yours = lost.some((grant) => view.ownAdministration.has(grant.id))
        keepDraft(
          c,
          roleDraftOf(form, [
            {
              field: CLOSES_ADMINISTRATION,
              message: `Saved like this, the role stops opening the administration of ${slug} to the holders of ${lost.length} live ${lost.length === 1 ? 'right' : 'rights'}${yours ? ', yours among them: your next page would be a refusal' : ''}. Only an operator who still administers ${slug}, or an operator of the platform, gives it back.`,
            },
          ])
        )
        flash(c, { kind: 'error', text: 'The role was not saved: the form asks a question first.' })
        return c.redirect(path)
      }
    }
    const client = write.kind === 'platform' ? write.client : admin
    await client.saveRole({ ...input, key })
    flash(c, { kind: 'ok', text: `The role ${key} was saved.` })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    if (form.get('_action') !== 'remove') {
      keepDraft(
        c,
        roleDraftOf(
          form,
          error.status === 409
            ? [
                {
                  field: 'roles',
                  message: 'A role cannot include itself, directly or through others.',
                },
              ]
            : []
        )
      )
    }
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
  }
  return c.redirect(path)
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const key = c.req.param('role') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const [roles, grants, users, groups] = await Promise.all([
    admin.all((offsets) => admin.roles({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.grants({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.groups({ tenant: slug, ...offsets })),
  ])
  const role = roles.rows.find((row) => row.key === key)
  if (!role) return c.notFound()
  const view = await rightsViewOf(c, slug, {
    grants: grants.rows,
    roles: roles.rows,
    groups: groups.rows,
    users: users.rows,
  })
  const path = `${tenantPath(slug)}/roles/${encodeURIComponent(key)}`
  const byId = new Map(users.rows.map((user) => [user.id, user]))
  const holds = expandRole(key, roles.rows)
  // A permission the role holds — itself, or through a role it includes —
  // and that is not the operator's to give: the role is not saved while
  // it holds it, and the page says so first.
  const closed =
    holds
      .map((entry) => ({
        reason: reasonOf(view.ability, ACTIONS.give, permissionOf(entry.permission)),
        through: entry.path.slice(1),
      }))
      .find((entry) => entry.reason !== null) ?? null
  const byPermission = new Map<string, string[][]>()
  for (const entry of holds) {
    byPermission.set(entry.permission, [...(byPermission.get(entry.permission) ?? []), entry.path])
  }
  const naming = grants.rows.filter((grant) => grant.role === key)
  const live = naming.filter((grant) => !grant.revokedAt)
  const includedBy = rolesIncluding(key, roles.rows).filter((entry) => entry.roles.includes(key))
  const removable = naming.length === 0 && includedBy.length === 0
  const name = role.displayName ?? role.key
  const draft = takeDraft(c, ROLE_FORM)
  // The rights that open the administration of the tenant through this
  // role: what a save without the key would close.
  const place = { tenant: slug, consoleRoute: view.consoleRoute }
  const opening = grants.rows.filter((grant) =>
    administrationOf(grant, roles.rows, place)?.roles.includes(key)
  )
  const yours = opening.some((grant) => view.ownAdministration.has(grant.id))

  return c.render(
    <>
      <TenantHead slug={slug} title={name} lede={role.description ?? undefined} />
      <TenantTabs slug={slug} current="roles" />
      <div class="split">
        <div class="stack">
          <section class="card">
            <h2>Edit role</h2>
            {closed ? (
              <Notice tone="warn" title="This role holds a permission that is not yours to give">
                {closed.reason}{' '}
                {closed.through.length > 0
                  ? `The role holds it through ${closed.through.join(' → ')}: save it without that role, or ask an operator of the platform.`
                  : 'Save it without that permission, or ask an operator of the platform.'}
              </Notice>
            ) : null}
            {opening.length > 0 ? (
              <p class="small muted">
                This role opens the administration of {slug} to the holders of {opening.length} live{' '}
                {opening.length === 1 ? 'right' : 'rights'}
                {yours ? ', yours among them' : ''}. A save that would close it asks first.
              </p>
            ) : null}
            <RoleForm
              action={path}
              role={role}
              roles={roles.rows}
              permissions={knownPermissionsOf(grants.rows, roles.rows)}
              draft={draft}
            />
          </section>
          <section class="card">
            <header>
              <h2>Holds in effect</h2>
              <span class="small muted">
                {byPermission.size} {byPermission.size === 1 ? 'permission' : 'permissions'}
              </span>
            </header>
            {byPermission.size === 0 ? (
              <Empty>The role holds no permission: a grant of it gives nothing.</Empty>
            ) : (
              <div class="table-wrap">
                <table class="effective">
                  <thead>
                    <tr>
                      <th>Permission</th>
                      <th>What it opens</th>
                      <th>Comes from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...byPermission]
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([permission, paths]) => (
                        <tr>
                          <td>
                            <code>{permission}</code>
                          </td>
                          <td class="small">
                            {knownPermission(permission)?.opens ?? (
                              <span class="muted">Data's policies decide.</span>
                            )}
                          </td>
                          <td class="small">
                            {paths.map((chain) => (
                              <div class="source">
                                {chain.length === 1 ? (
                                  <span>this role</span>
                                ) : (
                                  <span class="muted">included {chain.slice(1).join(' → ')}</span>
                                )}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section class="card">
            <header>
              <h2>Granted to</h2>
              <a class="small" href={`${tenantPath(slug)}/rights?right=${encodeURIComponent(key)}`}>
                Open in Rights
              </a>
            </header>
            {live.length === 0 ? (
              <Empty>Nobody holds this role.</Empty>
            ) : (
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Held by</th>
                      <th>Where</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((grant) => {
                      const holder = holderOf(slug, grant, byId, view.caller)
                      return (
                        <tr>
                          <td>
                            {holder.kind === 'group' ? (
                              <span class="small muted">group </span>
                            ) : null}
                            {holder.href ? <a href={holder.href}>{holder.label}</a> : holder.label}
                          </td>
                          <td>
                            <RightPlace grant={grant} view={view} />
                          </td>
                          <td>
                            <RightState grant={grant} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <aside class="stack">
          <section class="card">
            <h2>Role</h2>
            <KeyValues
              rows={[
                ['Key', <code>{role.key}</code>],
                [
                  'Included by',
                  includedBy.length === 0 ? (
                    <span class="muted">no role</span>
                  ) : (
                    <div class="chips">
                      {includedBy.map((entry) => (
                        <a
                          class="chip"
                          href={`${tenantPath(slug)}/roles/${encodeURIComponent(entry.key)}`}
                        >
                          {entry.displayName ?? entry.key}
                        </a>
                      ))}
                    </div>
                  ),
                ],
                ['Created', <Moment at={role.createdAt} />],
              ]}
            />
          </section>
          <section class="card">
            <h2>Remove</h2>
            {removable ? (
              <form method="post" class="form">
                <input type="hidden" name="_action" value="remove" />
                <p class="small muted">Nothing names this role: removing it changes no access.</p>
                <div class="row">
                  <ConfirmButton
                    label="Remove role"
                    message={`Remove the role ${key}? It cannot be undone.`}
                  />
                </div>
              </form>
            ) : (
              <p class="small muted">
                {naming.length > 0
                  ? `${naming.length} ${naming.length === 1 ? 'grant names' : 'grants name'} this role${live.length < naming.length ? ', revoked ones included' : ''}. `
                  : ''}
                {includedBy.length > 0
                  ? `${includedBy.length === 1 ? 'Another role includes' : `${includedBy.length} roles include`} it. `
                  : ''}
                A role is removed once nothing names it.
              </p>
            )}
          </section>
        </aside>
      </div>
    </>,
    {
      title: name,
      section: 'operators',
      crumbs: tenantCrumbs(
        slug,
        { label: 'Roles', href: `${tenantPath(slug)}/roles` },
        { label: role.key }
      ),
    }
  )
})
