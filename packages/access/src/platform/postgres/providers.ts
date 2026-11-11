/**
 * The slug of the default provider of a tenant.
 *
 * The default provider is the one the administration writes: the row of
 * the tenant carries its registration, and the logins of the tenant that
 * name no provider use it (spec §3.11).
 *
 * The slug is the same in the identity domain and in the platform: the
 * two domains do not share a constant, and the specification names it.
 */
export const DEFAULT_PROVIDER_SLUG = 'default'

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
import { SecretError, type SecretCipher } from './secrets'

/** The kind of a provider. */
type ProviderKind = 'oidc' | 'local'

/** The row of a provider. */
export interface ProviderRow {
  id: string
  tenantId: string
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

/** The columns of a provider. */
const COLUMNS = `id, tenant_id, kind, slug, display_name, enabled, issuer, idp_client_id,
  idp_client_secret, idp_redirect_uri, idp_scopes, idp_algorithms, created_at, updated_at`

/** Turns the row of the database into the row of the domain. */
function toRow(record: ProviderRecord): ProviderRow {
  return {
    id: record.id,
    tenantId: record.tenant_id,
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
          `select ${COLUMNS} from tenant_providers where id = $1`,
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
          `select ${COLUMNS} from tenant_providers where tenant_id = $1 order by slug`,
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
          `select ${COLUMNS} from tenant_providers where tenant_id = $1 and slug = $2`,
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

  /** Creates a provider. */
  async create(input: NewProvider): Promise<ProviderRow> {
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<ProviderRecord>(
          `insert into tenant_providers (tenant_id, kind, slug, display_name, enabled, issuer,
             idp_client_id, idp_client_secret, idp_redirect_uri, idp_scopes, idp_algorithms)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           returning ${COLUMNS}`,
          [
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
        )
    )
    return toRow(rows[0]!)
  }

  /**
   * Changes a provider.
   *
   * A secret that is not given keeps the one that is stored: a caller
   * that changes the name of a provider does not have to know its
   * secret.
   */
  async update(id: string, input: ProviderUpdate): Promise<ProviderRow | null> {
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
    const rows = await withPlatformScope(
      this.db,
      async (client) =>
        await client.query<ProviderRecord>(
          `update tenant_providers set ${assignments.join(', ')} where id = $${params.length}
           returning ${COLUMNS}`,
          params
        )
    )
    return rows[0] ? toRow(rows[0]) : null
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
