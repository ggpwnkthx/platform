/**
 * The pieces of the pages of the administration.
 *
 * The administration speaks the words of an operator: a **user** is a
 * principal of Access, and a **right** is a grant of it.
 */

import type { Context } from 'hono'
import type { AdminClient, Grant, Group, Principal, Role } from '../../domains/access'
import { isLive } from '../../domains/operators'
import type { Crumb } from '../context'
import ConfirmButton from '../islands/confirm-button'
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

/** The state of a right. */
export function RightState(props: { grant: Grant }) {
  const { grant } = props
  if (grant.revokedAt) return <Badge tone="error">revoked</Badge>
  if (!isLive(grant)) return <Badge tone="warn">expired</Badge>
  if (grant.expiresAt) return <Badge tone="accent">until {grant.expiresAt.slice(0, 10)}</Badge>
  return <Badge tone="ok">live</Badge>
}

/** The scope of a right: the workspace and the route it holds on. */
export function RightScope(props: { grant: Grant }) {
  return (
    <span class="small">
      {props.grant.workspaceId ? (
        <code title={props.grant.workspaceId}>
          {props.grant.workspaceId.length > 13
            ? `${props.grant.workspaceId.slice(0, 8)}…`
            : props.grant.workspaceId}
        </code>
      ) : (
        <span class="muted">every workspace</span>
      )}{' '}
      on{' '}
      {props.grant.routeId ? (
        <code>{props.grant.routeId}</code>
      ) : (
        <span class="muted">every route</span>
      )}
    </span>
  )
}

/** The button that revokes a right. */
export function RevokeButton(props: { grant: Grant; back: string }) {
  if (props.grant.revokedAt) return null
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
        message={`Revoke the right ${props.grant.permission}? Access refuses it from the next decision on.`}
      />
    </form>
  )
}

/** The table of rights. */
export function RightsTable(props: {
  rows: readonly { grant: Grant; holder?: string; through?: string | null }[]
  back: string
  showHolder?: boolean
}) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Right</th>
            {props.showHolder ? <th>Held by</th> : null}
            <th>Where</th>
            <th>State</th>
            <th>Granted</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr>
              <td>
                <code>{row.grant.permission ?? row.grant.role}</code>
                {row.grant.role ? (
                  <div class="small muted">through the role {row.grant.role}</div>
                ) : null}
                {row.through ? (
                  <div class="small muted">through the group {row.through}</div>
                ) : null}
              </td>
              {props.showHolder ? <td>{row.holder ?? '—'}</td> : null}
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
              <td class="num">
                {row.through ? null : <RevokeButton grant={row.grant} back={props.back} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The form that grants a right, to a user or to a group. */
export function GrantForm(props: {
  tenant: string
  back: string
  users?: readonly Principal[]
  groups?: readonly Group[]
  roles?: readonly Role[]
  fixedUser?: Principal
  fixedGroup?: string
  known: {
    permissions: readonly string[]
    workspaces: readonly string[]
    routes: readonly string[]
  }
}) {
  return (
    <form method="post" action={`${tenantPath(props.tenant)}/rights`} class="form">
      <input type="hidden" name="_action" value="grant" />
      <input type="hidden" name="back" value={props.back} />
      <div class="form-grid">
        {props.fixedUser ? (
          <input type="hidden" name="holder" value={`user:${props.fixedUser.id}`} />
        ) : props.fixedGroup ? (
          <input type="hidden" name="holder" value={`group:${props.fixedGroup}`} />
        ) : (
          <label class="field">
            <span>To</span>
            <select name="holder" required>
              {(props.users ?? []).length > 0 ? (
                <optgroup label="Users">
                  {(props.users ?? []).map((user) => (
                    <option value={`user:${user.id}`}>{userLabel(user)}</option>
                  ))}
                </optgroup>
              ) : null}
              {(props.groups ?? []).length > 0 ? (
                <optgroup label="Groups">
                  {(props.groups ?? []).map((group) => (
                    <option value={`group:${group.key}`}>{group.displayName ?? group.key}</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
        )}
        <label class="field narrow">
          <span>Kind</span>
          <select name="kind">
            <option value="permission">a permission</option>
            <option value="role">a role</option>
          </select>
        </label>
        <label class="field">
          <span>Right</span>
          <input name="value" required list="known-permissions" placeholder="content.reader" />
          <datalist id="known-permissions">
            {props.known.permissions.map((permission) => (
              <option value={permission} />
            ))}
            {(props.roles ?? []).map((role) => (
              <option value={role.key} />
            ))}
          </datalist>
        </label>
        <label class="field">
          <span>Workspace</span>
          <input
            name="workspaceId"
            list="known-workspaces"
            placeholder="every workspace"
            class="mono"
          />
          <datalist id="known-workspaces">
            {props.known.workspaces.map((workspace) => (
              <option value={workspace} />
            ))}
          </datalist>
        </label>
        <label class="field">
          <span>Route</span>
          <input name="routeId" list="known-routes" placeholder="every route" />
          <datalist id="known-routes">
            {props.known.routes.map((route) => (
              <option value={route} />
            ))}
          </datalist>
        </label>
        <label class="field">
          <span>Until</span>
          <input name="expiresAt" type="datetime-local" />
          <span class="hint">UTC · empty: it does not expire</span>
        </label>
      </div>
      <div class="row">
        <button type="submit" class="button">
          Grant
        </button>
      </div>
    </form>
  )
}

/** The permissions, the workspaces and the routes the rights of a tenant name. */
export function knownOf(grants: readonly Grant[]): {
  permissions: string[]
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
    permissions: unique(grants.map((grant) => grant.permission)),
    workspaces: unique(grants.map((grant) => grant.workspaceId)),
    routes: unique(grants.map((grant) => grant.routeId)),
  }
}
