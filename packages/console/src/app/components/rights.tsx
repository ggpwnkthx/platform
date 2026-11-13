/**
 * The pieces that show the rights of a tenant, and the form that grants
 * one.
 *
 * Access names a workspace by its identifier, a holder by its row and a
 * place by two columns. The pieces say them the way an operator reads
 * them: the name Data gave the workspace, the name of the user or of the
 * group, and the place in words — the tenant itself, every workspace,
 * one workspace.
 *
 * What the operator may not do is drawn before it is refused: a
 * permission that is not its to give is said in the form, and a right
 * that opens the administration to the operator itself says so before
 * it is revoked.
 */

import type { Context } from 'hono'
import {
  ACTIONS,
  type ConsoleAbility,
  consoleAbility,
  permissionOf,
  reasonOf,
} from '../../domains/ability'
import type { Grant, Group, Principal, Role } from '../../domains/access'
import {
  administrationOf,
  isLive,
  isUuid,
  knownPermission,
  knownPermissionsOf,
  permissionsOfRole,
  rightsOf,
  whereOf,
} from '../../domains/operators'
import type { Draft } from '../../domains/session'
import ConfirmButton from '../islands/confirm-button'
import GrantFields from '../islands/grant-fields'
import { operatorScope } from '../middleware/scope'
import { sessionOf } from '../middleware/session'
import { workspaceNames } from '../middleware/workspaces'
import { tenantPath, userLabel } from './operators'
import { Badge, Moment } from './page'

/** The name of the grant form: the draft of a refused grant comes back to it. */
export const GRANT_FORM = 'grant'

/** What a page knows beside the rights it shows. */
export interface RightsView {
  /** The slug of the tenant: a right on the tenant itself names it as its workspace. */
  readonly tenant: string
  /** The route of the console at Access. */
  readonly consoleRoute: string
  /** The roles of the tenant. */
  readonly roles: readonly Role[]
  /** The names Data gave the workspaces, for the caller, by identifier in lower case. */
  readonly workspaces: ReadonlyMap<string, string>
  /** The ability of the caller. */
  readonly ability: ConsoleAbility
  /** The principal of the caller. */
  readonly caller: string
  /** The rights that open the administration of the tenant to the caller itself. */
  readonly ownAdministration: ReadonlySet<string>
}

/**
 * What a page of the administration knows beside the rights it shows.
 *
 * @param c the request.
 * @param tenant the slug of the tenant of the page.
 * @param read what the page read of the tenant: its rights and its
 *   roles, and its groups and its users when it read them.
 */
export async function rightsViewOf(
  c: Context,
  tenant: string,
  read: {
    readonly grants: readonly Grant[]
    readonly roles: readonly Role[]
    readonly groups?: readonly Group[]
    readonly users?: readonly Principal[]
  }
): Promise<RightsView> {
  const session = sessionOf(c)
  const consoleRoute = c.get('services').config.routeId
  const named = read.grants
    .map((grant) => grant.workspaceId)
    .filter((id): id is string => id !== null)
  const [scope, workspaces] = await Promise.all([
    operatorScope(c),
    workspaceNames(c, [...session.workspaces, ...named]),
  ])

  // The rights that open the administration to the caller itself: the
  // ones it holds, and the ones of its groups when the page read them.
  const ownAdministration = new Set<string>()
  if (session.principal.tenant === tenant) {
    const caller = read.users?.find((user) => user.id === session.principal.id)
    const own =
      caller && read.groups
        ? rightsOf(caller, read.grants, read.groups).map((right) => right.grant)
        : read.grants.filter((grant) => grant.userId === session.principal.id)
    for (const grant of own) {
      if (administrationOf(grant, read.roles, { tenant, consoleRoute })) {
        ownAdministration.add(grant.id)
      }
    }
  }
  return {
    tenant,
    consoleRoute,
    roles: read.roles,
    workspaces,
    ability: consoleAbility(scope),
    caller: session.principal.id,
    ownAdministration,
  }
}

/** The name the page shows for a workspace: the one Data gave it, or nothing. */
export function workspaceLabel(view: RightsView, workspaceId: string | null): string | undefined {
  return workspaceId ? view.workspaces.get(workspaceId.toLowerCase()) : undefined
}

/** The holder of a right, as a page names it and links it. */
export interface Holder {
  readonly label: string
  readonly href?: string
  readonly kind: 'user' | 'group'
  /** Whether the holder is the caller itself. */
  readonly self?: boolean
}

/** The holder of a grant, from the users the page read. */
export function holderOf(
  tenant: string,
  grant: Grant,
  users: ReadonlyMap<string, Principal>,
  caller?: string
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
    ...(caller !== undefined && grant.userId === caller ? { self: true } : {}),
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

/** The place a right holds in, in words. */
export function placeWords(grant: Grant, view: RightsView): string {
  const where = whereOf(grant.workspaceId, view.tenant)
  const name = workspaceLabel(view, grant.workspaceId)
  const workspace =
    where === 'all'
      ? 'all workspaces'
      : where === 'tenant'
        ? `the tenant ${view.tenant} itself`
        : `the workspace ${name ?? grant.workspaceId}`
  return `${workspace}, ${grant.routeId ? `the route ${grant.routeId}` : 'all routes'}`
}

/** The place of a right: where it holds, and the route it is limited to. */
export function RightPlace(props: { grant: Grant; view: RightsView }) {
  const { workspaceId, routeId } = props.grant
  const where = whereOf(workspaceId, props.view.tenant)
  const name = workspaceLabel(props.view, workspaceId)
  return (
    <span class="small scope">
      {where === 'all' ? (
        <span>All workspaces</span>
      ) : where === 'tenant' ? (
        <span
          class="place-tenant"
          title={`The tenant ${props.view.tenant}, named as the workspace: what the console asks Access about`}
        >
          The tenant itself
        </span>
      ) : name ? (
        <span title={workspaceId ?? undefined}>{name}</span>
      ) : (
        <code title={workspaceId ?? undefined}>
          {workspaceId && workspaceId.length > 13 ? `${workspaceId.slice(0, 8)}…` : workspaceId}
        </code>
      )}
      <span class="muted"> · </span>
      {routeId ? <code>{routeId}</code> : <span class="muted">all routes</span>}
    </span>
  )
}

/** A few of the permissions of a list, the ones that match a filter first. */
function someOf(permissions: readonly string[], highlight: string): string {
  const needle = highlight.trim().toLowerCase()
  const ordered = needle
    ? [
        ...permissions.filter((key) => key.includes(needle)),
        ...permissions.filter((key) => !key.includes(needle)),
      ]
    : permissions
  return ordered.length <= 3
    ? ordered.join(', ')
    : `${ordered.slice(0, 3).join(', ')} +${ordered.length - 3} more`
}

/** What a right gives: a permission, or a role and the permissions it holds. */
export function RightName(props: {
  grant: Grant
  roles?: readonly Role[]
  /** A part of a permission the page was asked for: the permissions that match are named first. */
  highlight?: string
}) {
  const { grant } = props
  if (grant.permission) {
    return (
      <span class="right-name">
        <code>{grant.permission}</code>
        <span class="small muted">{knownPermission(grant.permission)?.title ?? 'permission'}</span>
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
          {someOf(permissions, props.highlight ?? '')}
        </span>
      ) : null}
    </span>
  )
}

/** The button that revokes a right. */
export function RevokeButton(props: {
  grant: Grant
  back: string
  view: RightsView
  holder?: string
}) {
  const { grant, view } = props
  if (grant.revokedAt) return null
  const what = grant.permission ? `the permission ${grant.permission}` : `the role ${grant.role}`
  const from = props.holder ? ` from ${props.holder}` : ''
  // A right that opens the administration to the operator itself says
  // so before it goes: the next page would be a refusal.
  const own = view.ownAdministration.has(grant.id)
    ? view.ownAdministration.size === 1
      ? ` It is the only right that opens the administration of ${view.tenant} to you: without it, your next page is a refusal.`
      : ` It is one of the rights that open the administration of ${view.tenant} to you.`
    : ''
  return (
    <form method="post" action={`${tenantPath(grant.tenant)}/rights`}>
      <input type="hidden" name="_action" value="revoke" />
      <input type="hidden" name="grant" value={grant.id} />
      <input type="hidden" name="back" value={props.back} />
      <ConfirmButton
        small
        label="Revoke"
        message={`Revoke ${what}${from} on ${placeWords(grant, view)}? Access refuses it from the next decision on.${own}`}
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
  view: RightsView
  showHolder?: boolean
  /** The name of the holder of every row, on the page of a user or of a group. */
  holderName?: string
  /** A part of a permission the page was asked for. */
  highlight?: string
}) {
  const { view } = props
  // A right held through a group is revoked on the page of the group:
  // a table of nothing else has no column of actions.
  const revocable = props.rows.some((row) => !row.through && !row.grant.revokedAt)
  const place = { tenant: view.tenant, consoleRoute: view.consoleRoute }
  return (
    <div class="table-wrap">
      <table class="rights">
        <thead>
          <tr>
            <th>Right</th>
            {props.showHolder ? <th>Held by</th> : null}
            <th>Where</th>
            <th>State</th>
            <th>Granted</th>
            {revocable ? (
              <th>
                <span class="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr>
              <td>
                <RightName grant={row.grant} roles={view.roles} highlight={props.highlight} />
                {row.through ? (
                  <div class="small through">
                    <span class="muted">through the group </span>
                    <a
                      href={`${tenantPath(row.grant.tenant)}/groups/${encodeURIComponent(row.through)}`}
                      title="A right of a group is revoked on the page of the group"
                    >
                      {row.through}
                    </a>
                  </div>
                ) : null}
                {administrationOf(row.grant, view.roles, place) ? (
                  <div>
                    <Badge tone="accent" plain>
                      opens the administration
                    </Badge>
                  </div>
                ) : null}
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
                      {row.holder.self ? (
                        <>
                          {' '}
                          <Badge plain>you</Badge>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              ) : null}
              <td>
                <RightPlace grant={row.grant} view={view} />
              </td>
              <td>
                <RightState grant={row.grant} />
              </td>
              <td class="small">
                <Moment at={row.grant.createdAt} />
                {row.grant.grantedBy ? (
                  <div class="muted granted-by">by {row.grant.grantedBy}</div>
                ) : null}
              </td>
              {revocable ? (
                <td class="num actions">
                  {row.through ? null : (
                    <RevokeButton
                      grant={row.grant}
                      back={props.back}
                      view={view}
                      holder={props.holderName ?? row.holder?.label}
                    />
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The routes the rights of a tenant name. */
function routesOf(grants: readonly Grant[]): string[] {
  return [
    ...new Set(
      grants.map((grant) => grant.routeId).filter((route): route is string => Boolean(route))
    ),
  ].sort()
}

/** What the picker says under a permission: what it opens, or where the tenant names it. */
function permissionHint(key: string, roles: readonly Role[]): string {
  const known = knownPermission(key)
  if (known) return known.platform ? `${known.title} · the platform's` : known.title
  const holding = roles.filter((role) => role.permissions.includes(key)).map((role) => role.key)
  if (holding.length === 0) return 'granted as it is'
  return holding.length <= 2 ? `in ${holding.join(' and ')}` : `in ${holding.length} roles`
}

/** The form that grants a right, to a user or to a group. */
export function GrantForm(props: {
  view: RightsView
  back: string
  /** The rights of the tenant: the permissions, the workspaces and the routes they name. */
  grants: readonly Grant[]
  users?: readonly Principal[]
  groups?: readonly Group[]
  fixedUser?: Principal
  fixedGroup?: Group
  /** The form that was refused, to show again. */
  draft?: Draft | null
  /** Distinguishes the fields of two forms of one page. */
  prefix?: string
}) {
  const { view } = props
  const refusal = (key: string) => reasonOf(view.ability, ACTIONS.give, permissionOf(key))
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
  const permissions = knownPermissionsOf(props.grants, view.roles)
  // The workspaces a right may name: the ones the rights of the tenant
  // name already, and the ones Data named for the operator.
  const workspaces = [
    ...new Set([
      ...props.grants
        .map((grant) => grant.workspaceId?.toLowerCase())
        .filter((id): id is string => id !== undefined && isUuid(id)),
      ...view.workspaces.keys(),
    ]),
  ]
    .map((id) => {
      const name = view.workspaces.get(id)
      return name ? { value: id, label: name, hint: id } : { value: id, label: id }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
  return (
    <form method="post" action={`${tenantPath(view.tenant)}/rights`} class="form">
      <input type="hidden" name="_action" value="grant" />
      <input type="hidden" name="_form" value={GRANT_FORM} />
      <input type="hidden" name="back" value={props.back} />
      <GrantFields
        prefix={props.prefix ?? 'grant'}
        {...(holders ? { holders } : {})}
        {...(fixedHolder ? { fixedHolder } : {})}
        roles={[...view.roles]
          .sort((left, right) => left.key.localeCompare(right.key))
          .map((role) => {
            const held = permissionsOfRole(role.key, view.roles)
            const refused = held.map(refusal).find((reason) => reason !== null)
            return {
              key: role.key,
              label: role.displayName ?? role.key,
              ...(role.description ? { description: role.description } : {}),
              permissions: held,
              ...(refused ? { refused } : {}),
            }
          })}
        permissions={permissions.map((key) => ({
          value: key,
          label: key,
          hint: permissionHint(key, view.roles),
        }))}
        locked={Object.fromEntries(
          permissions
            .map((key) => [key, refusal(key)] as const)
            .filter((entry): entry is readonly [string, string] => entry[1] !== null)
        )}
        workspaces={workspaces}
        routes={routesOf(props.grants)}
        consoleRoute={view.consoleRoute}
        tenant={view.tenant}
        {...(props.draft ? { values: props.draft.values, problems: props.draft.problems } : {})}
      />
    </form>
  )
}
