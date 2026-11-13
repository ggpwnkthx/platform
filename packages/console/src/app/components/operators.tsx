/**
 * The pieces of the pages of the administration.
 *
 * The administration speaks the words of an operator: a **user** is a
 * principal of Access, and a **right** is a grant of it. The pieces that
 * show the rights, and the form that grants one, are in `rights.tsx`.
 */

import type { Context } from 'hono'
import { AccessError, type AdminClient, type Principal, type Role } from '../../domains/access'
import { ACTIONS, consoleAbility, permissionOf, reasonOf, tenantOf } from '../../domains/ability'
import {
  groupIsReadWhole,
  isPlatformKey,
  PLATFORM_KEYS,
  platformKeysOfGroup,
  signerOfUnreadJoin,
} from '../../domains/operators'
import type { Crumb } from '../context'
import { tenantCredential } from '../middleware/guards'
import { operatorScope } from '../middleware/scope'
import { Badge, PageHead, Tabs } from './page'

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
 *
 * The refusal says why, in the words of the rule that decides: the
 * operator of a tenant that asks for another one is told which tenant
 * its key opens.
 */
export async function adminFor(
  c: Context,
  tenant: string
): Promise<{ admin: AdminClient } | { refusal: Response | Promise<Response> }> {
  const credential = await tenantCredential(c, tenant)
  // The client acts for the operator, and the audit of Access names the
  // address the operator came from.
  const caller = c.get('callerAddress')
  if (credential) {
    return { admin: c.get('services').admin(credential, ...(caller ? [caller] : [])) }
  }
  const ability = consoleAbility(await operatorScope(c))
  const reason =
    reasonOf(ability, ACTIONS.administer, tenantOf(tenant)) ??
    `The console holds no credential of the administration for the tenant ${tenant}.`
  c.status(403)
  return {
    refusal: c.render(
      <section class="refusal">
        <PageHead title="This tenant is not yours to administer" lede={reason} />
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

/**
 * The client of a write that gives a capability of the platform.
 *
 * A capability that is not relative to a tenant is the platform's: only
 * an operator that holds it may give it, and the write is signed with
 * the credential of the platform. Access refuses the write of a
 * credential of a tenant (Access spec §3.3.1).
 *
 * The answer names the client of the write: the one of the tenant when
 * the write names no capability of the platform, the one of the platform
 * when it does, and the refusal — with the reason of the rule that
 * decides — when the operator does not hold it.
 */
export type PlatformWrite =
  | { readonly kind: 'tenant' }
  | { readonly kind: 'platform'; readonly client: AdminClient }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * The client of the write, for the permissions the write gives.
 *
 * @param c the request.
 * @param keys the permissions the write gives: the one of a right, the
 *   ones a granted role holds, the ones a role is written with.
 */
export async function platformWrite(
  c: Context,
  keys: readonly (string | null | undefined)[]
): Promise<PlatformWrite> {
  const named = keys.filter((key): key is string => isPlatformKey(key))
  if (named.length === 0) return { kind: 'tenant' }
  const ability = consoleAbility(await operatorScope(c))
  const platform = c.get('services').credentials.platform
  for (const key of named) {
    const reason = reasonOf(ability, ACTIONS.give, permissionOf(key))
    if (reason) return { kind: 'refused', reason }
  }
  if (!platform) {
    return { kind: 'refused', reason: 'The console holds no credential of the platform.' }
  }
  const caller = c.get('callerAddress')
  return {
    kind: 'platform',
    client: c.get('services').admin(platform, ...(caller ? [caller] : [])),
  }
}

/** What a new member of a group is told when the console cannot tell what the group gives. */
const RIGHTS_NOT_READ =
  'The console could not read every right of this tenant, so it cannot tell whether the group gives a capability of the platform. An operator of the platform adds the member.'

/**
 * The clients of the writes that add a member to a group.
 *
 * A member of a group holds what the group is granted: a group whose
 * live rights give a capability of the platform hands it to whoever
 * joins. Adding the member is the platform's to do, like the grant
 * itself, and Access refuses the write of a credential of a tenant
 * (Access spec §10.9). A write that only takes members away is never
 * asked about.
 *
 * The live rights and the roles of the tenant are read once, and the
 * answer for a group is the one of `platformWrite`, for the capabilities
 * the group gives. A tenant the console cannot read whole leaves it
 * unable to tell what a group gives: an operator of the platform then
 * signs with the credential of the platform, which may always write; an
 * operator of a tenant is answered by Access when the write is signed
 * with the credential of the tenant, and refused when the console would
 * sign it with the one of the platform.
 *
 * @param c the request.
 * @param admin the client of the administration of the tenant.
 * @param tenant the slug of the tenant.
 * @returns the client of the write, by the key of the group that is joined.
 */
export async function joiningWrites(
  c: Context,
  admin: AdminClient,
  tenant: string
): Promise<(group: string) => Promise<PlatformWrite>> {
  const [grants, roles] = await Promise.all([
    admin.all((page) => admin.grants({ tenant, live: true, ...page })),
    admin
      .all((page) => admin.roles({ tenant, ...page }))
      .catch((error: unknown) => {
        // A deployment without roles refuses their list, and holds no grant of a role.
        if (!(error instanceof AccessError) || error.status >= 500) throw error
        return { rows: [] as Role[], complete: false }
      }),
  ])
  return async (group) => {
    const keys = platformKeysOfGroup(group, grants.rows, roles.rows)
    if (keys.length > 0 || groupIsReadWhole(group, grants, roles)) {
      const write = await platformWrite(c, keys)
      return write.kind === 'refused'
        ? {
            kind: 'refused',
            reason: `The group gives ${keys.join(', ')} to every member. ${write.reason}`,
          }
        : write
    }
    // The console read no capability of the platform in the rights of the
    // group, and it did not read them all: it does not take that for none.
    const signer = signerOfUnreadJoin(await operatorScope(c), c.get('services').credentials, tenant)
    if (signer === 'platform') return await platformWrite(c, PLATFORM_KEYS)
    return signer === 'tenant' ? { kind: 'tenant' } : { kind: 'refused', reason: RIGHTS_NOT_READ }
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

/** How rights work, in five lines, on the pages that grant them. */
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
          A role or a permission, held by a user or a group, somewhere, until it is revoked or ends.
        </dd>
        <dt>Where</dt>
        <dd>
          On <strong>the tenant itself</strong> for what the console reads: the administration, the
          status, the creation of workspaces. On <strong>one workspace</strong> or on{' '}
          <strong>all workspaces</strong> for its records, its model and its audit.
        </dd>
        <dt>Group</dt>
        <dd>A set of users. A right granted to a group is held by every member.</dd>
      </dl>
    </details>
  )
}
