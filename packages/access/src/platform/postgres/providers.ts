/**
 * The providers of the tenants of Access (spec §3.11).
 *
 * The repository is the storage of the rows: it holds no policy. A tenant
 * signs its people in at one or more providers, and every provider of the
 * tenant has a row here: the login names the provider it signs in at, and
 * the principal it creates belongs to that provider.
 *
 * The secret of a provider is encrypted before it is written and it is
 * never returned in clear by the methods of the listing: only the method
 * that reads a secret decrypts it, and only for the caller that needs it.
 */

import { withPlatformScope, withTenantScope } from './scope'
import type { SqlClient } from './database'
import { auditedCte } from './audited'
import type { ChangeAudit } from '../../domains/administration'
import { SecretError, type SecretCipher } from './secrets'

/** The kind of a provider. */
type ProviderKind = 'oidc' | 'local'

/** The row of a provider. */
export interface ProviderRow {
  id: string
  tenantId: string
  /** The slug of the tenant of the provider. */
  tenantSlug: string
  kind: ProviderKind
  /** The name of the provider inside its tenant: it never changes. */
  slug: string
  displayName: string
  enabled: boolean
  /** The issuer of an OpenID Connect provider. */
  issuer: string | null
  /** The client id of Access at an OpenID Connect provider. */
  idpClientId: string | null
  /** The client secret of Access at the provider, encrypted at rest. */
  idpClientSecret: Uint8Array | null
  /** The url of Access at an OpenID Connect provider. */
  idpRedirectUri: string | null
  /** The scopes Access asks an OpenID Connect provider for. */
  idpScopes: string[]
  /** The algorithms a token of an OpenID Connect provider may use. */
  idpAlgorithms: string[]
  createdAt: Date
  updatedAt: Date
}

/** The fields of the creation of a provider. */
export interface NewProvider {
  tenantId: string
  kind?: ProviderKind
  slug: string
  displayName: string
  enabled?: boolean
  issuer?: string | null
  idpClientId?: string | null
  /** The client secret of the provider, encrypted at rest. */
  idpClientSecret?: Uint8Array | null
  idpRedirectUri?: string | null
  idpScopes?: string[]
  idpAlgorithms?: string[]
}

/** The fields of the change of a provider. Every field is optional. */
export interface ProviderUpdate {
  displayName?: string
  enabled?: boolean
  issuer?: string | null
  idpClientId?: string | null
  /** The client secret of the provider, encrypted at rest. */
  idpClientSecret?: Uint8Array | null
  idpRedirectUri?: string | null
  idpScopes?: string[]
  idpAlgorithms?: string[]
}

/** The row of a provider, as the database holds it. */
interface ProviderRecord {
  id: string
  tenant_id: string
  tenant_slug?: string
  kind: ProviderKind
  slug: string
  display_name: string
  enabled: boolean
  issuer: string | null
  idp_client_id: string | null
  idp_client_secret: Uint8Array | null
  idp_redirect_uri: string | null
  idp_scopes: string[]
  idp_algorithms: string[]
  created_at: Date
  updated_at: Date
}

/**
 * The columns of a provider.
 *
 * The writes read the columns of the row alone: a `returning` clause
 * cannot join another table.
 */
const COLUMNS = `id, tenant_id, kind, slug, display_name, enabled, issuer, idp_client_id,
  idp_client_secret, idp_redirect_uri, idp_scopes, idp_algorithms, created_at, updated_at`

/** The columns of a provider, with the slug of its tenant. */
const READ_COLUMNS = `tenant_providers.id, tenant_providers.tenant_id, tenants.slug as tenant_slug,
  tenant_providers.kind, tenant_providers.slug, tenant_providers.display_name,
  tenant_providers.enabled, tenant_providers.issuer, tenant_providers.idp_client_id,
  tenant_providers.idp_client_secret, tenant_providers.idp_redirect_uri,
  tenant_providers.idp_scopes, tenant_providers.idp_algorithms, tenant_providers.created_at,
  tenant_providers.updated_at`

/** The tables a read of a provider joins. */
const FROM = `from tenant_providers join tenants on tenants.id = tenant_providers.tenant_id`

/** Turns the row of the database into the row of the domain. */
function toRow(record: ProviderRecord): ProviderRow {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    tenantSlug: record.tenant_slug ?? '',
    kind: record.kind,
    slug: record.slug,
    displayName: record.display_name,
    enabled: record.enabled,
    issuer: record.issuer,
    idpClientId: record.idp_client_id,
    idpClientSecret: record.idp_client_secret,
    idpRedirectUri: record.idp_redirect_uri,
    idpScopes: record.idp_scopes,
    idpAlgorithms: record.idp_algorithms,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

/** The storage of the providers of the tenants. */
export class ProviderRepository {
  constructor(
    private readonly db: SqlClient,
    /** The cipher of the client secrets; without it a provider cannot be written. */
    private readonly cipher?: SecretCipher
  ) {}

  /** The provider of an id. */
  async findById(id: string): Promise<ProviderRow | null> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<ProviderRecord>(
          `select ${READ_COLUMNS} ${FROM} where tenant_providers.id = $1`,
          [id]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /** The providers of a tenant, in the order they were created. */
  async listByTenant(tenantId: string): Promise<ProviderRow[]> {
    const rows = await withTenantScope(
      this.db,
      tenantId,
      async (client) =>
        await client.query<ProviderRecord>(
          `select ${READ_COLUMNS} ${FROM} where tenant_providers.tenant_id = $1
           order by tenant_providers.slug`,
          [tenantId]
        )
    )
    return rows.map(toRow)
  }

  /** The provider of a slug of a tenant. */
  async findByTenantAndSlug(tenantId: string, slug: string): Promise<ProviderRow | null> {
    const rows = await withTenantScope(
      this.db,
      tenantId,
      async (client) =>
        await client.query<ProviderRecord>(
          `select ${READ_COLUMNS} ${FROM}
           where tenant_providers.tenant_id = $1 and tenant_providers.slug = $2`,
          [tenantId, slug]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * The client secret of a provider, in clear.
   *
   * Only the caller that needs the secret of a provider reads it: the
   * client of the provider, and nobody else.
   */
  async readSecret(id: string): Promise<string | null> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<{ idp_client_secret: Uint8Array | null }>(
          `select idp_client_secret from tenant_providers where id = $1`,
          [id]
        )
    )
    const stored = rows[0]?.idp_client_secret
    if (!stored) return null
    return this.decrypted(stored)
  }

  /**
   * The providers of the platform, and their number.
   *
   * The order is the slug: the order of the names is stable, and two
   * pages never show the same row twice.
   */
  async list(filter: {
    tenantId: string | null
    slug: string | null
    limit: number
    offset: number
  }): Promise<{ rows: ProviderRow[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    if (filter.tenantId !== null) {
      params.push(filter.tenantId)
      conditions.push(`tenant_providers.tenant_id = $${params.length}`)
    }
    if (filter.slug !== null) {
      params.push(filter.slug)
      conditions.push(`tenant_providers.slug = $${params.length}`)
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
    const page = await withPlatformScope(this.db, async (client) => {
      const counted = await client.query<{ count: number }>(
        `select count(*)::int as count from tenant_providers ${where.replace(/tenant_providers\./g, '')}`,
        params
      )
      const rows = await client.query<ProviderRecord>(
        `select ${READ_COLUMNS} ${FROM} ${where}
         order by tenant_providers.tenant_id, tenant_providers.slug
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, filter.limit, filter.offset]
      )
      return { rows, total: counted[0]?.count ?? 0 }
    })
    return { rows: page.rows.map(toRow), total: page.total }
  }

  /**
   * Creates a provider.
   *
   * The row of the audit of the creation is written by the same statement
   * as the provider: a provider that is not audited does not exist
   * (spec §10.1).
   */
  async create(input: NewProvider, audit?: ChangeAudit | null): Promise<ProviderRow> {
    const params: unknown[] = [
      input.tenantId,
      input.kind ?? 'oidc',
      input.slug,
      input.displayName,
      input.enabled ?? true,
      input.issuer ?? null,
      input.idpClientId ?? null,
      input.idpClientSecret ?? null,
      input.idpRedirectUri ?? null,
      input.idpScopes ?? ['openid', 'email', 'profile'],
      input.idpAlgorithms ?? ['RS256'],
    ]
    const audited = auditedCte('inserted', params, audit)
    const rows = await withTenantScope(this.db, input.tenantId, async (client) => {
      const inserted = await client.query<ProviderRecord>(
        `with inserted as (
         insert into tenant_providers (tenant_id, kind, slug, display_name, enabled, issuer,
           idp_client_id, idp_client_secret, idp_redirect_uri, idp_scopes, idp_algorithms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning ${COLUMNS}
       )${audited}
       select ${COLUMNS} from inserted`,
        params
      )
      return inserted
    })
    const id = rows[0]!.id
    // The row is read back: the answer of the administration names the
    // tenant of the provider, and the statement that wrote it cannot
    // join another table.
    return (await this.findById(id)) ?? toRow(rows[0]!)
  }

  /**
   * Changes a provider.
   *
   * A secret that is not given keeps the one that is stored: a caller
   * that changes the name of a provider does not have to know its
   * secret.
   *
   * The row of the audit of the change is written by the same statement
   * as the provider (spec §10.1).
   */
  async update(
    id: string,
    input: ProviderUpdate,
    audit?: ChangeAudit | null
  ): Promise<ProviderRow | null> {
    const existing = await this.findById(id)
    if (!existing) return null
    const assignments: string[] = []
    const params: unknown[] = []
    const set = (column: string, value: unknown): void => {
      params.push(value)
      assignments.push(`${column} = $${params.length}`)
    }
    if (input.displayName !== undefined) set('display_name', input.displayName)
    if (input.enabled !== undefined) set('enabled', input.enabled)
    if (input.issuer !== undefined) set('issuer', input.issuer)
    if (input.idpClientId !== undefined) set('idp_client_id', input.idpClientId)
    if (input.idpClientSecret !== undefined) set('idp_client_secret', input.idpClientSecret)
    if (input.idpRedirectUri !== undefined) set('idp_redirect_uri', input.idpRedirectUri)
    if (input.idpScopes !== undefined) set('idp_scopes', input.idpScopes)
    if (input.idpAlgorithms !== undefined) set('idp_algorithms', input.idpAlgorithms)
    if (assignments.length === 0) {
      assignments.push('id = id')
    } else {
      set('updated_at', new Date())
    }
    params.push(id)
    // The number of the id is read before the audit is appended: the
    // parameters of the audit are always the last five.
    const idParam = params.length
    const audited = auditedCte('updated', params, audit)
    const rows = await withTenantScope(this.db, existing.tenantId, async (client) => {
      const updated = await client.query<ProviderRecord>(
        `with updated as (
         update tenant_providers set ${assignments.join(', ')} where id = $${idParam}
         returning ${COLUMNS}
       )${audited}
       select ${COLUMNS} from updated`,
        params
      )
      return updated
    })
    if (!rows[0]) return null
    return (await this.findById(id)) ?? toRow(rows[0])
  }

  /**
   * Removes a provider.
   *
   * The row of the audit of the removal is written by the same statement
   * as the removal (spec §10.1).
   */
  async remove(id: string, audit?: ChangeAudit | null): Promise<boolean> {
    const existing = await this.findById(id)
    if (!existing) return false
    const params: unknown[] = [id]
    const audited = auditedCte('removed', params, audit)
    const rows = await withTenantScope(this.db, existing.tenantId, async (client) => {
      const removed = await client.query<ProviderRecord>(
        `with removed as (
         delete from tenant_providers where id = $1
         returning ${COLUMNS}
       )${audited}
       select ${COLUMNS} from removed`,
        params
      )
      return removed
    })
    return rows.length > 0
  }

  /** Decrypts a secret that is read. */
  private decrypted(stored: Uint8Array): string {
    if (!this.cipher) {
      throw new SecretError(
        'the client secrets cannot be read: the key of the deployment is not set'
      )
    }
    return this.cipher.decrypt(stored)
  }
}
