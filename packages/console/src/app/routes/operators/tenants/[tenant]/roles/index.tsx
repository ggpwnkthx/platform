/**
 * The roles of a tenant: the named sets of permissions, and the roles
 * they name.
 *
 * A role is granted to a user or to a group on the page of the rights:
 * a grant of a role holds the permissions of the role.
 */

import { createRoute } from 'honox/factory'
import { AccessError } from '../../../../../../domains/access'
import {
  adminFor,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import { Empty, Moment, OffsetPager, Refusal, refusalOf } from '../../../../../components/page'
import { formOf } from '../../../../../middleware/forms'
import { flash } from '../../../../../middleware/session'

/** The list of the permissions and of the roles, separated by a comma. */
function listOf(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const form = await formOf(c)
  const key = form.get('key').trim()
  const back = `${tenantPath(slug)}/roles`
  try {
    const role = await access.admin.saveRole({
      tenant: slug,
      key,
      ...(form.get('displayName').trim() ? { displayName: form.get('displayName').trim() } : {}),
      ...(form.get('description').trim() ? { description: form.get('description').trim() } : {}),
      permissions: listOf(form.get('permissions').trim()),
      roles: listOf(form.get('roles').trim()),
    })
    flash(c, { kind: 'ok', text: `The role ${role.key} was saved.` })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
  }
  return c.redirect(back)
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
  const limit = 50
  const base = `${tenantPath(slug)}/roles`
  let page = null
  let refusal = null
  try {
    page = await access.admin.roles({ tenant: slug, limit, offset })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const known = new Set((page?.rows ?? []).map((role) => role.key))
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Roles"
        lede="A role is a named set of permissions. A role may name another role: the permissions of the named role are the permissions of the role that names it. A right of a role is granted on the page of the rights."
      />
      <TenantTabs slug={slug} current="roles" />
      {refusal ? <Refusal refusal={refusal} /> : null}
      {page && page.rows.length === 0 ? <Empty>The tenant has no role.</Empty> : null}
      {page && page.rows.length > 0 ? (
        <>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Permissions</th>
                  <th>Names</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((role) => (
                  <tr>
                    <td>
                      <strong>{role.displayName ?? role.key}</strong>
                      <div class="small muted mono">{role.key}</div>
                    </td>
                    <td class="small">
                      {role.permissions.length > 0 ? (
                        <div class="chips">
                          {role.permissions.map((permission) => (
                            <span class="chip">
                              <code>{permission}</code>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span class="muted">none</span>
                      )}
                    </td>
                    <td class="small">
                      {role.roles.length > 0 ? (
                        <div class="chips">
                          {role.roles.map((named) => (
                            <span class="chip">
                              <code>{named}</code>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span class="muted">none</span>
                      )}
                    </td>
                    <td class="small">
                      <Moment at={role.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <OffsetPager
            total={page.total}
            limit={limit}
            offset={offset}
            href={(next) => (next > 0 ? `${base}?offset=${next}` : base)}
          />
        </>
      ) : null}
      <section class="card">
        <h2>Save a role</h2>
        <form method="post" action={base} class="form">
          <div class="form-grid">
            <label class="field">
              <span>Key</span>
              <input name="key" required placeholder="role-editor" class="mono" />
            </label>
            <label class="field">
              <span>Name</span>
              <input name="displayName" placeholder="The editors" />
            </label>
            <label class="field">
              <span>Permissions</span>
              <input
                name="permissions"
                placeholder="workspace.read, workspace.write"
                list="known-permissions"
                class="mono"
              />
              <datalist id="known-permissions">
                {[...known].map((role) => (
                  <option value={role} />
                ))}
              </datalist>
            </label>
            <label class="field">
              <span>Names</span>
              <input name="roles" placeholder="role-reader" class="mono" />
            </label>
          </div>
          <p class="small muted">
            The permissions and the roles are separated by a comma. The call replaces them: what is
            not in the list is not held by the role any more.
          </p>
          <div class="row">
            <button type="submit" class="button">
              Save the role
            </button>
          </div>
        </form>
      </section>
    </>,
    {
      title: `Roles of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Roles' }),
    }
  )
})
