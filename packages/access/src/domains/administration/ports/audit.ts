/**
 * The port of the audit of the administration.
 *
 * The domain owns the rules of the twelve endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 */

/**
 * The row of the audit of the administration (spec §10.1).
 *
 * The row names what changed, when, and who changed it. It never carries
 * a secret: the operator is a fingerprint of the credential that made the
 * call.
 */
export interface AuditRecord {
  id: string
  /** The moment of the change. */
  at: Date
  /** What happened: `tenant.created`, `grant.revoked`, and so on. */
  action: string
  /** The identifier of the thing that changed. */
  targetId: string | null
  /** The slug of the tenant, when the change belongs to one. */
  tenant: string | null
  /** The fingerprint of the credential of the operator. */
  operator: string | null
  /** The address of the socket of the call. */
  address: string | null
  /** The identifier of the request. */
  requestId: string | null
}

/**
 * The audit of a change, as the storage writes it.
 *
 * The row of the audit and the row that changed are written by **one**
 * statement, so a change that is not audited does not exist (spec §2.1,
 * invariant 6). The identifier of the thing that changed is not here: the
 * storage takes it from the row it has just written.
 */
export interface ChangeAudit {
  /** What happened: `grant.created`, `grant.revoked`, and so on. */
  action: string
  /** The slug of the tenant, when the change belongs to one. */
  tenant: string | null
  /** The fingerprint of the credential of the operator. */
  operator: string | null
  /** The address of the socket of the call. */
  address: string | null
  /** The identifier of the request, as it is in the logs of the service. */
  requestId: string | null
}

/**
 * The facts of a call that the domain cannot know.
 *
 * The application layer knows them: who made the call, from which
 * address and in which request. The domain adds what happened and to
 * whom.
 */
export interface AuditContext {
  /** The fingerprint of the credential of the operator. */
  operator: string | null
  /** The address of the socket of the call. */
  address: string | null
  /** The identifier of the request, as it is in the logs of the service. */
  requestId: string | null
}

/** The filter of the list of the audit. */
export interface AuditFilter {
  /** The slug of the tenant, or null for every tenant. */
  tenant: string | null
  /** The action, or null for every action. */
  action: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/**
 * The format of the answer of the audit.
 *
 * `json` is the paginated answer of the list. `csv` and `jsonl` are the
 * exports: the rows leave the platform in a file that a spreadsheet or a
 * script reads (spec §10.12).
 */
export type AuditFormat = 'json' | 'csv' | 'jsonl'

/** A page of the audit and the number of the rows that match the filter. */
export interface AuditPage {
  records: AuditRecord[]
  /** The number of rows that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
  /** The format of the answer. */
  format: AuditFormat
}

/**
 * The rows of the audit that match a filter.
 *
 * The storage does not know the format of the answer and the page of the
 * list: it reads the rows that match the filter, and it says how many
 * they are.
 */
export interface AuditRows {
  /** The rows of the audit. */
  records: AuditRecord[]
  /** The number of rows that match the filter, the page included. */
  total: number
}

/**
 * The storage of the audit of the administration.
 *
 * The audit is a port like the others: the domain asks for the rows to
 * be read, and it never sees the table. The rows are written by the
 * statements that make the changes, so a change and the row of its
 * audit are written together.
 */
export interface AuditStore {
  /** The rows of the audit that match a filter, and their number. */
  list(filter: AuditFilter): Promise<AuditRows>
}
