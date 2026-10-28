/**
 * The groups of a tenant. A right of a group is a right of every member
 * of it.
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

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const form = await formOf(c)
  const key = form.get('key').trim()
  try {
    const group = await access.admin.saveGroup({
      tenant: slug,
      key,
      ...(form.get('displayName').trim() ? { displayName: form.get('displayName').trim() } : {}),
      members: [],
    })
    flash(c, { kind: 'ok', text: `The group ${group.key} was created. Add its members.` })
    return c.redirect(`${tenantPath(slug)}/groups/${encodeURIComponent(group.key)}`)
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
    return c.redirect(`${tenantPath(slug)}/groups`)
  }
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
  const limit = 50
  const base = `${tenantPath(slug)}/groups`
  let page = null
  let refusal = null
  try {
    page = await access.admin.groups({ tenant: slug, limit, offset })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  return c.render(
    <>
      <TenantHead
        slug={slug}
        title="Groups"
        lede="A right granted to a group is held by every member."
      />
      <TenantTabs slug={slug} current="groups" />
      {refusal ? <Refusal refusal={refusal} /> : null}
      {page && page.rows.length === 0 ? <Empty>The tenant has no group.</Empty> : null}
      {page && page.rows.length > 0 ? (
        <>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th class="num">Members</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((group) => (
                  <tr>
                    <td>
                      <a href={`${base}/${encodeURIComponent(group.key)}`}>
                        <strong>{group.displayName ?? group.key}</strong>
                      </a>
                      <div class="small muted mono">{group.key}</div>
                    </td>
                    <td class="num">{group.members.length}</td>
                    <td class="small">
                      <Moment at={group.createdAt} />
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
      <section class="card" style="max-width: 40rem">
        <h2>Create a group</h2>
        <form method="post" class="toolbar">
          <label class="field">
            <span>Key</span>
            <input
              name="key"
              required
              pattern="[a-z0-9][a-z0-9._\-]{0,63}"
              class="mono"
              placeholder="team-platform"
            />
          </label>
          <label class="field">
            <span>Name</span>
            <input name="displayName" placeholder="The platform team" />
          </label>
          <button type="submit" class="button">
            Create
          </button>
        </form>
      </section>
    </>,
    {
      title: `Groups of ${slug}`,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Groups' }),
    }
  )
})
