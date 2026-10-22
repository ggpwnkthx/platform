/**
 * The groups of the administration (spec §10.5).
 *
 * The membership of a group is a list of the principals of the tenant,
 * and the groups are enabled only when the deployment holds their
 * storage.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type { AuditContext, Group, GroupFilter, GroupPage, GroupRegistration } from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope, tenantOf } from './scope'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, wholeNumber } from './values'

/**
 * The query of the list of the groups.
 *
 * The values are the ones of the query of the call: they are read, and
 * a value that is not understood is a refusal.
 */
export interface GroupQuery {
  /** The tenant of the list, or null for every tenant. */
  tenant?: string | null
  /** The key of the groups, or null for every key. */
  key?: string | null
  /** The size of the page, as the query names it. */
  limit?: string | null
  /** The number of rows that are skipped, as the query names it. */
  offset?: string | null
}

/**
 * The groups that match a filter, and their number.
 *
 * A tenant that does not exist is a `404 not_found`, like everywhere
 * else. The groups are paginated like the other lists (spec §10.1).
 */
export async function listGroups(
  options: AdministrationOptions,
  scope: AdminScope,
  query: GroupQuery
): Promise<GroupPage> {
  const groups = options.groups
  if (!groups) {
    throw new AdministrationError('forbidden', 'the groups are not enabled in this deployment')
  }
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')

  const tenant = await tenantOf(options, scope, query.tenant)

  const filter: GroupFilter = {
    tenantId: tenant ? tenant.id : null,
    key: query.key?.trim() || null,
    limit,
    offset,
  }
  const page = await groups.list(filter)
  return { groups: page.groups, total: page.total, limit, offset }
}

/**
 * Creates a group, or updates the group of that key.
 *
 * The membership is **replaced**: the principals of the list are the
 * members of the group, and the principals that are not in the list are
 * not in the group any more. The members are the external identities of
 * the principals: a member that is not a principal of the tenant is a
 * `404 not_found`.
 *
 * The row of the audit is written by the statement that writes the
 * group (spec §10.1).
 */
export async function upsertGroup(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: GroupRegistration,
  context: AuditContext
): Promise<{ group: Group; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  const groups = options.groups
  if (!groups) {
    throw new AdministrationError('forbidden', 'the groups are not enabled in this deployment')
  }

  // Every member is a principal of the tenant: the group cannot name a
  // principal that does not exist.
  const members: string[] = []
  for (const subject of registration.members) {
    const principal = await options.principals.findByExternalSubject(tenant.id, subject)
    if (!principal) {
      throw new AdministrationError(
        'not_found',
        `the principal "${subject}" does not exist in the tenant`
      )
    }
    members.push(principal.id)
  }

  const existing = await groups.findByKey(tenant.id, registration.key)
  if (!existing) {
    const group = await groups.create(
      {
        tenantId: tenant.id,
        key: registration.key,
        displayName: registration.displayName ?? null,
        memberIds: members,
      },
      change('group.created', tenant.slug, context)
    )
    return {
      group,
      created: true,
      audit: { action: 'group.created', id: group.id, tenant: tenant.slug },
    }
  }

  const group = await groups.update(
    existing.id,
    {
      displayName: registration.displayName,
      memberIds: members,
    },
    change('group.updated', tenant.slug, context)
  )
  if (!group) {
    throw new AdministrationError('not_found', 'the group does not exist')
  }
  return {
    group,
    created: false,
    audit: { action: 'group.updated', id: group.id, tenant: tenant.slug },
  }
}
