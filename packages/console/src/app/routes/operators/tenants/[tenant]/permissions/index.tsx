/**
 * The permissions of a tenant: every one of them, what it opens, and
 * who holds it.
 *
 * The page is the reference of the administration. The forms that grant
 * a right and write a role choose among these permissions; here the
 * operator reads them all at once, family by family, with the roles
 * that hold each one and the live rights that give it.
 *
 * Nothing is changed here: a role is changed on the Roles tab, and a
 * right is granted on the Rights tab.
 */

import { createRoute } from 'honox/factory'
import {
  permissionCatalogOf,
  permissionFamiliesOf,
  permissionUseOf,
} from '../../../../../../domains/operators'
import {
  adminFor,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../../components/operators'
import { Empty, Notice } from '../../../../../components/page'
import { PermissionLabel } from '../../../../../components/permission-picker'
import { deploymentCapabilities } from '../../../../../middleware/capabilities'

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const base = tenantPath(slug)
  const [roles, grants, deployment] = await Promise.all([
    admin.all((offsets) => admin.roles({ tenant: slug, ...offsets })).catch(() => null),
    admin
      .all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets }))
      .catch(() => null),
    deploymentCapabilities(c, slug),
  ])
  const all = roles?.rows ?? []
  const live = grants?.rows ?? []
  const needle = (c.req.query('q') ?? '').trim().toLowerCase()
  const catalog = permissionCatalogOf(live, { roles: all, capabilities: deployment.capabilities })
  const shown = catalog.filter(
    (entry) =>
      needle === '' ||
      entry.key.toLowerCase().includes(needle) ||
      (entry.opens ?? '').toLowerCase().includes(needle)
  )
  const families = permissionFamiliesOf(shown)

  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Permissions"
        lede="Every permission of the tenant: what it opens, where a right has to hold to open it, and who holds it."
      />
      <TenantTabs slug={slug} current="permissions" />
      {deployment.unavailable ? (
        <Notice tone="warn" title="The capabilities of the deployment are not listed">
          {deployment.unavailable} A permission of the records is shown without what it opens.
        </Notice>
      ) : null}
      {grants && !grants.complete ? (
        <Notice tone="warn" title="The page read the first thousand rights of the tenant">
          A right beyond them is not counted.
        </Notice>
      ) : null}
      <form method="get" class="toolbar" aria-label="Filter the permissions">
        <label class="field">
          <span>Permission</span>
          <input
            name="q"
            type="search"
            value={c.req.query('q') ?? ''}
            placeholder="a key, or a word of what it opens"
          />
        </label>
        <button type="submit" class="button quiet">
          Filter
        </button>
      </form>
      {shown.length === 0 ? <Empty>No permission matches the filter.</Empty> : null}
      {shown.length > 0 ? (
        <div class="table-wrap">
          <table class="permissions">
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Roles that hold it</th>
                <th scope="col" class="num">
                  Live rights
                </th>
              </tr>
            </thead>
            {families.map((family) => (
              <tbody>
                <tr>
                  <th colspan={3} scope="colgroup" class="matrix-family-name">
                    {family.family}
                  </th>
                </tr>
                {family.entries.map((entry) => {
                  const use = permissionUseOf(entry.key, live, all)
                  return (
                    <tr>
                      <td>
                        <PermissionLabel entry={entry} />
                      </td>
                      <td class="small">
                        {use.roles.length === 0 ? (
                          <span class="muted">no role</span>
                        ) : (
                          <div class="chips">
                            {use.roles.map((role) => (
                              <a class="chip" href={`${base}/roles/${encodeURIComponent(role)}`}>
                                <code>{role}</code>
                              </a>
                            ))}
                          </div>
                        )}
                      </td>
                      <td class="num">
                        {grants === null ? (
                          '—'
                        ) : (
                          <a
                            href={`${base}/rights?right=${encodeURIComponent(entry.key)}`}
                            title="The live rights that give it, the grants of the roles that hold it among them"
                          >
                            {use.rights}
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}
      <p class="small muted">
        Change what a role holds on the <a href={`${base}/roles?view=matrix`}>Roles</a> tab, and
        give a permission to someone on the <a href={`${base}/rights?grant=1#grant`}>Rights</a> tab.
      </p>
    </>,
    {
      title: `Permissions of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Permissions' }),
    }
  )
})
