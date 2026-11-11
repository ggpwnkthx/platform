/**
 * The credentials of the local providers of Access (spec §3.12).
 *
 * The repository is the storage of the rows: it holds no policy. The
 * rules of a sign-in live in the identity domain, and the rules of the
 * administration live in the administration domain.
 *
 * The verifier of a password is written by the administration and it is
 * never returned in clear: the listing never carries it, and the
 * administration answers the credentials without it.
 */

import { withPlatformScope, withScope, withTenantScope } from './scope'
import type { SqlClient } from './database'
import { auditedCte } from './audited'
import type { ChangeAudit, Scope } from '../../domains/administration'

/** The status of a credential. */
type CredentialStatus = 'active' | 'disabled'

/** The row of a credential. */
export interface CredentialRow {
  id: string
  tenantId: string
  /** The slug of the tenant of the credential. */
  tenantSlug: string
  providerId: string
  /** The slug of the provider of the credential. */
  providerSlug: string
  email: string
  /** The argon2id hash of the password. It is never answered. */
  passwordHash: string
  status: CredentialStatus
  /** The number of the failed sign-ins since the last success. */
  failedAttempts: number
  /** The moment the credential is locked until, when it is locked. */
  lockedUntil: Date | null
  passwordChangedAt: Date
  createdAt: Date
  updatedAt: Date
}

/** The fields of the creation of a credential. */
interface NewCredential {
  tenantId: string
  providerId: string
  email: string
  /** The argon2id hash of the password. */
  passwordHash: string
  status?: CredentialStatus
}

/** The fields of the change of a credential. Every field is optional. */
interface CredentialUpdate {
  email?: string
  /** The argon2id hash of the new password. */
  passwordHash?: string
  status?: CredentialStatus
}

/** The row of a credential, as the database holds it. */
interface CredentialRecord {
  id: string
  tenant_id: string
  tenant_slug: string
  provider_id: string
  provider_slug: string
  email: string
  password_hash: string
  status: CredentialStatus
  failed_attempts: number
  locked_until: Date | null
  password_changed_at: Date
  created_at: Date
  updated_at: Date
}

/** The columns of a credential. */
const COLUMNS = `local_credentials.id, local_credentials.tenant_id, local_credentials.provider_id,
  local_credentials.email, local_credentials.password_hash, local_credentials.status,
  local_credentials.failed_attempts, local_credentials.locked_until,
  local_credentials.password_changed_at, local_credentials.created_at, local_credentials.updated_at,
  tenants.slug as tenant_slug, tenant_providers.slug as provider_slug`

/** The tables a read of a credential joins. */
const FROM = `from local_credentials
  join tenants on tenants.id = local_credentials.tenant_id
  join tenant_providers on tenant_providers.id = local_credentials.provider_id`

/** Turns the row of the database into the row of the domain. */
function toRow(record: CredentialRecord): CredentialRow {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    tenantSlug: record.tenant_slug,
    providerId: record.provider_id,
    providerSlug: record.provider_slug,
    email: record.email,
    passwordHash: record.password_hash,
    status: record.status,
    failedAttempts: record.failed_attempts,
    lockedUntil: record.locked_until,
    passwordChangedAt: record.password_changed_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

/**
 * How many failures lock a credential, and for how long.
 *
 * The lock starts at the fifth failure and it doubles: a credential that
 * is hammered is locked for a while, and the lock is capped at a
 * quarter of an hour.
 */
const LOCK_AFTER_FAILURES = 5
const LOCK_BASE_SECONDS = 30
const LOCK_MAX_SECONDS = 900

/** The storage of the credentials of the local providers. */
export class CredentialRepository {
  constructor(private readonly db: SqlClient) {}

  /**
   * The credential of an address, at a provider of a tenant.
   *
   * The tenant and the provider are named by their slugs: the state of a
   * login carries the slugs, and the storage resolves the ids.
   */
  async findByEmail(
    tenantSlug: string,
    providerSlug: string,
    email: string
  ): Promise<CredentialRow | null> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<CredentialRecord>(
          `select ${COLUMNS} ${FROM}
           where tenants.slug = $1 and tenant_providers.slug = $2 and local_credentials.email = $3`,
          [tenantSlug, providerSlug, email]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * The credential of an id.
   *
   * The scope is the scope of the call: the credential of another tenant
   * is not a credential the statement may read (spec §3.10).
   */
  async findById(id: string, scope: Scope): Promise<CredentialRow | null> {
    const rows = await withScope(
      this.db,
      scope,
      async (client) =>
        await client.query<CredentialRecord>(
          `select ${COLUMNS} ${FROM} where local_credentials.id = $1`,
          [id]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /** The credentials that match a filter, and their number. */
  async list(filter: {
    tenantId: string | null
    providerSlug: string | null
    email: string | null
    limit: number
    offset: number
  }): Promise<{ rows: CredentialRow[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    if (filter.tenantId !== null) {
      params.push(filter.tenantId)
      conditions.push(`local_credentials.tenant_id = $${params.length}`)
    }
    if (filter.providerSlug !== null) {
      params.push(filter.providerSlug)
      conditions.push(`tenant_providers.slug = $${params.length}`)
    }
    if (filter.email !== null) {
      params.push(filter.email)
      conditions.push(`local_credentials.email = $${params.length}`)
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
    const page = await withPlatformScope(this.db, async (client) => {
      const counted = await client.query<{ count: number }>(
        `select count(*)::int as count from local_credentials
         join tenant_providers on tenant_providers.id = local_credentials.provider_id ${where}`,
        params
      )
      const rows = await client.query<CredentialRecord>(
        `select ${COLUMNS} ${FROM} ${where}
         order by local_credentials.tenant_id, local_credentials.email
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, filter.limit, filter.offset]
      )
      return { rows, total: counted[0]?.count ?? 0 }
    })
    return { rows: page.rows.map(toRow), total: page.total }
  }

  /**
   * Creates a credential.
   *
   * The row of the audit of the creation is written by the same statement
   * as the credential: a credential that is not audited does not exist
   * (spec §10.1).
   */
  async create(input: NewCredential, audit?: ChangeAudit | null): Promise<CredentialRow> {
    const params: unknown[] = [
      input.tenantId,
      input.providerId,
      input.email,
      input.passwordHash,
      input.status ?? 'active',
    ]
    const audited = auditedCte('inserted', params, audit)
    const rows = await withTenantScope(this.db, input.tenantId, async (client) => {
      const inserted = await client.query<CredentialRecord>(
        `with inserted as (
         insert into local_credentials (tenant_id, provider_id, email, password_hash, status)
         values ($1, $2, $3, $4, $5)
         returning id, tenant_id, provider_id, email, password_hash, status, failed_attempts,
           locked_until, password_changed_at, created_at, updated_at
       )${audited}
       select id, tenant_id, provider_id, email, password_hash, status, failed_attempts,
         locked_until, password_changed_at, created_at, updated_at from inserted`,
        params
      )
      return inserted
    })
    const id = rows[0]!.id
    return (await this.findById(id, { tenant: input.tenantId })) ?? toRow(rows[0]!)
  }

  /**
   * Changes a credential.
   *
   * A new password clears the failures and the lock of the credential:
   * the operator gave the caller a new password, and the guessing starts
   * again.
   */
  async update(
    id: string,
    changes: CredentialUpdate,
    scope: Scope,
    audit?: ChangeAudit | null
  ): Promise<CredentialRow | null> {
    const assignments: string[] = []
    const params: unknown[] = []
    const set = (column: string, value: unknown): void => {
      params.push(value)
      assignments.push(`${column} = $${params.length}`)
    }
    if (changes.email !== undefined) set('email', changes.email)
    if (changes.status !== undefined) set('status', changes.status)
    if (changes.passwordHash !== undefined) {
      set('password_hash', changes.passwordHash)
      set('failed_attempts', 0)
      set('locked_until', null)
      set('password_changed_at', new Date())
    }
    if (assignments.length === 0) {
      assignments.push('id = id')
    } else {
      set('updated_at', new Date())
    }
    params.push(id)
    const idParam = params.length
    const audited = auditedCte('updated', params, audit)
    const existing = await this.findById(id, scope)
    if (!existing) return null
    const rows = await withTenantScope(this.db, existing.tenantId, async (client) => {
      const updated = await client.query<CredentialRecord>(
        `with updated as (
         update local_credentials set ${assignments.join(', ')} where id = $${idParam}
         returning id, tenant_id, provider_id, email, password_hash, status, failed_attempts,
           locked_until, password_changed_at, created_at, updated_at
       )${audited}
       select id, tenant_id, provider_id, email, password_hash, status, failed_attempts,
         locked_until, password_changed_at, created_at, updated_at from updated`,
        params
      )
      return updated
    })
    if (!rows[0]) return null
    return (await this.findById(id, scope)) ?? toRow(rows[0])
  }

  /** Removes a credential, and writes the row of its audit with it. */
  async remove(id: string, scope: Scope, audit?: ChangeAudit | null): Promise<boolean> {
    const existing = await this.findById(id, scope)
    if (!existing) return false
    const params: unknown[] = [id]
    const audited = auditedCte('removed', params, audit)
    const rows = await withTenantScope(this.db, existing.tenantId, async (client) => {
      const removed = await client.query<CredentialRecord>(
        `with removed as (
         delete from local_credentials where id = $1
         returning id
       )${audited}
       select id from removed`,
        params
      )
      return removed
    })
    return rows.length > 0
  }

  /**
   * Counts a failed sign-in and locks the credential when it has failed
   * too much.
   *
   * The lock grows with the failures: a credential that is hammered is
   * locked for a while, and the lock is capped at a quarter of an hour.
   */
  async recordFailure(id: string): Promise<CredentialRow | null> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<CredentialRecord>(
          `update local_credentials
           set failed_attempts = failed_attempts + 1,
             locked_until = case
               when failed_attempts + 1 >= ${LOCK_AFTER_FAILURES} then
                 now() + make_interval(secs => least(${LOCK_BASE_SECONDS} * (1 << (failed_attempts + 1 - ${LOCK_AFTER_FAILURES})), ${LOCK_MAX_SECONDS})::int)
               else locked_until
             end,
             updated_at = now()
           where id = $1
           returning id, tenant_id, provider_id, email, password_hash, status, failed_attempts,
             locked_until, password_changed_at, created_at, updated_at`,
          [id]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /** Clears the failures of a credential that signed in. */
  async clearFailures(id: string): Promise<void> {
    await withPlatformScope(
      this.db,
      async (client) =>
        await client.query(
          `update local_credentials set failed_attempts = 0, locked_until = null, updated_at = now()
           where id = $1`,
          [id]
        )
    )
  }
}
