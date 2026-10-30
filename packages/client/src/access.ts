/**
 * The clients of Access.
 *
 * Access is the service that decides what a caller may do, and it
 * administers the tenants, the principals, the groups, the roles and the
 * grants. The console administers it with the credential of an operator,
 * and the CLI asks it the same questions.
 *
 * The decision contract is a contract of its own: a client may ask for
 * a decision, and it may ask for the context of a principal, and it
 * never computes either of them locally.
 */

import {
  bodyOf,
  type ClientAnswer,
  type ClientMethod,
  type ClientTransport,
  expectSuccess,
  type Query,
  queryOf,
} from './transport'
import type {
  AccessContext,
  AdminPage,
  AuditRecord,
  BatchOutcome,
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

/** The options of a client of Access. */
export interface AccessClientOptions {
  /** The address of Access. */
  readonly baseUrl: string
  /** The credential of the call, when the call carries one. */
  readonly credential?: string
  /** The transport of the calls. */
  readonly transport: ClientTransport
}

/** The query of a list of the administration. */
export type AdminQuery = Query

/** The question of the access context. */
export interface ContextQuestion {
  readonly subject: string
  readonly tenantId: string
  readonly workspaceId: string
  readonly routeId: string
}

/** The client of Access. */
export class AccessClient {
  readonly #options: AccessClientOptions

  constructor(options: AccessClientOptions) {
    this.#options = options
  }

  /** The credential of the client, when it has one. */
  credentialOf(): string | undefined {
    return this.#options.credential
  }

  /**
   * Sends a request to the administration and reads the answer.
   *
   * @param method the method of the request.
   * @param path the path of the request, after `/v1/admin`.
   * @param query the query of the request.
   * @param body the body of the request.
   */
  async send(
    method: ClientMethod,
    path: string,
    query?: AdminQuery,
    body?: unknown
  ): Promise<ClientAnswer> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(this.#options.credential ? { authorization: `Bearer ${this.#options.credential}` } : {}),
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const search = queryOf(query)
    const answer = await this.#options.transport.send({
      method,
      url: `${this.#options.baseUrl}/v1/admin${path}${search ? `?${search}` : ''}`,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    expectSuccess(answer, `${method} ${path}`)
    return answer
  }

  /**
   * Sends a request and reads the json body of its answer.
   *
   * @param method the method of the request.
   * @param path the path of the request, after `/v1/admin`.
   * @param query the query of the request.
   * @param body the body of the request.
   */
  async json<T>(
    method: ClientMethod,
    path: string,
    query?: AdminQuery,
    body?: unknown
  ): Promise<T> {
    return bodyOf(await this.send(method, path, query, body)) as T
  }

  /**
   * Reads the context of a principal.
   *
   * The contract of the access context is a contract of its own: it is
   * not under the administration, and it is asked with the credential of
   * the contract.
   *
   * @param question the question of the contract.
   * @param credential the credential of the contract.
   */
  async context(question: unknown, credential?: string): Promise<unknown> {
    const answer = await this.#options.transport.send({
      method: 'POST',
      url: `${this.#options.baseUrl}/v1/access-context`,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(question),
    })
    expectSuccess(answer, 'POST /v1/access-context')
    return bodyOf(answer)
  }

  /**
   * Asks Access for a decision.
   *
   * The decision contract is asked with the credential of the contract
   * of the decision, and not with the credential of the administration.
   *
   * @param question the question of the decision.
   * @param credential the credential of the decision.
   */
  async decide(question: unknown, credential?: string): Promise<unknown> {
    const answer = await this.#options.transport.send({
      method: 'POST',
      url: `${this.#options.baseUrl}/v1/decisions`,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(question),
    })
    expectSuccess(answer, 'POST /v1/decisions')
    return bodyOf(answer)
  }
}

/** The client of the administration of Access. */
export class AccessAdminClient extends AccessClient {
  /**
   * Sends a request and reads the page of its answer.
   *
   * @param path the path of the request, after `/v1/admin`.
   * @param key the name of the rows in the answer.
   * @param query the query of the request.
   */
  async page<T>(path: string, key: string, query: AdminQuery = {}): Promise<AdminPage<T>> {
    const body = await this.json<Record<string, unknown>>('GET', path, query)
    return {
      rows: (body[key] as T[] | undefined) ?? [],
      total: Number(body.total ?? 0),
      limit: Number(body.limit ?? 0),
      offset: Number(body.offset ?? 0),
    }
  }

  /** The tenants, with their counts. */
  async tenants(): Promise<readonly Tenant[]> {
    const body = await this.json<{ tenants?: Tenant[] }>('GET', '/tenants')
    return body.tenants ?? []
  }

  /** Creates a tenant, or updates the tenant of that slug. */
  async saveTenant(input: TenantInput): Promise<{ tenant: Tenant; created: boolean }> {
    const answer = await this.send('POST', '/tenants', {}, input)
    return { tenant: bodyOf(answer) as Tenant, created: answer.status === 201 }
  }

  /** A page of the principals. */
  async principals(
    query: {
      tenant?: string
      status?: string
      email?: string
      limit?: number
      offset?: number
    } = {}
  ): Promise<AdminPage<Principal>> {
    return await this.page<Principal>('/users', 'principals', query)
  }

  /** Creates a principal, or updates the principal of that external subject. */
  async savePrincipal(input: PrincipalInput): Promise<{ principal: Principal; created: boolean }> {
    const answer = await this.send('POST', '/users', {}, input)
    return { principal: bodyOf(answer) as Principal, created: answer.status === 201 }
  }

  /**
   * Registers a batch of principals. Every item is written on its own,
   * and the answer names the outcome of each one.
   */
  async savePrincipals(inputs: readonly PrincipalInput[]): Promise<readonly BatchOutcome[]> {
    const body = await this.json<{ principals?: BatchOutcome[] }>(
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
  async grants(
    query: {
      tenant?: string
      userId?: string
      live?: boolean
      limit?: number
      offset?: number
    } = {}
  ): Promise<AdminPage<Grant>> {
    return await this.page<Grant>('/grants', 'grants', query)
  }

  /** Creates a grant, or updates the grant of that tuple. */
  async saveGrant(input: GrantInput): Promise<Grant> {
    return await this.json<Grant>('PUT', '/grants', {}, input)
  }

  /** Revokes a grant. */
  async revokeGrant(id: string): Promise<void> {
    await this.send('DELETE', `/grants/${encodeURIComponent(id)}`)
  }

  /** A page of the groups. */
  async groups(
    query: { tenant?: string; key?: string; limit?: number; offset?: number } = {}
  ): Promise<AdminPage<Group>> {
    return await this.page<Group>('/groups', 'groups', query)
  }

  /** Creates a group, or changes it: the call replaces the membership. */
  async saveGroup(input: GroupInput): Promise<Group> {
    return await this.json<Group>('POST', '/groups', {}, input)
  }

  /** A page of the roles. */
  async roles(
    query: { tenant?: string; key?: string; limit?: number; offset?: number } = {}
  ): Promise<AdminPage<Role>> {
    return await this.page<Role>('/roles', 'roles', query)
  }

  /** Creates a role, or changes it: the call replaces the memberships. */
  async saveRole(input: RoleInput): Promise<Role> {
    return await this.json<Role>('PUT', '/roles', {}, input)
  }

  /** Removes a role that no grant names. */
  async removeRole(id: string): Promise<void> {
    await this.send('DELETE', `/roles/${encodeURIComponent(id)}`)
  }

  /** A page of the audit of the administration. */
  async audit(
    query: { tenant?: string; action?: string; limit?: number; offset?: number } = {}
  ): Promise<AdminPage<AuditRecord>> {
    return await this.page<AuditRecord>('/audit', 'records', query)
  }

  /** The export of the audit, as the file the service answers. */
  async exportAudit(query: {
    tenant?: string
    action?: string
    format: 'csv' | 'jsonl'
  }): Promise<string> {
    const answer = await this.send('GET', '/audit', { ...query, limit: 10_000 })
    return answer.body
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

/** The client of the contract of the access context. */
export class AccessContextClient {
  readonly #client: AccessClient
  readonly #clock: () => number
  readonly #cache = new Map<string, { context: AccessContext; until: number }>()

  constructor(options: AccessClientOptions & { clock?: () => number }) {
    this.#client = new AccessClient(options)
    this.#clock = options.clock ?? Date.now
  }

  /** The context of a principal, fresh or from the cache when it is still valid. */
  async context(
    question: ContextQuestion,
    options: { fresh?: boolean } = {}
  ): Promise<AccessContext> {
    const key = [question.subject, question.tenantId, question.workspaceId, question.routeId].join(
      '\u0000'
    )
    const now = this.#clock()
    const cached = this.#cache.get(key)
    if (!options.fresh && cached && cached.until > now) return cached.context

    const body = (await this.#client.context(
      { version: 1, ...question },
      this.#client.credentialOf()
    )) as Record<string, unknown> | null
    const context: AccessContext = {
      allow: body?.allow === true,
      permissionKeys: Array.isArray(body?.permissionKeys)
        ? body.permissionKeys.filter((key): key is string => typeof key === 'string')
        : [],
      validUntil: typeof body?.validUntil === 'string' ? body.validUntil : null,
    }
    if (context.allow && context.validUntil) {
      const until = Date.parse(context.validUntil)
      if (Number.isFinite(until)) this.#cache.set(key, { context, until })
    } else {
      this.#cache.delete(key)
    }
    return context
  }
}

/**
 * Asks Access for a decision.
 *
 * The decision contract is asked with the credential of the contract of
 * the decision, and not with the credential of the administration.
 *
 * @param options the address of Access and the transport of the call.
 * @param question the question of the decision.
 * @param credential the credential of the decision.
 */
export async function decide(
  options: AccessClientOptions,
  question: unknown,
  credential?: string
): Promise<unknown> {
  return await new AccessClient(options).decide(question, credential)
}
