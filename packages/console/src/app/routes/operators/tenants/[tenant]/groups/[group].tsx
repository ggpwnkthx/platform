/**
 * A group: its members and its rights.
 *
 * The membership is written whole: the access service replaces the
 * members of a group with the ones the form names.
 */

import { createRoute } from 'honox/factory'
import { AccessError } from '../../../../../../domains/access'
import { isLive } from '../../../../../../domains/operators'
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
import { Empty, KeyValues, Moment, Notice } from '../../../../../components/page'
import MemberPicker from '../../../../../islands/member-picker'
import { formOf } from '../../../../../middleware/forms'
import { flash } from '../../../../../middleware/session'

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const key = c.req.param('group') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const form = await formOf(c)
  const path = `${tenantPath(slug)}/groups/${encodeURIComponent(key)}`
  try {
    const members = [
      ...new Set(
        form
          .all('members')
          .map((member) => member.trim())
          .filter(Boolean)
      ),
    ]
    const group = await access.admin.saveGroup({
      tenant: slug,
      key,
      ...(form.get('displayName').trim() ? { displayName: form.get('displayName').trim() } : {}),
      members,
    })
    flash(c, { kind: 'ok', text: `The group holds ${group.members.length} members.` })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
  }
  return c.redirect(path)
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const key = c.req.param('group') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const [page, users, grants] = await Promise.all([
    admin.groups({ tenant: slug, key, limit: 1 }),
    admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.grants({ tenant: slug, ...offsets })),
  ])
  const group = page.rows.find((row) => row.key === key)
  if (!group) return c.notFound()
  const path = `${tenantPath(slug)}/groups/${encodeURIComponent(key)}`
  const rights = grants.rows.filter((grant) => grant.group === key && isLive(grant))
  const byIdentity = new Map(users.rows.map((user) => [user.externalSubject, user]))
  const unknown = group.members.filter((member) => !byIdentity.has(member))

  return c.render(
    <>
      <TenantHead slug={slug} title={group.displayName ?? group.key} />
      <TenantTabs slug={slug} current="groups" />
      <div class="split">
        <div class="stack">
          <section class="card">
            <h2>Members</h2>
            {!users.complete ? (
              <Notice tone="warn" title="The tenant holds more than a thousand users">
                The picker offers the first thousand: a member of the others is named by its
                identity at the provider.
              </Notice>
            ) : null}
            <form method="post" class="form">
              <MemberPicker
                name="members"
                candidates={users.rows.map((user) => ({
                  subject: user.externalSubject,
                  label:
                    user.email && user.displayName
                      ? `${user.displayName} (${user.email})`
                      : userLabel(user),
                }))}
                selected={group.members}
              />
              <label class="field">
                <span>Name of the group</span>
                <input name="displayName" value={group.displayName ?? ''} />
              </label>
              <div class="row">
                <button type="submit" class="button">
                  Save the members
                </button>
                <span class="small muted">The membership is replaced with the one above.</span>
              </div>
            </form>
            {unknown.length > 0 ? (
              <p class="small muted">
                {unknown.length} members are not users the console read: {unknown.join(', ')}
              </p>
            ) : null}
          </section>
          <section class="card">
            <h2>Group rights</h2>
            {rights.length === 0 ? (
              <Empty>The group holds no right.</Empty>
            ) : (
              <RightsTable rows={rights.map((grant) => ({ grant }))} back={path} />
            )}
            <details class="disclosure">
              <summary>Grant a right to the group</summary>
              <GrantForm tenant={slug} back={path} fixedGroup={key} known={knownOf(grants.rows)} />
            </details>
          </section>
        </div>
        <aside class="card">
          <h2>Group</h2>
          <KeyValues
            rows={[
              ['Key', <code>{group.key}</code>],
              ['Members', String(group.members.length)],
              ['Created', <Moment at={group.createdAt} />],
            ]}
          />
        </aside>
      </div>
    </>,
    {
      title: group.displayName ?? group.key,
      section: 'operators',
      crumbs: tenantCrumbs(
        slug,
        { label: 'Groups', href: `${tenantPath(slug)}/groups` },
        { label: group.key }
      ),
    }
  )
})
