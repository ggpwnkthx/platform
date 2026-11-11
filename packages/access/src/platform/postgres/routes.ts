/**
 * The routes of the logins (spec §3.13).
 *
 * A domain of addresses, and an address of its own, name the tenant of a
 * login and the provider the login signs in at. The repository is the
 * storage of the rows: it holds no policy.
 *
 * A route that is not verified routes nothing: the login of an address
 * that names no verified route goes on with the default tenant of the
 * platform (§5.2.2).
 */

import { withPlatformScope, withScope, withTenantScope } from './scope'
import type { SqlClient } from './database'
import { auditedCte } from './audited'
import type { ChangeAudit, Scope } from '../../domains/administration'

/** The kind of the key of a route. */
export type RouteKind = 'domain' | 'address'

/** The state of a route. */
export type RouteStatus = 'pending' | 'verified' | 'rejected'

/** The method of the verification of a route. */
export type RouteVerification = 'dns' | 'operator'

/** The row of a route. */
export interface RouteRow {
  id: string
  kind: RouteKind
  /** The key of the route: the domain, or the address. */
  key: string
  tenantId: string
  /** The slug of the tenant of the route. */
  tenantSlug: string
  /** The provider of the tenant the login signs in at; null is its default. */
  providerSlug: string | null
  status: RouteStatus
  /** The method of the verification, when the route is verified. */
  verification: RouteVerification | null
  /** The token the owner of the domain publishes to prove that it owns it. */
  challenge: string | null
  /** The moment the route was verified. */
  verifiedAt: Date | null
  /** The operator that verified the route. */
  verifiedBy: string | null
  createdAt: Date
  updatedAt: Date
}

/** The fields of the creation of a route. */
export interface NewRoute {
  kind: RouteKind
  key: string
  tenantId: string
  /** The provider of the tenant the login signs in at. */
  providerSlug?: string | null
  /** The token the owner of the domain publishes to prove that it owns it. */
  challenge: string
  /** The state of the route. Default `pending`: a route waits for its proof. */
  status?: RouteStatus
}

/** The row of a route, as the database holds it. */
interface RouteRecord {
  id: string
  kind: RouteKind
  key: string
  tenant_id: string
  tenant_slug?: string
  provider_slug: string | null
  status: RouteStatus
  verification: RouteVerification | null
  challenge: string | null
  verified_at: Date | null
  verified_by: string | null
  created_at: Date
  updated_at: Date
}

/** The columns of a route. */
const COLUMNS = `id, kind, key, tenant_id, provider_slug, status, verification, challenge,
  verified_at, verified_by, created_at, updated_at`

/** The columns of a route, with the slug of its tenant. */
const READ_COLUMNS = `sso_routes.id, sso_routes.kind, sso_routes.key, sso_routes.tenant_id,
  tenants.slug as tenant_slug, sso_routes.provider_slug, sso_routes.status,
  sso_routes.verification, sso_routes.challenge, sso_routes.verified_at, sso_routes.verified_by,
  sso_routes.created_at, sso_routes.updated_at`

/** The tables a read of a route joins. */
const FROM = `from sso_routes join tenants on tenants.id = sso_routes.tenant_id`

/** Turns the row of the database into the row of the domain. */
function toRow(record: RouteRecord): RouteRow {
  return {
    id: record.id,
    kind: record.kind,
    key: record.key,
    tenantId: record.tenant_id,
    tenantSlug: record.tenant_slug ?? '',
    providerSlug: record.provider_slug,
    status: record.status,
    verification: record.verification,
    challenge: record.challenge,
    verifiedAt: record.verified_at,
    verifiedBy: record.verified_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

/** The storage of the routes of the logins. */
export class RouteRepository {
  constructor(private readonly db: SqlClient) {}

  /** The route of an id. */
  async findById(id: string): Promise<RouteRow | null> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<RouteRecord>(`select ${READ_COLUMNS} ${FROM} where sso_routes.id = $1`, [
          id,
        ])
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * The route of an id, in the scope of the call.
   *
   * The scope is the scope of the credential: the route of another
   * tenant is not a route the statement may read (spec §3.10).
   */
  async findByIdInScope(id: string, scope: Scope): Promise<RouteRow | null> {
    const rows = await withScope(
      this.db,
      scope,
      async (client) =>
        await client.query<RouteRecord>(`select ${READ_COLUMNS} ${FROM} where sso_routes.id = $1`, [
          id,
        ])
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * The route of a key, whatever its state.
   *
   * The administration reads the route of a key to change it: a route
   * that waits for its proof is a route the administration changes.
   */
  async findByKey(kind: RouteKind, key: string, scope: Scope): Promise<RouteRow | null> {
    const rows = await withScope(
      this.db,
      scope,
      async (client) =>
        await client.query<RouteRecord>(
          `select ${READ_COLUMNS} ${FROM}
         where sso_routes.kind = $1 and sso_routes.key = $2`,
          [kind, key]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * The route of an address.
   *
   * Only a verified route routes a login: a route that waits for its
   * proof routes nothing (spec §5.2.2).
   */
  async findByAddress(address: string): Promise<RouteRow | null> {
    return await this.findVerified('address', address)
  }

  /** The route of a domain. */
  async findByDomain(domain: string): Promise<RouteRow | null> {
    return await this.findVerified('domain', domain)
  }

  /** The verified route of a key. */
  private async findVerified(kind: RouteKind, key: string): Promise<RouteRow | null> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<RouteRecord>(
          `select ${READ_COLUMNS} ${FROM}
           where sso_routes.kind = $1 and sso_routes.key = $2 and sso_routes.status = 'verified'`,
          [kind, key]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * The routes of the platform, and their number.
   *
   * The order is the key: the order of the names is stable, and two
   * pages never show the same row twice.
   */
  async list(filter: {
    tenantId: string | null
    kind: RouteKind | null
    limit: number
    offset: number
  }): Promise<{ rows: RouteRow[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    if (filter.tenantId !== null) {
      params.push(filter.tenantId)
      conditions.push(`sso_routes.tenant_id = $${params.length}`)
    }
    if (filter.kind !== null) {
      params.push(filter.kind)
      conditions.push(`sso_routes.kind = $${params.length}`)
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
    const page = await withPlatformScope(this.db, async (client) => {
      const counted = await client.query<{ count: number }>(
        `select count(*)::int as count from sso_routes ${where.replace(/sso_routes\./g, '')}`,
        params
      )
      const rows = await client.query<RouteRecord>(
        `select ${READ_COLUMNS} ${FROM} ${where}
         order by sso_routes.kind, sso_routes.key
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, filter.limit, filter.offset]
      )
      return { rows, total: counted[0]?.count ?? 0 }
    })
    return { rows: page.rows.map(toRow), total: page.total }
  }

  /**
   * Creates a route.
   *
   * The row of the audit of the creation is written by the same statement
   * as the route: a route that is not audited does not exist
   * (spec §10.1).
   */
  async create(input: NewRoute, audit?: ChangeAudit | null): Promise<RouteRow> {
    const status = input.status ?? 'pending'
    const params: unknown[] = [
      input.kind,
      input.key,
      input.tenantId,
      input.providerSlug ?? null,
      status,
      status === 'verified' ? new Date() : null,
      input.challenge,
    ]
    const audited = auditedCte('inserted', params, audit)
    const rows = await withTenantScope(this.db, input.tenantId, async (client) => {
      const inserted = await client.query<RouteRecord>(
        `with inserted as (
         insert into sso_routes (kind, key, tenant_id, provider_slug, status, verified_at,
           challenge)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${COLUMNS}
       )${audited}
       select ${COLUMNS} from inserted`,
        params
      )
      return inserted
    })
    return (await this.findById(rows[0]!.id)) ?? toRow(rows[0]!)
  }

  /**
   * Changes a route.
   *
   * A route that names another tenant waits for its proof again: the
   * proof is about the domain, and the tenant is who owns it.
   *
   * The row of the audit of the change is written by the same statement
   * as the route (spec §10.1).
   */
  async update(
    id: string,
    input: { tenantId: string; providerSlug: string | null },
    scope: Scope,
    audit?: ChangeAudit | null
  ): Promise<RouteRow | null> {
    const existing = await this.findByIdInScope(id, scope)
    if (!existing) return null
    const params: unknown[] = [input.tenantId, input.providerSlug, id]
    const audited = auditedCte('updated', params, audit)
    const rows = await withScope(this.db, scope, async (client) => {
      const updated = await client.query<RouteRecord>(
        `with updated as (
         update sso_routes set tenant_id = $1, provider_slug = $2, status = 'pending',
           verification = null, verified_at = null, verified_by = null, updated_at = now()
         where id = $3
         returning ${COLUMNS}
       )${audited}
       select ${COLUMNS} from updated`,
        params
      )
      return updated
    })
    if (!rows[0]) return null
    return (await this.findById(id)) ?? toRow(rows[0]!)
  }

  /**
   * Verifies a route, or refuses it.
   *
   * The row of the audit of the change is written by the same statement
   * as the route (spec §10.1).
   */
  async verify(
    id: string,
    input: { status: RouteStatus; verification: RouteVerification; verifiedBy: string | null },
    scope: Scope,
    audit?: ChangeAudit | null
  ): Promise<RouteRow | null> {
    const existing = await this.findByIdInScope(id, scope)
    if (!existing) return null
    const params: unknown[] = [input.status, input.verification, input.verifiedBy, new Date(), id]
    const audited = auditedCte('updated', params, audit)
    const rows = await withScope(this.db, scope, async (client) => {
      const updated = await client.query<RouteRecord>(
        `with updated as (
         update sso_routes set status = $1, verification = $2, verified_by = $3,
           verified_at = $4, updated_at = now() where id = $5
         returning ${COLUMNS}
       )${audited}
       select ${COLUMNS} from updated`,
        params
      )
      return updated
    })
    if (!rows[0]) return null
    return (await this.findById(id)) ?? toRow(rows[0]!)
  }
}
