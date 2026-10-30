/**
 * The client of the administration of Access.
 *
 * The client acts with one credential: the credential of the platform,
 * or the credential of a tenant. Which one is the business of the scope
 * of the operator: the client is handed the credential, and it never
 * chooses it.
 *
 * The contract is read in the client of the platform (`@platform/client`):
 * the console and the CLI speak to the same services and read the same
 * paths. What is the console's is the way it shows a refusal.
 */

import { AccessAdminClient as PlatformAdminClient } from '@platform/client'
import { transportOf, type Fetch } from '../transport'
import { failureOf } from './errors'
import type {
  AdminPage,
  BatchOutcome,
  AuditRecord,
  Grant,
  GrantInput,
  Group,
  GroupInput,
  Principal,
  PrincipalInput,
  Role,
  RoleInput,
  Tenant,
  TenantInput,
} from './types'

/** The options of the client of the administration. */
export interface AdminClientOptions {
  readonly accessUrl: string
  readonly credential: string
  readonly timeoutMs: number
  readonly fetch?: Fetch
}

/** The client of the administration of Access. */
export class AdminClient {
  readonly #client: PlatformAdminClient

  constructor(options: AdminClientOptions) {
    this.#client = new PlatformAdminClient({
      baseUrl: options.accessUrl,
      credential: options.credential,
      transport: transportOf('Access', options.fetch ?? fetch, options.timeoutMs),
    })
  }

  /** The tenants, with their counts. */
  async tenants(): Promise<readonly Tenant[]> {
    try {
      return await this.#client.tenants()
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Creates a tenant, or updates the tenant of that slug. */
  async saveTenant(input: TenantInput): Promise<{ tenant: Tenant; created: boolean }> {
    try {
      return await this.#client.saveTenant(input)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** A page of the principals. */
  async principals(query: {
    tenant?: string
    status?: string
    email?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<Principal>> {
    try {
      return await this.#client.principals(query)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Creates a principal, or updates the principal of that external subject. */
  async savePrincipal(input: PrincipalInput): Promise<{ principal: Principal; created: boolean }> {
    try {
      return await this.#client.savePrincipal(input)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /**
   * Registers a batch of principals. Every item is written on its own,
   * and the answer names the outcome of each one.
   */
  async savePrincipals(inputs: readonly PrincipalInput[]): Promise<readonly BatchOutcome[]> {
    try {
      return await this.#client.savePrincipals(inputs)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** A page of the grants. */
  async grants(query: {
    tenant?: string
    userId?: string
    live?: boolean
    limit?: number
    offset?: number
  }): Promise<AdminPage<Grant>> {
    try {
      return await this.#client.grants(query)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Creates a grant, or updates the grant of that tuple. */
  async saveGrant(input: GrantInput): Promise<Grant> {
    try {
      return await this.#client.saveGrant(input)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Revokes a grant. */
  async revokeGrant(id: string): Promise<void> {
    try {
      await this.#client.revokeGrant(id)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** A page of the groups. */
  async groups(query: {
    tenant?: string
    key?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<Group>> {
    try {
      return await this.#client.groups(query)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Creates a group, or changes it: the call replaces the membership. */
  async saveGroup(input: GroupInput): Promise<Group> {
    try {
      return await this.#client.saveGroup(input)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** A page of the roles. */
  async roles(query: {
    tenant?: string
    key?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<Role>> {
    try {
      return await this.#client.roles(query)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Creates a role, or changes it: the call replaces the memberships. */
  async saveRole(input: RoleInput): Promise<Role> {
    try {
      return await this.#client.saveRole(input)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Removes a role that no grant names. */
  async removeRole(id: string): Promise<void> {
    try {
      await this.#client.removeRole(id)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** A page of the audit of the administration. */
  async audit(query: {
    tenant?: string
    action?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<AuditRecord>> {
    try {
      return await this.#client.audit(query)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** The export of the audit, as the file the service answers. */
  async exportAudit(query: {
    tenant?: string
    action?: string
    format: 'csv' | 'jsonl'
  }): Promise<string> {
    try {
      return await this.#client.exportAudit(query)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /**
   * Every row of a list, page after page, up to a bound.
   *
   * The bound keeps a page of the console from reading a tenant of a
   * hundred thousand rows in one request.
   */
  async all<T>(
    read: (page: { limit: number; offset: number }) => Promise<AdminPage<T>>,
    bound = 1000
  ): Promise<{ rows: T[]; complete: boolean }> {
    try {
      return await this.#client.all(read, bound)
    } catch (error) {
      throw failureOf(error)
    }
  }
}
