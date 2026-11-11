/**
 * The port of the providers.
 *
 * The domain owns the rules of the providers; the storage is a port that
 * the composition root fulfils. The domain knows nothing about PostgreSQL
 * and nothing about the shape of the rows.
 *
 * A provider is named by its **slug** inside its tenant, and the slug
 * never changes: a principal carries it (§6.2). The secret of a provider
 * is never held by the domain: it is written and it is read by the
 * storage, and the domain only says whether it changes.
 */

import type { ChangeAudit } from './audit'
import type { Scope } from './scope'

/** A provider of a tenant. */
export interface Provider {
  id: string
  /** The id of the tenant of the provider. */
  tenantId: string
  /** The kind of the provider: an OpenID Connect one, or the local one. */
  kind: 'oidc' | 'local'
  /** The slug of the tenant of the provider. */
  tenant: string
  /** The name of the provider inside its tenant. */
  slug: string
  displayName: string
  enabled: boolean
  /** The issuer of the provider. */
  issuer: string
  /** The client id of Access at the provider. */
  idpClientId: string
  /** The callback of Access at the provider. */
  idpRedirectUri: string
  /** The scopes Access asks the provider for. */
  idpScopes: string[]
  /** The algorithms a token of the provider may use. */
  idpAlgorithms: string[]
  createdAt: Date
}

/** The registration of a provider, in clear. */
export interface ProviderRegistration {
  /** The slug of the tenant of the provider. */
  tenant: string
  /**
   * The kind of the provider.
   *
   * A local provider holds its own identities and has no registration
   * (spec §5.4).
   */
  kind?: 'oidc' | 'local'
  /** The name of the provider inside its tenant. */
  slug: string
  displayName?: string
  enabled?: boolean
  /** The issuer of the provider. */
  issuer?: string
  /** The client id of Access at the provider. */
  idpClientId?: string
  /** The client secret of Access at the provider, in clear. */
  idpClientSecret?: string
  /** The callback of Access at the provider. */
  idpRedirectUri?: string
  /** The scopes Access asks the provider for. */
  idpScopes?: string[]
  /** The algorithms a token of the provider may use. */
  idpAlgorithms?: string[]
}

/** The filter of the list of the providers. */
export interface ProviderFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The slug of the provider, or null for every slug. */
  slug: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of providers and the number of the providers that match. */
export interface ProviderPage {
  providers: Provider[]
  /** The number of providers that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/** The storage of the providers. */
export interface ProviderStore {
  /** The provider of a slug, in the scope of a tenant. */
  findBySlug(tenantId: string, slug: string): Promise<Provider | null>
  /**
   * The provider of an id.
   *
   * The scope is the scope of the call: the provider of another tenant is
   * not a provider the statement may read (spec §3.10).
   */
  findById(id: string, scope: Scope): Promise<Provider | null>
  /** The providers that match a filter, and their number. */
  list(filter: ProviderFilter): Promise<ProviderPage>
  /**
   * Creates a provider.
   *
   * The row of the audit of the change is written by the same statement
   * as the provider: a provider that is not audited does not exist.
   */
  create(
    registration: {
      tenantId: string
      kind?: 'oidc' | 'local'
      slug: string
      displayName: string
      enabled: boolean
      issuer: string
      idpClientId: string
      idpClientSecret: string
      idpRedirectUri: string
      idpScopes: string[]
      idpAlgorithms: string[]
    },
    audit: ChangeAudit
  ): Promise<Provider>
  /** Changes a provider, and writes the row of its audit with it. */
  update(
    id: string,
    changes: {
      displayName?: string
      enabled?: boolean
      issuer?: string
      idpClientId?: string
      idpClientSecret?: string
      idpRedirectUri?: string
      idpScopes?: string[]
      idpAlgorithms?: string[]
    },
    scope: Scope,
    audit: ChangeAudit
  ): Promise<Provider | null>
  /** Removes a provider, and writes the row of its audit with it. */
  remove(id: string, scope: Scope, audit: ChangeAudit): Promise<boolean>
}
