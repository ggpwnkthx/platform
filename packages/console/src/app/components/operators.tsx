/**
 * The pieces of the pages of the administration.
 *
 * The administration speaks the words of an operator: a **user** is a
 * principal of Access, and a **right** is a grant of it.
 */

import type { Context } from 'hono'
import type { AdminClient, Grant, Group, Principal, Role } from '../../domains/access'
import { isLive, knownPermissionsOf, permissionsOfRole } from '../../domains/operators'
import type { Draft } from '../../domains/session'
import type { Crumb } from '../context'
import ConfirmButton from '../islands/confirm-button'
import GrantFields from '../islands/grant-fields'
import { tenantCredential } from '../middleware/guards'
import { Badge, Moment, PageHead, Tabs } from './page'

/** The path of a tenant in the administration. */
export function tenantPath(slug: string): string {
  return `/operators/tenants/${encodeURIComponent(slug)}`
}

/** The breadcrumbs of a page of a tenant. */
export function tenantCrumbs(slug: string, ...rest: Crumb[]): Crumb[] {
  return [
    { label: 'Operators', href: '/operators' },
    { label: slug, href: tenantPath(slug) },
    ...rest,
  ]
}

/** The tabs of a tenant. */
export function TenantTabs(props: {
  slug: string
  current: 'overview' | 'users' | 'groups' | 'roles' | 'rights' | 'audit'
}) {
  const base = tenantPath(props.slug)
  return (
    <Tabs
      items={[
        { href: base, label: 'Overview', current: props.current === 'overview' },
        { href: `${base}/users`, label: 'Users', current: props.current === 'users' },
        { href: `${base}/groups`, label: 'Groups', current: props.current === 'groups' },
        { href: `${base}/roles`, label: 'Roles', current: props.current === 'roles' },
        { href: `${base}/rights`, label: 'Rights', current: props.current === 'rights' },
        { href: `${base}/audit`, label: 'Audit', current: props.current === 'audit' },
      ]}
    />
  )
}

/** The head of a page of a tenant. */
export function TenantHead(props: { slug: string; title: string; lede?: string }) {
  return <PageHead title={props.title} eyebrow={`Tenant ${props.slug}`} lede={props.lede} />
}

/**
 * The client of the administration for the tenant of a page, or the
 * page that refuses it.
 */
export async function adminFor(
  c: Context,
  tenant: string
): Promise<{ admin: AdminClient } | { refusal: Response | Promise<Response> }> {
  const credential = await tenantCredential(c, tenant)
  if (credential) return { admin: c.get('services').admin(credential) }
  c.status(403)
  return {
    refusal: c.render(
      <section class="refusal">
        <PageHead
          title="This tenant is not yours to administer"
          lede={`Your scope on the console does not reach the tenant ${tenant}.`}
        />
        <p>
          <a class="button quiet" href="/operators">
            The administration
          </a>
        </p>
      </section>,
      { title: 'Not yours', section: 'operators' }
    ),
  }
}

/** The name of a user, as an operator knows it. */
export function userLabel(user: Principal): string {
  return user.displayName ?? user.email ?? user.externalSubject
}

/** The status of a user. */
export function UserStatus(props: { user: Principal }) {
  return props.user.status === 'active' ? (
    <Badge tone="ok">active</Badge>
  ) : (
    <Badge tone="error">disabled</Badge>
  )
}

/** The name of the grant form: the draft of a refused grant comes back to it. */
export const GRANT_FORM = 'grant'

/** How rights work, in four lines, on the pages that grant them. */
export function HowRightsWork() {
  return (
    <details class="disclosure how">
      <summary>How rights work</summary>
      <dl class="kv small">
        <dt>Permission</dt>
        <dd>
          A single capability, such as <code>content.read</code>. Data decides what each one allows.
        </dd>
        <dt>Role</dt>
        <dd>A named set of permissions. It can include other roles.</dd>
        <dt>Right</dt>
        <dd>
          A role or a permission, held by a user or a group, on a workspace and route, until it is
          revoked or ends.
        </dd>
        <dt>Group</dt>
        <dd>A set of users. A right granted to a group is held by every member.</dd>
      </dl>
    </details>
  )
}

/** The holder of a right, as a page names it and links it. */
export interface Holder {
  readonly label: string
  readonly href?: string
  readonly kind: 'user' | 'group'
}

/** The holder of a grant, from the users and the groups the page read. */
export function holderOf(
  tenant: string,
  grant: Grant,
  users: ReadonlyMap<string, Principal>
): Holder {
  const base = tenantPath(tenant)
  if (grant.group) {
    return {
      label: grant.group,
      href: `${base}/groups/${encodeURIComponent(grant.group)}`,
      kind: 'group',
    }
  }
  const user = grant.userId ? users.get(grant.userId) : undefined
  return {
    label: user ? userLabel(user) : (grant.userId ?? '—'),
    ...(grant.userId ? { href: `${base}/users/${encodeURIComponent(grant.userId)}` } : {}),
    kind: 'user',
  }
}

/** The state of a right. */
export function RightState(props: { grant: Grant }) {
  const { grant } = props
  if (grant.revokedAt) return <Badge tone="error">revoked</Badge>
  if (!isLive(grant)) return <Badge tone="warn">ended</Badge>
  if (grant.expiresAt) return <Badge tone="accent">until {grant.expiresAt.slice(0, 10)}</Badge>
  return <Badge tone="ok">live</Badge>
}

/** The workspace and the route a right holds on, in words. */
export function scopeWords(grant: Grant): string {
  const workspace = grant.workspaceId ? `workspace ${grant.workspaceId}` : 'all workspaces'
  const route = grant.routeId ? `route ${grant.routeId}` : 'all routes'
  return `${workspace}, ${route}`
}

/** The scope of a right: the workspace and the route it holds on. */
export function RightScope(props: { grant: Grant }) {
  const { workspaceId, routeId } = props.grant
  return (
    <span class="small scope">
      {workspaceId ? (
        <code title={workspaceId}>
          {workspaceId.length > 13 ? `${workspaceId.slice(0, 8)}…` : workspaceId}
        </code>
      ) : (
        <span>All workspaces</span>
      )}
      <span class="muted"> · </span>
      {routeId ? <code>{routeId}</code> : <span>all routes</span>}
    </span>
  )
}

/** What a right gives: a permission, or a role and the permissions it holds. */
export function RightName(props: { grant: Grant; roles?: readonly Role[] }) {
  const { grant } = props
  if (grant.permission) {
    return (
      <span class="right-name">
        <code>{grant.permission}</code>
        <span class="small muted">permission</span>
      </span>
    )
  }
  const key = grant.role ?? '—'
  const permissions = props.roles ? permissionsOfRole(key, props.roles) : []
  return (
    <span class="right-name">
      <span>
        <Badge tone="accent" plain>
          role
        </Badge>{' '}
        <a href={`${tenantPath(grant.tenant)}/roles/${encodeURIComponent(key)}`}>
          <code>{key}</code>
        </a>
      </span>
      {permissions.length > 0 ? (
        <span class="small muted" title={permissions.join(', ')}>
          {permissions.length <= 3
            ? permissions.join(', ')
            : `${permissions.slice(0, 3).join(', ')} +${permissions.length - 3} more`}
        </span>
      ) : null}
    </span>
  )
}

/** The button that revokes a right. */
export function RevokeButton(props: { grant: Grant; back: string; holder?: string }) {
  if (props.grant.revokedAt) return null
  const what = props.grant.permission
    ? `the permission ${props.grant.permission}`
    : `the role ${props.grant.role}`
  const from = props.holder ? ` from ${props.holder}` : ''
  return (
    <form
      method="post"
      action={`/operators/tenants/${encodeURIComponent(props.grant.tenant)}/rights`}
    >
      <input type="hidden" name="_action" value="revoke" />
      <input type="hidden" name="grant" value={props.grant.id} />
      <input type="hidden" name="back" value={props.back} />
      <ConfirmButton
        small
        label="Revoke"
        message={`Revoke ${what}${from} on ${scopeWords(props.grant)}? Access refuses it from the next decision on.`}
      />
    </form>
  )
}

/** A row of the table of rights. */
export interface RightsRow {
  readonly grant: Grant
  readonly holder?: Holder
  /** The key of the group the right is held through, on the page of one of its members. */
  readonly through?: string | null
}

/** The table of rights. */
export function RightsTable(props: {
  rows: readonly RightsRow[]
  back: string
  roles?: readonly Role[]
  showHolder?: boolean
  /** The name of the holder of every row, on the page of a user or of a group. */
  holderName?: string
}) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Right</th>
            {props.showHolder ? <th>Held by</th> : null}
            {props.rows.some((row) => row.through) ? <th>Through</th> : null}
            <th>Where</th>
            <th>State</th>
            <th>Granted</th>
            <th>
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr>
              <td>
                <RightName grant={row.grant} roles={props.roles} />
              </td>
              {props.showHolder ? (
                <td>
                  {row.holder ? (
                    <span>
                      {row.holder.kind === 'group' ? <span class="small muted">group </span> : null}
                      {row.holder.href ? (
                        <a href={row.holder.href}>{row.holder.label}</a>
                      ) : (
                        row.holder.label
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              ) : null}
              {props.rows.some((r) => r.through) ? (
                <td>
                  {row.through ? (
                    <a
                      class="small through"
                      href={`${tenantPath(row.grant.tenant)}/groups/${encodeURIComponent(row.through)}`}
                    >
                      group {row.through}
                    </a>
                  ) : null}
                </td>
              ) : null}
              <td>
                <RightScope grant={row.grant} />
              </td>
              <td>
                <RightState grant={row.grant} />
              </td>
              <td class="small">
                <Moment at={row.grant.createdAt} />
                {row.grant.grantedBy ? <div class="muted">by {row.grant.grantedBy}</div> : null}
              </td>
              <td class="num actions">
                {row.through ? (
                  <a
                    class="small"
                    href={`${tenantPath(row.grant.tenant)}/groups/${encodeURIComponent(row.through)}`}
                    title="A right of a group is revoked on the page of the group"
                  >
                    Manage on group
                  </a>
                ) : (
                  <RevokeButton
                    grant={row.grant}
                    back={props.back}
                    holder={props.holderName ?? row.holder?.label}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The workspaces and the routes the rights of a tenant name. */
export function knownOf(grants: readonly Grant[]): {
  workspaces: string[]
  routes: string[]
} {
  const unique = (values: (string | null | undefined)[]) =>
    [
      ...new Set(
        values.filter((value): value is string => typeof value === 'string' && value !== '')
      ),
    ].sort()
  return {
    workspaces: unique(grants.map((grant) => grant.workspaceId)),
    routes: unique(grants.map((grant) => grant.routeId)),
  }
}

/** The form that grants a right, to a user or to a group. */
export function GrantForm(props: {
  tenant: string
  back: string
  /** The rights of the tenant: the permissions, the workspaces and the routes they name. */
  grants: readonly Grant[]
  roles: readonly Role[]
  consoleRoute: string
  users?: readonly Principal[]
  groups?: readonly Group[]
  fixedUser?: Principal
  fixedGroup?: Group
  /** The form that was refused, to show again. */
  draft?: Draft | null
  /** Distinguishes the fields of two forms of one page. */
  prefix?: string
}) {
  const known = knownOf(props.grants)
  const fixedHolder = props.fixedUser
    ? { value: `user:${props.fixedUser.id}`, label: userLabel(props.fixedUser) }
    : props.fixedGroup
      ? {
          value: `group:${props.fixedGroup.key}`,
          label: `the group ${props.fixedGroup.displayName ?? props.fixedGroup.key}`,
        }
      : undefined
  const holders = fixedHolder
    ? undefined
    : [
        ...(props.groups ?? []).map((group) => ({
          value: `group:${group.key}`,
          label: `${group.displayName ?? group.key} (group)`,
          hint: `${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`,
        })),
        ...(props.users ?? []).map((user) => ({
          value: `user:${user.id}`,
          label: userLabel(user),
          ...(user.email && user.email !== userLabel(user) ? { hint: user.email } : {}),
        })),
      ]
  return (
    <form method="post" action={`${tenantPath(props.tenant)}/rights`} class="form">
      <input type="hidden" name="_action" value="grant" />
      <input type="hidden" name="_form" value={GRANT_FORM} />
      <input type="hidden" name="back" value={props.back} />
      <GrantFields
        prefix={props.prefix ?? 'grant'}
        {...(holders ? { holders } : {})}
        {...(fixedHolder ? { fixedHolder } : {})}
        roles={[...props.roles]
          .sort((left, right) => left.key.localeCompare(right.key))
          .map((role) => ({
            key: role.key,
            label: role.displayName ?? role.key,
            permissions: permissionsOfRole(role.key, props.roles),
          }))}
        permissions={knownPermissionsOf(props.grants, props.roles)}
        workspaces={known.workspaces}
        routes={known.routes}
        consoleRoute={props.consoleRoute}
        {...(props.draft ? { values: props.draft.values, problems: props.draft.problems } : {})}
      />
      <div class="row">
        <button type="submit" class="button">
          Grant
        </button>
      </div>
    </form>
  )
}
