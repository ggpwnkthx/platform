/**
 * The client of the data of a workspace.
 *
 * The data API is behind the gateway: the gateway authenticates the
 * caller, asks Access and forwards the request with the identity of the
 * caller signed. The client of the data speaks to the gateway and never
 * to a database.
 *
 * The client answers the bodies of the contract as they are, and it
 * answers the headers that carry a fact of their own — the validator of
 * a record, the receipt of a creation — beside the body. What a client
 * of the console or of the CLI does with them is the business of that
 * client.
 */

import {
  bodyOf,
  type ClientAnswer,
  type ClientMethod,
  type ClientTransport,
  expectSuccess,
  type Query,
  queryOf,
  type QueryValue,
} from './transport'

/** The options of the client of the data of a workspace. */
export interface DataClientOptions {
  /** The address of the gateway. */
  readonly baseUrl: string
  /** The workspace the calls work on. */
  readonly workspaceId: string
  /** The credential of the caller, when the call carries one. */
  readonly token?: string
  /** The transport of the calls. */
  readonly transport: ClientTransport
}

/** The query of a page of records. */
export interface ListQuery {
  readonly fields?: QueryValue
  /** The filter of the page: an object, or the json of one. */
  readonly filter?: unknown
  readonly search?: QueryValue
  readonly sort?: QueryValue
  readonly limit?: QueryValue
  readonly cursor?: QueryValue
  readonly include?: QueryValue
  /** True when the answer carries the number of the records. */
  readonly includeCount?: QueryValue
  /** The other parameters of the query, as the contract names them. */
  readonly [key: string]: unknown
}

/** The query of an aggregate. */
export interface AggregateQuery {
  readonly groupBy?: QueryValue
  readonly metrics?: QueryValue
  /** The filter of the groups: an object, or the json of one. */
  readonly filter?: unknown
  readonly search?: QueryValue
  readonly limit?: QueryValue
  /** The other parameters of the query, as the contract names them. */
  readonly [key: string]: unknown
}

/** The options of a call of the data API. */
export interface DataCallOptions {
  /** The body of the call, when it carries one. */
  readonly body?: unknown
  /** The headers of the call, when it carries some of its own. */
  readonly headers?: Readonly<Record<string, string>>
  /** The query of the call. */
  readonly query?: Query
}

/** A record and its validator. */
export interface Validated {
  /** The body of the answer. */
  readonly body: unknown
  /** The validator of the record. */
  readonly etag: string
}

/**
 * Renames the parameters the clients name in their own words.
 *
 * The console names a parameter `includeCount` and the command line
 * names it `include-count`; the contract names it `include_count`, and
 * the client is the one that knows it.
 *
 * @param query the query of the client.
 * @param names the names the client uses and the names the contract uses.
 */
function renamed(query: Record<string, unknown>, names: Record<string, string>): Query {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    out[names[key] ?? key] = value
  }
  return out as Query
}

/** The client of the data of one workspace. */
export class DataClient {
  readonly #options: DataClientOptions

  constructor(options: DataClientOptions) {
    this.#options = options
  }

  /** The prefix of the paths of the workspace. */
  get #prefix(): string {
    return `${this.#options.baseUrl}/ws/${encodeURIComponent(this.#options.workspaceId)}/v1`
  }

  /**
   * Sends a request to the data API and reads the answer.
   *
   * The refusal of the service is raised as a `ClientError`: the caller
   * decides what a refusal means.
   *
   * @param method the method of the request.
   * @param path the path of the request, after the workspace.
   * @param options the body, the headers and the query of the request.
   */
  async send(
    method: ClientMethod,
    path: string,
    options: DataCallOptions = {}
  ): Promise<ClientAnswer> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(this.#options.token ? { authorization: `Bearer ${this.#options.token}` } : {}),
      ...(options.headers ?? {}),
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const search = queryOf(options.query)
    const answer = await this.#options.transport.send({
      method,
      url: `${this.#prefix}${path}${search ? `?${search}` : ''}`,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    expectSuccess(answer, `${method} ${path}`)
    return answer
  }

  /**
   * Sends a request and reads the body of its answer.
   *
   * @param method the method of the request.
   * @param path the path of the request, after the workspace.
   * @param options the body, the headers and the query of the request.
   */
  async body(method: ClientMethod, path: string, options: DataCallOptions = {}): Promise<unknown> {
    return bodyOf(await this.send(method, path, options))
  }

  /**
   * Sends a request and reads the data of its answer.
   *
   * The contract of the data API wraps the value in an envelope: the
   * answer of `GET /me` is `{"data":{...}}`, and the client that wants
   * the value reads it here.
   *
   * @param method the method of the request.
   * @param path the path of the request, after the workspace.
   * @param options the body, the headers and the query of the request.
   */
  async data<T>(method: ClientMethod, path: string, options: DataCallOptions = {}): Promise<T> {
    const body = await this.body(method, path, options)
    if (typeof body !== 'object' || body === null) return body as T
    return (body as { data: T }).data
  }

  /** The identity of the caller in the workspace. */
  async me(): Promise<unknown> {
    return await this.body('GET', '/me')
  }

  /** The metadata of the collections the caller may use. */
  async schema(): Promise<unknown> {
    return await this.body('GET', '/schema')
  }

  /** The metadata of one collection. */
  async collection(key: string): Promise<unknown> {
    return await this.body('GET', `/schema/${encodeURIComponent(key)}`)
  }

  /** A page of the records of a collection. */
  async list(key: string, query: ListQuery = {}): Promise<unknown> {
    return await this.body('GET', `/items/${encodeURIComponent(key)}`, {
      query: renamed(query, { includeCount: 'include_count' }),
    })
  }

  /** The groups of an aggregate. */
  async aggregate(key: string, query: AggregateQuery = {}): Promise<unknown> {
    return await this.body('GET', `/aggregate/${encodeURIComponent(key)}`, {
      query: renamed(query, { groupBy: 'group_by' }),
    })
  }

  /** One record and its validator. */
  async get(key: string, id: string): Promise<Validated> {
    const answer = await this.send(
      'GET',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`
    )
    return { body: bodyOf(answer), etag: answer.headers.etag ?? '' }
  }

  /**
   * Creates a record.
   *
   * The key of the idempotency is the one the caller sent: a form that
   * is sent twice creates one record.
   */
  async create(
    key: string,
    values: unknown,
    idempotencyKey?: string
  ): Promise<{ body: unknown; replayed: boolean }> {
    const answer = await this.send('POST', `/items/${encodeURIComponent(key)}`, {
      body: values,
      ...(idempotencyKey ? { headers: { 'idempotency-key': idempotencyKey } } : {}),
    })
    return { body: bodyOf(answer), replayed: answer.headers['idempotency-replayed'] === 'true' }
  }

  /** Updates a record, against the validator the caller read. */
  async update(key: string, id: string, values: unknown, etag?: string): Promise<Validated> {
    const answer = await this.send(
      'PATCH',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`,
      { body: values, ...(etag ? { headers: { 'if-match': etag } } : {}) }
    )
    return { body: bodyOf(answer), etag: answer.headers.etag ?? '' }
  }

  /** Deletes a record, against the validator the caller read. */
  async remove(key: string, id: string, etag?: string): Promise<unknown> {
    return await this.body(
      'DELETE',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`,
      {
        ...(etag ? { headers: { 'if-match': etag } } : {}),
      }
    )
  }

  /** The history of the versions of a record. */
  async versions(key: string, id: string): Promise<unknown> {
    return await this.body(
      'GET',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}/versions`
    )
  }

  /** One version of a record. */
  async version(key: string, id: string, version: number): Promise<unknown> {
    return await this.body(
      'GET',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}/versions/${version}`
    )
  }

  /** Rolls a record back to one of its versions. */
  async rollback(key: string, id: string, version: number, etag?: string): Promise<Validated> {
    const answer = await this.send(
      'POST',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}/rollback`,
      { body: { version }, ...(etag ? { headers: { 'if-match': etag } } : {}) }
    )
    return { body: bodyOf(answer), etag: answer.headers.etag ?? '' }
  }

  /** The audit of the workspace. */
  async audit(query: ListQuery = {}): Promise<unknown> {
    return await this.body('GET', '/audit', { query: renamed(query, {}) })
  }

  /** The model of the workspace. */
  async model(): Promise<unknown> {
    return await this.body('GET', '/model')
  }

  /** Serves a collection of the deployment in the workspace. */
  async registerCollection(collection: string | { key: string } | Record<string, unknown>) {
    const body = typeof collection === 'string' ? { key: collection } : collection
    return await this.body('POST', '/model/collections', { body })
  }

  /** Changes the label and the description of a collection. */
  async updateCollection(key: string, attributes: unknown): Promise<unknown> {
    return await this.body('PATCH', `/model/collections/${encodeURIComponent(key)}`, {
      body: attributes,
    })
  }

  /** Stops serving a collection in the workspace. */
  async removeCollection(key: string): Promise<unknown> {
    return await this.body('DELETE', `/model/collections/${encodeURIComponent(key)}`)
  }

  /** Holds a field of the collection in the model. */
  async addField(key: string, field: unknown): Promise<unknown> {
    return await this.body('POST', `/model/collections/${encodeURIComponent(key)}/fields`, {
      body: field,
    })
  }

  /** Changes the attributes of a field of the model. */
  async updateField(key: string, name: string, attributes: unknown): Promise<unknown> {
    return await this.body(
      'PATCH',
      `/model/collections/${encodeURIComponent(key)}/fields/${encodeURIComponent(name)}`,
      { body: attributes }
    )
  }

  /** Removes a field from the model: the column stays. */
  async removeField(key: string, name: string): Promise<unknown> {
    return await this.body(
      'DELETE',
      `/model/collections/${encodeURIComponent(key)}/fields/${encodeURIComponent(name)}`
    )
  }

  /** Moves a field of the model up or down. */
  async moveField(key: string, name: string, direction: 'up' | 'down'): Promise<unknown> {
    return await this.body(
      'POST',
      `/model/collections/${encodeURIComponent(key)}/fields/${encodeURIComponent(name)}/move`,
      { body: { direction } }
    )
  }

  /** Adds a relation to the model of a collection. */
  async addRelation(key: string, relation: unknown): Promise<unknown> {
    return await this.body('POST', `/model/collections/${encodeURIComponent(key)}/relations`, {
      body: relation,
    })
  }

  /** Changes a relation of the model of a collection. */
  async updateRelation(key: string, name: string, attributes: unknown): Promise<unknown> {
    return await this.body(
      'PATCH',
      `/model/collections/${encodeURIComponent(key)}/relations/${encodeURIComponent(name)}`,
      { body: attributes }
    )
  }

  /** Removes a relation from the model of a collection. */
  async removeRelation(key: string, name: string): Promise<unknown> {
    return await this.body(
      'DELETE',
      `/model/collections/${encodeURIComponent(key)}/relations/${encodeURIComponent(name)}`
    )
  }
}
