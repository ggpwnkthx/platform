/**
 * The audit of the administration (spec §10.1).
 *
 * The row of the audit and the row that changed are written by one
 * statement: a change that is not audited does not exist. What is left to
 * the domain is the entry that names what changed, and the read of the
 * rows that the trail holds.
 */

import type { AdminScope } from './credentials'
import type { AdministrationOptions } from './options'
import type { AuditContext, AuditPage, ChangeAudit } from './ports'
import { tenantOf } from './scope'
import { auditFormat, MAX_EXPORT_ROWS, MAX_PAGE_SIZE, wholeNumber } from './values'
import { DEFAULT_PAGE_SIZE } from './values'

/**
 * The entry of the audit of a change (spec §10.1).
 *
 * The audit names what changed and the thing that changed: the secrets are
 * never in it. The row of the table is written by the statement that
 * changed the thing, so this entry is what the log of the service says
 * about it.
 */
export interface AuditEntry {
  /** What happened: `tenant.created`, `grant.revoked`, and so on. */
  action: string
  /** The identifier of the thing that changed. */
  id: string
  /** The slug of the tenant, when the change belongs to one. */
  tenant?: string
}

/**
 * The audit of a change, with the facts of the call.
 *
 * The domain knows what happened and to whom; the application knows who
 * made the call, from which address and in which request. The two
 * together are the row of the audit.
 */
export function change(action: string, tenant: string | null, context: AuditContext): ChangeAudit {
  return {
    action,
    tenant,
    operator: context.operator,
    address: context.address,
    requestId: context.requestId,
  }
}

/**
 * The query of the list of the audit.
 *
 * The values are the ones of the query of the call: they are read, and
 * a value that is not understood is a refusal.
 */
export interface AuditQuery {
  /** The tenant of the list, or null for every tenant. */
  tenant?: string | null
  /** The action of the list, or null for every action. */
  action?: string | null
  /** The size of the page, as the query names it. */
  limit?: string | null
  /** The number of rows that are skipped, as the query names it. */
  offset?: string | null
  /** The format of the answer, as the query names it. */
  format?: string | null
}

/**
 * The rows of the audit that match a filter, and their number.
 *
 * The filter is the tenant, the action and the page. A tenant that
 * does not exist is a `404 not_found`, like everywhere else.
 */
export async function listAudit(
  options: AdministrationOptions,
  scope: AdminScope,
  query: AuditQuery
): Promise<AuditPage> {
  const format = auditFormat(query.format ?? null)
  // An export leaves the platform: it carries the rows in a file, and the
  // file is bigger than a page of the list.
  const maximum = format === 'json' ? MAX_PAGE_SIZE : MAX_EXPORT_ROWS
  const limit = wholeNumber(
    query.limit ?? undefined,
    format === 'json' ? DEFAULT_PAGE_SIZE : MAX_EXPORT_ROWS,
    1,
    maximum,
    'limit'
  )
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')

  // The audit of a credential that is scoped to a tenant is the audit
  // of that tenant: the filter of the query cannot widen it.
  const found = await tenantOf(options, scope, query.tenant)
  const tenant = found ? found.slug : null

  const action = query.action?.trim() || null
  const page = await options.audit?.list({ tenant, action, limit, offset })
  return {
    records: page?.records ?? [],
    total: page?.total ?? 0,
    limit,
    offset,
    format,
  }
}
