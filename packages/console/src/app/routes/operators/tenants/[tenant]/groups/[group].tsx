/**
 * A group: its members and its rights.
 *
 * The membership is written whole: Access replaces the members of a
 * group with the ones the form names. The picker says what changed and
 * is not saved yet, and the browser asks before the page is left with
 * those changes. The name of the group is changed on its own, with the
 * members it already has.
 */

import { createRoute } from 'honox/factory'
import { AccessError, type AdminClient } from '../../../../../../domains/access'
import { isLive } from '../../../../../../domains/operators'
import {
  adminFor,
  GRANT_FORM,
  GrantForm,
  RightsTable,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
  userLabel,
} from '../../../../../components/operators'
import { Empty, KeyValues, Moment, Notice } from '../../../../../components/page'
import ChipPicker from '../../../../../islands/chip-picker'
import { formOf } from '../../../../../middleware/forms'
import { flash, takeDraft } from '../../../../../middleware/session'

async function groupOf(admin: AdminClient, tenant: string, key: string) {
  const page = await admin.groups({ tenant, key, limit: 1 })
  return page.rows.find((row) => row.key === key) ?? null
}

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const key = c.req.param('group') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const form = await formOf(c)
  const path = `${tenantPath(slug)}/groups/${encodeURIComponent(key)}`
  const current = await groupOf(access.admin, slug, key)
  if (!current) return c.notFound()
  try {
    if (form.get('_action') === 'rename') {
      const name = form.get('displayName').trim()
      await access.admin.saveGroup({
        tenant: slug,
        key,
        ...(name ? { displayName: name } : {}),
        members: current.members,
      })
      flash(c, {
        kind: 'ok',
        text: name ? `The group is now named ${name}.` : 'The name was removed.',
      })
      return c.redirect(path)
    }
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
      ...(current.displayName ? { displayName: current.displayName } : {}),
      members,
    })
    const added = members.filter((member) => !current.members.includes(member)).length
    const removed = current.members.filter((member) => !members.includes(member)).length
    flash(c, {
      kind: 'ok',
      text:
        added + removed === 0
          ? 'The members did not change.'
          : `Saved: ${added} added, ${removed} removed. The group has ${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}.`,
    })
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
  const [group, users, grants, roles] = await Promise.all([
    groupOf(admin, slug, key),
    admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })),
    admin.all((offsets) => admin.grants({ tenant: slug, ...offsets })),
    admin
      .all((offsets) => admin.roles({ tenant: slug, ...offsets }))
      .catch(() => ({ rows: [], complete: false })),
  ])
  if (!group) return c.notFound()
  const path = `${tenantPath(slug)}/groups/${encodeURIComponent(key)}`
  const showAll = c.req.query('all') === '1'
  const rights = grants.rows.filter((grant) => grant.group === key && (showAll || isLive(grant)))
  const byIdentity = new Map(users.rows.map((user) => [user.externalSubject, user]))
  const unknown = group.members.filter((member) => !byIdentity.has(member))
  const name = group.displayName ?? group.key
  const draft = takeDraft(c, GRANT_FORM)

  return c.render(
    <>
      <TenantHead slug={slug} title={name} lede="Every member holds every right of the group." />
      <TenantTabs slug={slug} current="groups" />
      <div class="split">
        <div class="stack">
          <section class="card">
            <header>
              <h2>Members</h2>
              <span class="small muted">{group.members.length}</span>
            </header>
            {!users.complete ? (
              <Notice tone="warn" title="The tenant holds more than a thousand users">
                The search offers the first thousand: a member of the others is named by its
                identity at the provider.
              </Notice>
            ) : null}
            <form method="post" class="form">
              <input type="hidden" name="_action" value="members" />
              <ChipPicker
                name="members"
                label="Add a member"
                placeholder="Add a user: type a name, an e-mail or an identity"
                emptyText="The group has no member yet."
                trackChanges
                noun={['member', 'members']}
                candidates={users.rows.map((user) => ({
                  value: user.externalSubject,
                  label: userLabel(user),
                  ...(user.email && user.email !== userLabel(user) ? { hint: user.email } : {}),
                }))}
                selected={group.members}
              />
              <div class="row">
                <button type="submit" class="button">
                  Save members
                </button>
              </div>
            </form>
            {unknown.length > 0 ? (
              <p class="small muted">
                {unknown.length === 1 ? 'One member is' : `${unknown.length} members are`} not among
                the users the console read, and shown by their identity at the provider.
              </p>
            ) : null}
          </section>
          <section class="card">
            <header>
              <h2>Rights of the group</h2>
              <a class="small" href={showAll ? path : `${path}?all=1`}>
                {showAll ? 'Hide revoked and ended' : 'Show revoked and ended'}
              </a>
            </header>
            {rights.length === 0 ? (
              <Empty>The group holds no right yet: its members get nothing from it.</Empty>
            ) : (
              <RightsTable
                rows={rights.map((grant) => ({ grant }))}
                roles={roles.rows}
                back={path}
                holderName={`the group ${name}`}
              />
            )}
            <details class="disclosure" open={draft !== null}>
              <summary>Grant a right to the group</summary>
              <GrantForm
                tenant={slug}
                back={path}
                fixedGroup={group}
                grants={grants.rows}
                roles={roles.rows}
                consoleRoute={c.get('services').config.routeId}
                draft={draft}
              />
            </details>
          </section>
        </div>
        <aside class="stack">
          <section class="card">
            <h2>Group</h2>
            <KeyValues
              rows={[
                ['Key', <code>{group.key}</code>],
                ['Members', String(group.members.length)],
                ['Created', <Moment at={group.createdAt} />],
              ]}
            />
          </section>
          <section class="card">
            <h2>Name</h2>
            <form method="post" class="form">
              <input type="hidden" name="_action" value="rename" />
              <label class="field">
                <span>Name of the group</span>
                <input name="displayName" value={group.displayName ?? ''} placeholder={group.key} />
                <span class="hint">The key stays {group.key}.</span>
              </label>
              <div class="row">
                <button type="submit" class="button quiet">
                  Rename
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </>,
    {
      title: name,
      section: 'operators',
      crumbs: tenantCrumbs(
        slug,
        { label: 'Groups', href: `${tenantPath(slug)}/groups` },
        { label: group.key }
      ),
    }
  )
})
