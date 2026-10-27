/**
 * The client of the administration of the access service.
 *
 * The client acts with one credential: the credential of the platform,
 * or the credential of a tenant. Which one is the business of the scope
 * of the operator: the client is handed the credential, and it never
 * chooses it.
 */

import { bodyOf, call, type Fetch } from '../transport'
import { refusalOf } from './errors'
import type {
  AdminPage,
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

/** The outcome of one item of a batch. */
export interface BatchOutcome {
  readonly externalSubject?: string
  readonly id: string | null
  readonly created: boolean
  readonly error?: string
  readonly message?: string
}

/** The query of a list: the filters and the page. */
type Query = Record<string, string | number | boolean | null | undefined>

/** The client of the administration of the access service. */
export class AdminClient {
  readonly #options: AdminClientOptions
  readonly #fetch: Fetch

  constructor(options: AdminClientOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? fetch
  }

  async #send(method: string, path: string, query: Query = {}, body?: unknown): Promise<Response> {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      search.set(key, String(value))
    }
    const suffix = search.toString()
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#options.credential}`,
      accept: 'application/json',
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await call(
      'access service',
      this.#fetch,
      `${this.#options.accessUrl}/v1/admin${path}${suffix ? `?${suffix}` : ''}`,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      this.#options.timeoutMs
    )
    if (!response.ok) throw await refusalOf(response)
    return response
  }

  async #json<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    return (await bodyOf(await this.#send(method, path, query, body))) as T
  }

  async #page<T>(path: string, key: string, query: Query): Promise<AdminPage<T>> {
    const body = await this.#json<Record<string, unknown>>('GET', path, query)
    return {
      rows: (body[key] as T[] | undefined) ?? [],
      total: Number(body.total ?? 0),
      limit: Number(body.limit ?? 0),
      offset: Number(body.offset ?? 0),
    }
  }

  /** The tenants, with their counts. */
  async tenants(): Promise<readonly Tenant[]> {
    const body = await this.#json<{ tenants?: Tenant[] }>('GET', '/tenants')
    return body.tenants ?? []
  }

  /** Creates a tenant, or updates the tenant of that slug. */
  async saveTenant(input: TenantInput): Promise<{ tenant: Tenant; created: boolean }> {
    const response = await this.#send('POST', '/tenants', {}, input)
    return { tenant: (await bodyOf(response)) as Tenant, created: response.status === 201 }
  }

  /** A page of the principals. */
  async principals(query: {
    tenant?: string
    status?: string
    email?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<Principal>> {
    return await this.#page<Principal>('/users', 'principals', query)
  }

  /** Creates a principal, or updates the principal of that external subject. */
  async savePrincipal(input: PrincipalInput): Promise<{ principal: Principal; created: boolean }> {
    const response = await this.#send('POST', '/users', {}, input)
    return { principal: (await bodyOf(response)) as Principal, created: response.status === 201 }
  }

  /**
   * Registers a batch of principals. Every item is written on its own,
   * and the answer names the outcome of each one.
   */
  async savePrincipals(inputs: readonly PrincipalInput[]): Promise<readonly BatchOutcome[]> {
    const body = await this.#json<{ principals?: BatchOutcome[] }>(
      'POST',
      '/users',
      {},
      {
        principals: inputs,
      }
    )
    return body.principals ?? []
  }

  /** A page of the grants. */
  async grants(query: {
    tenant?: string
    userId?: string
    live?: boolean
    limit?: number
    offset?: number
  }): Promise<AdminPage<Grant>> {
    return await this.#page<Grant>('/grants', 'grants', query)
  }

  /** Creates a grant, or updates the grant of that tuple. */
  async saveGrant(input: GrantInput): Promise<Grant> {
    return await this.#json<Grant>('PUT', '/grants', {}, input)
  }

  /** Revokes a grant. */
  async revokeGrant(id: string): Promise<void> {
    await this.#send('DELETE', `/grants/${encodeURIComponent(id)}`)
  }

  /** A page of the groups. */
  async groups(query: {
    tenant?: string
    key?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<Group>> {
    return await this.#page<Group>('/groups', 'groups', query)
  }

  /** Creates a group, or changes it: the call replaces the membership. */
  async saveGroup(input: GroupInput): Promise<Group> {
    return await this.#json<Group>('POST', '/groups', {}, input)
  }

  /** A page of the roles. */
  async roles(query: {
    tenant?: string
    key?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<Role>> {
    return await this.#page<Role>('/roles', 'roles', query)
  }

  /** Creates a role, or changes it: the call replaces the memberships. */
  async saveRole(input: RoleInput): Promise<Role> {
    return await this.#json<Role>('PUT', '/roles', {}, input)
  }

  /** Removes a role that no grant names. */
  async removeRole(id: string): Promise<void> {
    await this.#send('DELETE', `/roles/${encodeURIComponent(id)}`)
  }

  /** A page of the audit of the administration. */
  async audit(query: {
    tenant?: string
    action?: string
    limit?: number
    offset?: number
  }): Promise<AdminPage<AuditRecord>> {
    return await this.#page<AuditRecord>('/audit', 'records', query)
  }

  /** The export of the audit, as the file the service answers. */
  async exportAudit(query: {
    tenant?: string
    action?: string
    format: 'csv' | 'jsonl'
  }): Promise<string> {
    const response = await this.#send('GET', '/audit', { ...query, limit: 10_000 })
    return await response.text()
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
    const rows: T[] = []
    let offset = 0
    while (rows.length < bound) {
      const page = await read({ limit: 200, offset })
      rows.push(...page.rows)
      offset += page.rows.length
      if (page.rows.length === 0 || offset >= page.total) return { rows, complete: true }
    }
    return { rows, complete: false }
  }
}
