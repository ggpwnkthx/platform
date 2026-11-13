/**
 * The roles of a tenant: the named sets of permissions, and the roles
 * they include.
 *
 * The page has two views. The list names every role with what it holds;
 * the grid sets the roles against the permissions of the tenant, and the
 * operator ticks and clears cells to change several roles in one save.
 *
 * A role is created here and changed on its own page, or in the grid.
 * The creation refuses a key that is already a role: Access upserts by
 * key, and the form would otherwise replace the role it names without a
 * word. The grid is read as what the operator changed, and a permission
 * that is not the operator's to give is refused with the reason of the
 * rule, like everywhere else.
 */

import type { Context } from 'hono'
import { createRoute } from 'honox/factory'
import { ACTIONS, permissionOf, reasonOf } from '../../../../../../domains/ability'
import { AccessError, type AdminClient } from '../../../../../../domains/access'
import {
  administrationLostBy,
  administrationOf,
  KEY_PATTERN,
  knownPermissionsOf,
  type MatrixColumn,
  matrixChangesOf,
  matrixOf,
  permissionsOfRole,
  permissionsOfWrite,
} from '../../../../../../domains/operators'
import {
  cellKey,
  MATRIX_ACTION,
  type MatrixLocks,
  RoleMatrix,
} from '../../../../../components/matrix'
import {
  adminFor,
  HowRightsWork,
  platformWrite,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import { Empty, Moment, Refusal, refusalOf } from '../../../../../components/page'
import { rightsViewOf } from '../../../../../components/rights'
import {
  closedFieldOf,
  ROLE_FORM,
  RoleForm,
  roleDraftOf,
  roleInputOf,
} from '../../../../../components/role-form'
import { formOf, type SentForm } from '../../../../../middleware/forms'
import { flash, keepDraft, takeDraft } from '../../../../../middleware/session'

const KEY = new RegExp(`^${KEY_PATTERN}$`)

/** The path of the grid of the roles of a tenant. */
function matrixPath(slug: string): string {
  return `${tenantPath(slug)}/roles?view=matrix`
}

/**
 * Saves a grid: the roles whose cells changed, and no other.
 *
 * Every role is written on its own, with the client its permissions
 * call for. A role that is refused does not stop the others, and the
 * page says what happened to each one.
 */
async function saveMatrix(c: Context, admin: AdminClient, slug: string, form: SentForm) {
  const back = matrixPath(slug)
  const roles = await admin.all((offsets) => admin.roles({ tenant: slug, ...offsets }))
  // The keys come from the form: the record has no prototype to name.
  const columns: Record<string, MatrixColumn> = Object.create(null)
  for (const key of form.all('role')) {
    columns[key] = {
      shown: form.get(`shown:${key}`).split('\n').filter(Boolean),
      ticked: form.all(`perm:${key}`),
    }
  }

  // The permission the tenant does not name yet: the key of the last
  // row, given to the roles whose cell is ticked.
  const fresh = form.get('new').trim()
  const givenTo = Object.keys(columns).filter((key) => form.has(`new:${key}`))
  if (fresh !== '' || givenTo.length > 0) {
    const problem =
      fresh === ''
        ? 'Name the new permission, or clear the cells of its row.'
        : !KEY.test(fresh)
          ? 'A permission is lower-case letters, digits, dots, dashes and underscores.'
          : roles.rows.some((role) => role.key === fresh)
            ? `${fresh} is a role: a role includes it on its own page.`
            : givenTo.length === 0
              ? `Tick the roles that hold ${fresh}: a permission no role holds is not created.`
              : null
    if (problem) {
      flash(c, { kind: 'error', text: 'The grid was not saved.', detail: problem })
      return c.redirect(back)
    }
    for (const key of givenTo) {
      const column = columns[key]
      if (column) columns[key] = { ...column, ticked: [...column.ticked, fresh] }
    }
  }

  const changes = matrixChangesOf(roles.rows, columns)
  if (changes.length === 0) {
    flash(c, { kind: 'ok', text: 'Nothing changed: no role was written.' })
    return c.redirect(back)
  }
  // A change that takes a permission away may close the administration
  // to the holders of a role: the grid draws that cell closed, and the
  // write is refused here whatever the form says. The page of the role
  // asks first, and sends it.
  const grants = changes.some((change) => change.removed.length > 0)
    ? await admin.all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets }))
    : null
  const place = { tenant: slug, consoleRoute: c.get('services').config.routeId }
  const saved: string[] = []
  const refused: string[] = []
  for (const change of changes) {
    const { role } = change
    const closing = grants
      ? administrationLostBy(
          grants.rows,
          roles.rows,
          { key: role.key, permissions: change.permissions, roles: role.roles },
          place
        ).length
      : 0
    if (closing > 0) {
      refused.push(
        `${role.key}: the change closes the administration of ${slug} to the holders of ${closing} live ${closing === 1 ? 'right' : 'rights'}. Make it on the page of the role, where the console asks first.`
      )
      continue
    }
    // A capability of the platform is the platform's to give: the role
    // that holds one — itself, or through a role it includes — is
    // written with the credential of the platform, by an operator that
    // holds it.
    const write = await platformWrite(
      c,
      permissionsOfWrite({ permissions: change.permissions, roles: role.roles }, roles.rows)
    )
    if (write.kind === 'refused') {
      refused.push(`${role.key}: ${write.reason}`)
      continue
    }
    try {
      await (write.kind === 'platform' ? write.client : admin).saveRole({
        tenant: slug,
        key: role.key,
        displayName: role.displayName,
        description: role.description,
        permissions: change.permissions,
        roles: role.roles,
      })
      saved.push(
        `${role.key} ${[
          change.added.length > 0 ? `+${change.added.join(' +')}` : '',
          change.removed.length > 0 ? `−${change.removed.join(' −')}` : '',
        ]
          .filter(Boolean)
          .join(' ')}`
      )
    } catch (error) {
      if (!(error instanceof AccessError) || error.status >= 500) throw error
      refused.push(`${role.key}: ${error.message}`)
    }
  }
  flash(c, {
    kind: refused.length > 0 ? 'error' : 'ok',
    text:
      saved.length > 0
        ? `Saved ${saved.length} ${saved.length === 1 ? 'role' : 'roles'}: ${saved.join(' · ')}.`
        : 'No role was saved.',
    ...(refused.length > 0 ? { detail: `Not saved — ${refused.join(' · ')}` } : {}),
  })
  return c.redirect(back)
}

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const form = await formOf(c)
  if (form.get('_action') === MATRIX_ACTION) return saveMatrix(c, admin, slug, form)
  const base = `${tenantPath(slug)}/roles`
  const input = roleInputOf(form, slug)
  const existing = await admin.all((offsets) => admin.roles({ tenant: slug, ...offsets }))
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
    // A capability that is not relative to a tenant is the platform's:
    // only an operator that holds it may put it in a role — as it is, or
    // with a role that holds it — and the write is signed with the
    // credential of the platform.
    const write = await platformWrite(c, permissionsOfWrite(input, existing.rows))
    if (write.kind === 'refused') {
      keepDraft(c, roleDraftOf(form, [{ field: closedFieldOf(input), message: write.reason }]))
      flash(c, { kind: 'error', text: `The role ${input.key} was not created.` })
      return c.redirect(base)
    }
    const client = write.kind === 'platform' ? write.client : admin
    const role = await client.saveRole(input)
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
  const matrix = c.req.query('view') === 'matrix'
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
  const permissions = knownPermissionsOf(grants?.rows ?? [], all)
  const draft = takeDraft(c, ROLE_FORM)
  const grantsOf = (key: string) =>
    grants ? grants.rows.filter((grant) => grant.role === key).length : null

  // What the operator may not change in the grid: a permission that is
  // not its to give, a role that holds one, and the permission that
  // opens the administration to the operator itself.
  let locks: MatrixLocks | null = null
  if (matrix && roles) {
    const [users, groups] = await Promise.all([
      admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
      admin.all((offsets) => admin.groups({ tenant: slug, ...offsets })),
    ])
    const view = await rightsViewOf(c, slug, {
      grants: grants?.rows ?? [],
      roles: all,
      groups: groups.rows,
      users: users.rows,
    })
    const closed = new Map<string, string>()
    for (const key of permissions) {
      const reason = reasonOf(view.ability, ACTIONS.give, permissionOf(key))
      if (reason) closed.set(key, reason)
    }
    const closedRoles = new Map<string, string>()
    for (const role of all) {
      const held = permissionsOfRole(role.key, all).find((key) => closed.has(key))
      if (held) {
        closedRoles.set(
          role.key,
          `This role holds ${held}, a capability of the platform: only an operator of the platform changes it.`
        )
      }
    }
    // The cell that opens the administration to the holders of a live
    // right: clearing it closes the administration to all of them, the
    // operator among them when the right is its own.
    const cells = new Map<string, string>()
    const place = { tenant: slug, consoleRoute: view.consoleRoute }
    const own = new Set<string>()
    for (const grant of grants?.rows ?? []) {
      const how = administrationOf(grant, all, place)
      const owner = how?.roles.at(-1)
      if (!how || !owner) continue
      const cell = cellKey(owner, how.key)
      if (view.ownAdministration.has(grant.id)) own.add(cell)
      cells.set(
        cell,
        own.has(cell)
          ? `This is how you administer ${slug} yourself. Change it on the page of the role, where the console asks first.`
          : `This opens the administration of ${slug} to the holders of the role. Change it on the page of the role, where the console asks first.`
      )
    }
    locks = { roles: closedRoles, permissions: closed, cells }
  }

  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Roles"
        lede="A role is a named set of permissions, and can include other roles. Grant a role to a user or a group on the Rights tab."
      />
      <TenantTabs slug={slug} current="roles" />
      <HowRightsWork />
      <nav class="segmented" aria-label="The view of the roles">
        <a href={base} aria-current={matrix ? undefined : 'true'}>
          List
        </a>
        <a href={matrixPath(slug)} aria-current={matrix ? 'true' : undefined}>
          Permissions by role
        </a>
      </nav>
      {refusal ? <Refusal refusal={refusal} /> : null}
      {roles && all.length === 0 ? (
        <Empty>No role yet. Create one below to grant many permissions at once.</Empty>
      ) : null}
      {matrix && locks && sorted.length > 0 ? (
        <>
          <RoleMatrix
            tenant={slug}
            action={matrixPath(slug)}
            families={matrixOf(sorted, permissions)}
            roles={sorted}
            locks={locks}
          />
          <p class="small muted">
            <strong>via</strong> marks a permission a role holds through a role it includes: it is
            changed in the column of that role. A closed cell says why when you point at it.
          </p>
        </>
      ) : null}
      {!matrix && sorted.length > 0 ? (
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
                    <td class="num">
                      {grantsOf(role.key) === null ? (
                        '—'
                      ) : (
                        <a
                          href={`${tenantPath(slug)}/rights?right=${encodeURIComponent(role.key)}`}
                        >
                          {grantsOf(role.key)}
                        </a>
                      )}
                    </td>
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
        <summary class="act">Create a role</summary>
        <RoleForm action={base} roles={all} permissions={permissions} draft={draft} />
      </details>
    </>,
    {
      title: `Roles of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Roles' }),
    }
  )
})
