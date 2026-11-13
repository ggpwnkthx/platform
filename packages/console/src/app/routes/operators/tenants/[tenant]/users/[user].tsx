/**
 * The access of one user: what it may do in effect, the rights it holds
 * by itself and through its groups, its groups, a check of one
 * workspace, and its registration.
 *
 * The effective permissions expand the roles of the tenant, and say
 * where each permission comes from. What the console itself opens to
 * the user — the administration, the status, the creation of workspaces
 * — is the ability of the console, built from the keys Access holds for
 * that user and read aloud. The check asks Access — the access context,
 * the answer the services act on — and lists the rights that explain it.
 *
 * The page is where an operator manages one person: it grants a right,
 * makes the user an administrator in one step, and changes its groups
 * without leaving it.
 */

import type { Context } from 'hono'
import { createRoute } from 'honox/factory'
import {
  ACTIONS,
  type Capability,
  consoleAbility,
  consoleCapabilitiesOf,
  permissionOf,
  workspaceAbility,
  workspaceCapabilitiesOf,
} from '../../../../../../domains/ability'
import {
  type AccessContext,
  AccessError,
  type AdminClient,
  type Principal,
} from '../../../../../../domains/access'
import {
  administrationOf,
  effectivePermissionsOf,
  grantAppliesTo,
  groupsOf,
  isLive,
  knownPermission,
  memberNameOf,
  permissionsOfRole,
  platformKeysOfGroup,
  rightsOf,
  scopeOf,
  TENANT_ADMIN_ROLE,
} from '../../../../../../domains/operators'
import {
  adminFor,
  joiningWrites,
  type PlatformWrite,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
  UserStatus,
  userLabel,
} from '../../../../../components/operators'
import {
  Badge,
  Empty,
  KeyValues,
  Moment,
  Notice,
  Refusal,
  type RefusalView,
  refusalOf,
} from '../../../../../components/page'
import {
  GRANT_FORM,
  GrantForm,
  RightName,
  RightPlace,
  RightsTable,
  rightsViewOf,
} from '../../../../../components/rights'
import { Capabilities } from '../../../../../components/why'
import ChipPicker from '../../../../../islands/chip-picker'
import ConfirmButton from '../../../../../islands/confirm-button'
import CopyText from '../../../../../islands/copy-text'
import { formOf } from '../../../../../middleware/forms'
import { flash, sessionOf, takeDraft } from '../../../../../middleware/session'

async function userOf(
  admin: AdminClient,
  tenant: string,
  id: string
): Promise<{ user: Principal | null; complete: boolean }> {
  const all = await admin.all((page) => admin.principals({ tenant, ...page }))
  return { user: all.rows.find((row) => row.id === id) ?? null, complete: all.complete }
}

/**
 * Writes the groups of a user: the user joins the groups the form names
 * and leaves the others.
 *
 * Access replaces the members of a group with the ones it is sent: a
 * group is read again before it is written, and only the groups whose
 * membership changes are written.
 *
 * A group that gives a capability of the platform is joined with the
 * credential of the platform, or not at all: the user is given what the
 * group holds. Leaving a group is the tenant's own write.
 */
async function saveGroups(
  c: Context,
  admin: AdminClient,
  tenant: string,
  user: Principal,
  wanted: ReadonlySet<string>
): Promise<{ joined: string[]; left: string[]; refused: string[] }> {
  const groups = await admin.all((page) => admin.groups({ tenant, ...page }))
  const name = memberNameOf(user)
  const joined: string[] = []
  const left: string[] = []
  const refused: string[] = []
  // The rights of the tenant are read once, and only when a group is joined.
  let joining: ((group: string) => Promise<PlatformWrite>) | null = null
  for (const group of groups.rows) {
    const member = group.members.includes(name)
    if (member === wanted.has(group.key)) continue
    try {
      let client = admin
      if (!member) {
        joining ??= await joiningWrites(c, admin, tenant)
        const write = await joining(group.key)
        if (write.kind === 'refused') {
          refused.push(`${group.key}: ${write.reason}`)
          continue
        }
        if (write.kind === 'platform') client = write.client
      }
      await client.saveGroup({
        tenant,
        key: group.key,
        ...(group.displayName ? { displayName: group.displayName } : {}),
        members: member
          ? group.members.filter((entry) => entry !== name)
          : [...group.members, name],
      })
      if (member) left.push(group.key)
      else joined.push(group.key)
    } catch (error) {
      if (!(error instanceof AccessError) || error.status >= 500) throw error
      refused.push(`${group.key}: ${error.message}`)
    }
  }
  return { joined, left, refused }
}

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const id = c.req.param('user') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { user } = await userOf(access.admin, slug, id)
  if (!user) return c.notFound()
  const form = await formOf(c)
  const path = `${tenantPath(slug)}/users/${id}`
  if (form.get('_action') === 'groups') {
    const wanted = new Set(
      form
        .all('groups')
        .map((key) => key.trim())
        .filter(Boolean)
    )
    const { joined, left, refused } = await saveGroups(c, access.admin, slug, user, wanted)
    const changes = [
      joined.length > 0 ? `joined ${joined.join(', ')}` : '',
      left.length > 0 ? `left ${left.join(', ')}` : '',
    ].filter(Boolean)
    flash(c, {
      kind: refused.length > 0 ? 'error' : 'ok',
      text:
        changes.length > 0
          ? `${userLabel(user)} ${changes.join(' and ')}.`
          : refused.length > 0
            ? `The groups of ${userLabel(user)} were not changed.`
            : `The groups of ${userLabel(user)} did not change.`,
      ...(refused.length > 0 ? { detail: refused.join(' · ') } : {}),
    })
    return c.redirect(path)
  }
  const changesStatus = form.get('_action') === 'status'
  const status = changesStatus
    ? form.get('status') === 'disabled'
      ? 'disabled'
      : 'active'
    : user.status
  const keep = (name: 'email' | 'displayName') =>
    changesStatus ? (user[name] ?? '') : form.get(name).trim()
  try {
    await access.admin.savePrincipal({
      tenant: slug,
      // The provider names the principal with its subject: a body that
      // names none is a body of the default provider, and would write
      // another principal than the one of the page.
      ...(user.provider ? { provider: user.provider } : {}),
      externalSubject: user.externalSubject,
      ...(keep('email') ? { email: keep('email') } : {}),
      ...(keep('displayName') ? { displayName: keep('displayName') } : {}),
      status,
    })
    flash(c, {
      kind: 'ok',
      text:
        status !== user.status
          ? status === 'disabled'
            ? `${userLabel(user)} is disabled: Access refuses every decision for them.`
            : `${userLabel(user)} is active again.`
          : `${userLabel(user)} was saved.`,
    })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, { kind: 'error', text: error.message, detail: `${error.status} ${error.code}` })
  }
  return c.redirect(path)
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const id = c.req.param('user') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const { admin } = access
  const services = c.get('services')
  const [{ user, complete }, grants, groups, roles] = await Promise.all([
    userOf(admin, slug, id),
    admin.all((page) => admin.grants({ tenant: slug, ...page })),
    admin.all((page) => admin.groups({ tenant: slug, ...page })),
    admin
      .all((page) => admin.roles({ tenant: slug, ...page }))
      .catch(() => ({ rows: [], complete: false })),
  ])
  if (!user) {
    if (!complete) {
      c.status(404)
      return c.render(
        <Notice tone="warn" title="The user is not among the first thousand of the tenant">
          The console reads a thousand users of a tenant at most.
        </Notice>,
        { title: 'User', section: 'operators', crumbs: tenantCrumbs(slug, { label: 'Users' }) }
      )
    }
    return c.notFound()
  }
  const path = `${tenantPath(slug)}/users/${id}`
  const showAll = c.req.query('all') === '1'
  const every = rightsOf(user, grants.rows, groups.rows)
  const rights = every.filter((right) => showAll || isLive(right.grant))
  const own = rights.filter((right) => right.group === null)
  const inherited = rights.filter((right) => right.group !== null)
  const effective = effectivePermissionsOf(every, roles.rows)
  const memberOf = groupsOf(user, groups.rows)
  const label = userLabel(user)
  const self = sessionOf(c).principal.id === user.id
  const view = await rightsViewOf(c, slug, {
    grants: grants.rows,
    roles: roles.rows,
    groups: groups.rows,
    users: [user],
  })
  // A member of a group is given what the group holds: a group that gives
  // a capability of the platform the caller may not give is not offered,
  // and the page says which ones were left out.
  const givenBy = new Map(
    groups.rows.map((group) => [group.key, platformKeysOfGroup(group.key, grants.rows, roles.rows)])
  )
  const joinable = (key: string) =>
    (givenBy.get(key) ?? []).every((given) => view.ability.can(ACTIONS.give, permissionOf(given)))
  const memberKeys = new Set(memberOf.map((group) => group.key))
  const notOffered = groups.rows.filter(
    (group) => !memberKeys.has(group.key) && !joinable(group.key)
  )
  const tenantId = await services.tenantId(slug)

  // What the console itself opens to the user: the ability of the
  // console, built from the keys Access holds for them on the tenant
  // itself, and read aloud.
  let standing: Capability[] | null = null
  if (services.context && tenantId) {
    try {
      const context = await services.context.context(
        {
          subject: user.id,
          tenantId,
          workspaceId: slug,
          routeId: services.config.routeId,
        },
        { fresh: true }
      )
      const keys = context.allow ? context.permissionKeys : []
      standing = consoleCapabilitiesOf(
        consoleAbility(scopeOf(slug, keys, services.credentials)),
        slug
      )
    } catch (error) {
      services.log.warn('the keys of the user on the console could not be read', {
        requestId: c.get('requestId'),
        error: (error as Error).message,
      })
    }
  }
  // The rights that open the administration to the user, and whether
  // the operator may make them an administrator in one step: the role
  // of the administration exists, and every permission it holds is the
  // operator's to give.
  const place = { tenant: slug, consoleRoute: services.config.routeId }
  const administers = every.filter(
    (right) => administrationOf(right.grant, roles.rows, place) !== null
  )
  const adminRole = roles.rows.find((role) => role.key === TENANT_ADMIN_ROLE)
  const mayPromote =
    adminRole !== undefined &&
    administers.length === 0 &&
    permissionsOfRole(adminRole.key, roles.rows).every((key) =>
      view.ability.can(ACTIONS.give, permissionOf(key))
    )

  // The check of one workspace: the answer of Access, and the rights that explain it.
  const checkWorkspace = (c.req.query('workspace') ?? '').trim()
  const checkRoute = (c.req.query('route') ?? '').trim()
  let answer: AccessContext | null = null
  let checkRefusal: RefusalView | null = null
  let checkUnavailable: string | null = null
  if (checkWorkspace && checkRoute) {
    if (!services.context) {
      checkUnavailable = 'The console holds no access-context credential, so it cannot ask Access.'
    } else if (!tenantId) {
      checkUnavailable = 'The console could not read the identifier of the tenant.'
    } else {
      try {
        answer = await services.context.context(
          { subject: user.id, tenantId, workspaceId: checkWorkspace, routeId: checkRoute },
          { fresh: true }
        )
      } catch (error) {
        services.log.warn('the access check could not be answered', {
          requestId: c.get('requestId'),
          error: (error as Error).message,
        })
        checkRefusal = refusalOf(error)
      }
    }
  }
  const explaining = every.filter((right) =>
    checkWorkspace && checkRoute ? grantAppliesTo(right.grant, checkWorkspace, checkRoute) : false
  )
  const routes = [
    ...new Set(
      grants.rows.map((grant) => grant.routeId).filter((route): route is string => Boolean(route))
    ),
  ].sort()
  const draft = takeDraft(c, GRANT_FORM)

  return c.render(
    <>
      <TenantHead slug={slug} title={label} />
      <TenantTabs slug={slug} current="users" />
      {user.status === 'disabled' ? (
        <Notice tone="warn" title={`${label} is disabled`}>
          Access refuses every decision for them, whatever rights they hold.
        </Notice>
      ) : null}
      <div class="split">
        <div class="stack">
          <section class="card">
            <header>
              <h2>What {label} can do</h2>
              <span class="small muted">
                {effective.length} {effective.length === 1 ? 'permission' : 'permissions'}
              </span>
            </header>
            <p class="small muted">
              Every live permission, with the roles expanded, and where it comes from.
            </p>
            {effective.length === 0 ? (
              <Empty>No permission yet. Grant a role or add them to a group below.</Empty>
            ) : (
              <div class="table-wrap">
                <table class="effective">
                  <thead>
                    <tr>
                      <th>Permission</th>
                      <th>Comes from</th>
                      <th>Where</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effective.map((entry) => (
                      <tr>
                        <td>
                          <code>{entry.permission}</code>
                          {knownPermission(entry.permission) ? (
                            <div class="small muted">
                              {knownPermission(entry.permission)?.title}
                            </div>
                          ) : null}
                        </td>
                        <td class="small">
                          {entry.sources.map((source) => (
                            <div class="source">
                              {source.group ? (
                                <a
                                  href={`${tenantPath(slug)}/groups/${encodeURIComponent(source.group)}`}
                                >
                                  group {source.group}
                                </a>
                              ) : (
                                <span>granted directly</span>
                              )}
                              {source.roles.length > 0 ? (
                                <span class="muted"> · role {source.roles.join(' → ')}</span>
                              ) : null}
                            </div>
                          ))}
                        </td>
                        <td>
                          {entry.sources.map((source) => (
                            <div class="source">
                              <RightPlace grant={source.grant} view={view} />
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

          <section class="card" id="rights">
            <header>
              <h2>Rights granted to {label}</h2>
              <a class="small" href={showAll ? path : `${path}?all=1`}>
                {showAll ? 'Hide revoked and ended' : 'Show revoked and ended'}
              </a>
            </header>
            {own.length === 0 ? (
              <Empty>No right granted directly.</Empty>
            ) : (
              <RightsTable
                rows={own.map((right) => ({ grant: right.grant }))}
                view={view}
                back={path}
                holderName={label}
              />
            )}
            <details class="disclosure" open={draft !== null}>
              <summary class="act">Grant a right to {label}</summary>
              <GrantForm
                view={view}
                back={path}
                fixedUser={user}
                grants={grants.rows}
                draft={draft}
              />
            </details>
          </section>

          <section class="card">
            <h2>Rights through groups</h2>
            {inherited.length === 0 ? (
              <p class="muted">
                {memberOf.length === 0
                  ? `${label} is in no group.`
                  : 'None of their groups holds a right.'}
              </p>
            ) : (
              <RightsTable
                rows={inherited.map((right) => ({ grant: right.grant, through: right.group }))}
                view={view}
                back={path}
              />
            )}
          </section>

          <section class="card" id="check">
            <h2>Check access to a workspace</h2>
            <p class="small muted">
              Asks Access what {label} holds on one workspace and route right now: the answer the
              services act on.
            </p>
            <form method="get" action={`${path}#check`} class="toolbar">
              {showAll ? <input type="hidden" name="all" value="1" /> : null}
              <label class="field">
                <span>Workspace ID</span>
                <input
                  name="workspace"
                  class="mono"
                  required
                  list="check-workspaces"
                  value={checkWorkspace}
                  placeholder="11111111-1111-4111-8111-111111111111"
                />
                <datalist id="check-workspaces">
                  {[...view.workspaces].map(([workspace, name]) => (
                    <option value={workspace} label={name} />
                  ))}
                </datalist>
              </label>
              <label class="field narrow">
                <span>Route</span>
                <input
                  name="route"
                  required
                  list="check-routes"
                  value={checkRoute}
                  placeholder="data-api"
                />
                <datalist id="check-routes">
                  {routes.map((route) => (
                    <option value={route} />
                  ))}
                </datalist>
              </label>
              <button type="submit" class="button quiet">
                Check
              </button>
            </form>
            {checkUnavailable ? <Notice tone="warn">{checkUnavailable}</Notice> : null}
            {checkRefusal ? <Refusal refusal={checkRefusal} /> : null}
            {answer ? (
              <div class="check-result">
                <div class="row">
                  {answer.allow ? (
                    <Badge tone="ok">allowed</Badge>
                  ) : (
                    <Badge tone="error">refused</Badge>
                  )}
                  <span class="small">
                    {answer.allow
                      ? `Access gives ${answer.permissionKeys.length} ${answer.permissionKeys.length === 1 ? 'permission' : 'permissions'} on ${view.workspaces.get(checkWorkspace.toLowerCase()) ?? 'this workspace'} and route.`
                      : 'Access gives nothing on this workspace and route.'}
                  </span>
                </div>
                {answer.permissionKeys.length > 0 ? (
                  <div class="chips">
                    {answer.permissionKeys.map((key) => (
                      <span class="chip">
                        <code>{key}</code>
                      </span>
                    ))}
                  </div>
                ) : null}
                {answer.allow ? (
                  <Capabilities
                    explain="key"
                    items={workspaceCapabilitiesOf(
                      workspaceAbility({ keys: answer.permissionKeys })
                    )}
                  />
                ) : null}
                <p class="small muted">
                  {explaining.length === 0
                    ? 'No live right of theirs covers this workspace and route.'
                    : 'The live rights that cover it:'}
                </p>
                {explaining.length > 0 ? (
                  <ul class="small">
                    {explaining.map((right) => (
                      <li>
                        <RightName grant={right.grant} roles={roles.rows} />{' '}
                        <span class="muted">
                          {right.group ? `through group ${right.group}` : 'granted directly'} ·{' '}
                        </span>
                        <RightPlace grant={right.grant} view={view} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
        <aside class="stack">
          <section class="card">
            <header>
              <h2>User</h2>
              <span class="row">
                {self ? <Badge plain>you</Badge> : null}
                <UserStatus user={user} />
              </span>
            </header>
            <KeyValues
              rows={[
                ['Principal', <CopyText text={user.id} short />],
                ['At the provider', <CopyText text={user.externalSubject} short />],
                ['E-mail', user.email ?? '—'],
                ['Last login', <Moment at={user.lastLoginAt} />],
                ['Registered', <Moment at={user.createdAt} />],
              ]}
            />
          </section>
          <section class="card">
            <h2>In the console</h2>
            {standing ? (
              <Capabilities explain="key" items={standing} />
            ) : (
              <p class="small muted">
                The console could not ask Access what it holds for {label} on the tenant itself.
              </p>
            )}
            {administers.length > 0 ? (
              <p class="small muted">
                {label} administers {slug} through{' '}
                {administers
                  .map((right) => {
                    const how = administrationOf(right.grant, roles.rows, place)
                    const what =
                      how && how.roles.length > 0
                        ? `the role ${how.roles[0]}`
                        : `the permission ${how?.key}`
                    return right.group ? `${what} of the group ${right.group}` : what
                  })
                  .join(', and ')}
                . Revoke it under <a href="#rights">their rights</a>
                {administers.some((right) => right.group) ? ' or on the group' : ''}.
              </p>
            ) : null}
            {mayPromote && adminRole ? (
              <form method="post" action={`${tenantPath(slug)}/rights`} class="form">
                <input type="hidden" name="_action" value="grant" />
                <input type="hidden" name="_form" value={GRANT_FORM} />
                <input type="hidden" name="back" value={path} />
                <input type="hidden" name="holder" value={`user:${user.id}`} />
                <input type="hidden" name="kind" value="role" />
                <input type="hidden" name="role" value={adminRole.key} />
                <input type="hidden" name="workspace" value="tenant" />
                <input type="hidden" name="expires" value="never" />
                <div class="row">
                  <ConfirmButton
                    tone="quiet"
                    label={`Make ${label} an administrator`}
                    message={`Make ${label} an administrator of ${slug}? They are granted the role ${adminRole.displayName ?? adminRole.key} on the tenant itself: its users, groups, roles and rights are theirs to change.`}
                  />
                </div>
                <span class="hint">
                  Grants the role <code>{adminRole.key}</code> on the tenant itself, with no end.
                </span>
              </form>
            ) : null}
          </section>
          <section class="card">
            <header>
              <h2>Groups</h2>
              <span class="small muted">{memberOf.length}</span>
            </header>
            {groups.rows.length === 0 ? (
              <p class="muted">
                The tenant has no group yet. Create one on the{' '}
                <a href={`${tenantPath(slug)}/groups`}>Groups</a> tab.
              </p>
            ) : (
              <form method="post" class="form">
                <input type="hidden" name="_action" value="groups" />
                <ChipPicker
                  id="user-groups"
                  name="groups"
                  label="Add to a group"
                  placeholder="Add to a group: type its name"
                  emptyText="In no group."
                  trackChanges
                  noun={['group', 'groups']}
                  candidates={groups.rows
                    .filter((group) => memberKeys.has(group.key) || joinable(group.key))
                    .map((group) => ({
                      value: group.key,
                      label: group.displayName ?? group.key,
                      hint: [
                        `${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`,
                        ...(givenBy.get(group.key) ?? []).map((given) => `gives ${given}`),
                      ].join(' · '),
                    }))}
                  selected={memberOf.map((group) => group.key)}
                />
                <div class="row">
                  <button type="submit" class="button quiet">
                    Save groups
                  </button>
                </div>
                <span class="hint">A member of a group holds every right of the group.</span>
                {notOffered.length > 0 ? (
                  <span class="hint">
                    Not offered:{' '}
                    {notOffered.map((group) => group.displayName ?? group.key).join(', ')}.{' '}
                    {notOffered.length === 1 ? 'It gives' : 'They give'} a capability of the
                    platform, and only an operator of the platform adds a member.
                  </span>
                ) : null}
              </form>
            )}
          </section>
          <section class="card">
            <h2>Registration</h2>
            <form method="post" class="form">
              <label class="field">
                <span>Name</span>
                <input name="displayName" value={user.displayName ?? ''} />
              </label>
              <label class="field">
                <span>E-mail</span>
                <input name="email" type="email" value={user.email ?? ''} />
              </label>
              <div class="row">
                <button type="submit" class="button quiet">
                  Save
                </button>
              </div>
            </form>
          </section>
          <section class="card">
            <h2>Sign-in</h2>
            <form method="post" class="form">
              <input type="hidden" name="_action" value="status" />
              {user.status === 'active' ? (
                <>
                  <p class="small muted">
                    Disabling {label} makes Access refuse every decision for them. Their rights
                    stay, and come back when they are enabled again.
                  </p>
                  <input type="hidden" name="status" value="disabled" />
                  <div class="row">
                    <ConfirmButton
                      label={`Disable ${label}`}
                      message={
                        self
                          ? 'Disable your own sign-in? Access refuses every decision for you from now on, the administration too: another operator has to enable you again.'
                          : `Disable ${label}? Access refuses every decision for them from now on.`
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <p class="small muted">Enabling {label} gives them their rights back.</p>
                  <input type="hidden" name="status" value="active" />
                  <div class="row">
                    <button type="submit" class="button">
                      Enable {label}
                    </button>
                  </div>
                </>
              )}
            </form>
          </section>
        </aside>
      </div>
    </>,
    {
      title: label,
      section: 'operators',
      crumbs: tenantCrumbs(slug, { label: 'Users', href: `${tenantPath(slug)}/users` }, { label }),
    }
  )
})
