/**
 * The access of one user: what it may do in effect, the rights it holds
 * by itself and through its groups, a check of one workspace, and its
 * registration.
 *
 * The effective permissions expand the roles of the tenant, and say
 * where each permission comes from. The check asks Access — the access
 * context, the answer the services act on — and lists the rights that
 * explain it.
 */

import { createRoute } from 'honox/factory'
import {
  type AccessContext,
  AccessError,
  type AdminClient,
  type Principal,
} from '../../../../../../domains/access'
import {
  effectivePermissionsOf,
  grantAppliesTo,
  groupsOf,
  isLive,
  rightsOf,
} from '../../../../../../domains/operators'
import {
  adminFor,
  GRANT_FORM,
  GrantForm,
  RightName,
  RightScope,
  RightsTable,
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
import ConfirmButton from '../../../../../islands/confirm-button'
import CopyText from '../../../../../islands/copy-text'
import { formOf } from '../../../../../middleware/forms'
import { flash, takeDraft } from '../../../../../middleware/session'

async function userOf(
  admin: AdminClient,
  tenant: string,
  id: string
): Promise<{ user: Principal | null; complete: boolean }> {
  const all = await admin.all((page) => admin.principals({ tenant, ...page }))
  return { user: all.rows.find((row) => row.id === id) ?? null, complete: all.complete }
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

  // The check of one workspace: the answer of Access, and the rights that explain it.
  const checkWorkspace = (c.req.query('workspace') ?? '').trim()
  const checkRoute = (c.req.query('route') ?? '').trim()
  let answer: AccessContext | null = null
  let checkRefusal: RefusalView | null = null
  let checkUnavailable: string | null = null
  if (checkWorkspace && checkRoute) {
    const tenantId = await services.tenantId(slug)
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
                              <RightScope grant={source.grant} />
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
                roles={roles.rows}
                back={path}
                holderName={label}
              />
            )}
            <details class="disclosure" open={draft !== null}>
              <summary>Grant a right to {label}</summary>
              <GrantForm
                tenant={slug}
                back={path}
                fixedUser={user}
                grants={grants.rows}
                roles={roles.rows}
                consoleRoute={services.config.routeId}
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
                roles={roles.rows}
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
                  value={checkWorkspace}
                  placeholder="11111111-1111-4111-8111-111111111111"
                />
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
                      ? `Access gives ${answer.permissionKeys.length} ${answer.permissionKeys.length === 1 ? 'permission' : 'permissions'} on this workspace and route.`
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
                        <RightScope grant={right.grant} />
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
              <UserStatus user={user} />
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
            <h2>Groups</h2>
            {memberOf.length === 0 ? (
              <p class="muted">
                In no group. Add them on the page of a{' '}
                <a href={`${tenantPath(slug)}/groups`}>group</a>.
              </p>
            ) : (
              <div class="chips">
                {memberOf.map((group) => (
                  <a
                    class="chip"
                    href={`${tenantPath(slug)}/groups/${encodeURIComponent(group.key)}`}
                  >
                    {group.displayName ?? group.key}
                  </a>
                ))}
              </div>
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
                <button type="submit" class="button">
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
                      message={`Disable ${label}? Access refuses every decision for them from now on.`}
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
