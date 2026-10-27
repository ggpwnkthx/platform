/**
 * The client of the data of a workspace.
 *
 * The console reads the data through the gateway, with the access token
 * of the caller as a bearer token: the gateway authenticates it, asks the
 * access service, signs the identity and forwards the request. The data
 * service decides what the caller sees and what it may change; the
 * console shows the answer and decides nothing.
 */

import { bodyOf, call, type Fetch } from '../transport'
import { refusalOf } from './errors'
import type {
  Aggregate,
  AuditEntry,
  CollectionMetadata,
  FieldAttributes,
  Me,
  Model,
  Page,
  RecordValue,
  RelationAttributes,
  SchemaMetadata,
  VersionEntry,
} from './types'

/** The options of the client of a workspace. */
export interface DataClientOptions {
  /** The base url of the gateway. */
  readonly gatewayUrl: string
  readonly workspaceId: string
  /** The access token of the caller. */
  readonly token: string
  readonly timeoutMs: number
  readonly fetch?: Fetch
}

/** The options of a list. */
export interface ListQuery {
  readonly fields?: readonly string[]
  readonly filter?: unknown
  readonly search?: string
  readonly sort?: readonly string[]
  readonly limit?: number
  readonly cursor?: string
  readonly include?: readonly string[]
  readonly includeCount?: boolean
}

/** The options of an aggregate. */
export interface AggregateQuery {
  readonly groupBy?: readonly string[]
  readonly metrics?: readonly string[]
  readonly filter?: unknown
  readonly search?: string
  readonly limit?: number
}

/** A record and its validator. */
export interface Validated {
  readonly record: RecordValue
  readonly etag: string
}

/** The client of the data of one workspace, for one caller. */
export class DataClient {
  readonly #options: DataClientOptions
  readonly #fetch: Fetch

  constructor(options: DataClientOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? fetch
  }

  get #prefix(): string {
    return `${this.#options.gatewayUrl}/ws/${encodeURIComponent(this.#options.workspaceId)}/v1`
  }

  async #send(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<{ body: unknown; headers: Headers; status: number }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#options.token}`,
      accept: 'application/json',
      ...(options.headers ?? {}),
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const response = await call(
      'gateway',
      this.#fetch,
      `${this.#prefix}${path}`,
      {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      this.#options.timeoutMs
    )
    if (!response.ok) throw await refusalOf(response)
    return { body: await bodyOf(response), headers: response.headers, status: response.status }
  }

  async #data<T>(method: string, path: string, body?: unknown): Promise<T> {
    const answer = await this.#send(method, path, body === undefined ? {} : { body })
    return (answer.body as { data: T }).data
  }

  /** The identity of the caller in the workspace. */
  async me(): Promise<Me> {
    return await this.#data<Me>('GET', '/me')
  }

  /** The metadata of the collections the caller may use. */
  async schema(): Promise<SchemaMetadata> {
    return await this.#data<SchemaMetadata>('GET', '/schema')
  }

  /** The metadata of one collection. */
  async collection(key: string): Promise<CollectionMetadata> {
    return await this.#data<CollectionMetadata>('GET', `/schema/${encodeURIComponent(key)}`)
  }

  /** A page of the records of a collection. */
  async list(key: string, query: ListQuery = {}): Promise<Page> {
    const search = new URLSearchParams()
    if (query.fields?.length) search.set('fields', query.fields.join(','))
    if (query.filter !== undefined) search.set('filter', JSON.stringify(query.filter))
    if (query.search) search.set('search', query.search)
    if (query.sort?.length) search.set('sort', query.sort.join(','))
    if (query.limit !== undefined) search.set('limit', String(query.limit))
    if (query.cursor) search.set('cursor', query.cursor)
    if (query.include?.length) search.set('include', query.include.join(','))
    if (query.includeCount) search.set('include_count', 'true')
    const suffix = search.toString()
    const answer = await this.#send(
      'GET',
      `/items/${encodeURIComponent(key)}${suffix ? `?${suffix}` : ''}`
    )
    return answer.body as Page
  }

  /** The groups of an aggregate. */
  async aggregate(key: string, query: AggregateQuery = {}): Promise<Aggregate> {
    const search = new URLSearchParams()
    if (query.groupBy?.length) search.set('group_by', query.groupBy.join(','))
    if (query.metrics?.length) search.set('metrics', query.metrics.join(','))
    if (query.filter !== undefined) search.set('filter', JSON.stringify(query.filter))
    if (query.search) search.set('search', query.search)
    if (query.limit !== undefined) search.set('limit', String(query.limit))
    const suffix = search.toString()
    const answer = await this.#send(
      'GET',
      `/aggregate/${encodeURIComponent(key)}${suffix ? `?${suffix}` : ''}`
    )
    return answer.body as Aggregate
  }

  /** One record and its validator. */
  async get(key: string, id: string): Promise<Validated> {
    const answer = await this.#send(
      'GET',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`
    )
    return {
      record: (answer.body as { data: RecordValue }).data,
      etag: answer.headers.get('etag') ?? '',
    }
  }

  /**
   * Creates a record.
   *
   * The key of the idempotency is the one of the form the caller sent: a
   * form that is sent twice creates one record.
   */
  async create(
    key: string,
    values: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{ id: string; version: number; replayed: boolean }> {
    const answer = await this.#send('POST', `/items/${encodeURIComponent(key)}`, {
      body: values,
      headers: { 'idempotency-key': idempotencyKey },
    })
    const receipt = (answer.body as { data: { id: string; version: number } }).data
    return { ...receipt, replayed: answer.headers.get('idempotency-replayed') === 'true' }
  }

  /** Updates a record, against the validator the caller read. */
  async update(
    key: string,
    id: string,
    values: Record<string, unknown>,
    etag: string
  ): Promise<Validated> {
    const answer = await this.#send(
      'PATCH',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`,
      { body: values, headers: { 'if-match': etag } }
    )
    return {
      record: (answer.body as { data: RecordValue }).data,
      etag: answer.headers.get('etag') ?? '',
    }
  }

  /** Deletes a record, against the validator the caller read. */
  async remove(key: string, id: string, etag: string): Promise<void> {
    await this.#send('DELETE', `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}`, {
      headers: { 'if-match': etag },
    })
  }

  /** The history of the versions of a record. */
  async versions(key: string, id: string): Promise<readonly VersionEntry[]> {
    return await this.#data<VersionEntry[]>(
      'GET',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}/versions`
    )
  }

  /** One version of a record. */
  async version(key: string, id: string, version: number): Promise<RecordValue> {
    return await this.#data<RecordValue>(
      'GET',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}/versions/${version}`
    )
  }

  /** Rolls a record back to one of its versions. */
  async rollback(key: string, id: string, version: number, etag: string): Promise<Validated> {
    const answer = await this.#send(
      'POST',
      `/items/${encodeURIComponent(key)}/${encodeURIComponent(id)}/rollback`,
      { body: { version }, headers: { 'if-match': etag } }
    )
    return {
      record: (answer.body as { data: RecordValue }).data,
      etag: answer.headers.get('etag') ?? '',
    }
  }

  /** A page of the audit of the workspace. */
  async audit(query: { limit?: number; cursor?: string } = {}): Promise<{
    data: readonly AuditEntry[]
    meta: { limit: number; nextCursor: string | null }
  }> {
    const search = new URLSearchParams()
    if (query.limit !== undefined) search.set('limit', String(query.limit))
    if (query.cursor) search.set('cursor', query.cursor)
    const suffix = search.toString()
    const answer = await this.#send('GET', `/audit${suffix ? `?${suffix}` : ''}`)
    return answer.body as { data: AuditEntry[]; meta: { limit: number; nextCursor: string | null } }
  }

  /** The model of the workspace. */
  async model(): Promise<Model> {
    return await this.#data<Model>('GET', '/model')
  }

  /** Serves a collection of the deployment in the workspace. */
  async registerCollection(key: string): Promise<void> {
    await this.#send('POST', '/model/collections', { body: { key } })
  }

  /** Stops serving a collection in the workspace. */
  async unregisterCollection(key: string): Promise<void> {
    await this.#send('DELETE', `/model/collections/${encodeURIComponent(key)}`)
  }

  /** Changes the label and the description of a collection. */
  async describeCollection(
    key: string,
    attributes: { label?: string; description?: string }
  ): Promise<void> {
    await this.#send('PATCH', `/model/collections/${encodeURIComponent(key)}`, { body: attributes })
  }

  /** Holds a field of the collection in the model. */
  async addField(key: string, name: string, attributes: FieldAttributes): Promise<void> {
    await this.#send('POST', `/model/collections/${encodeURIComponent(key)}/fields`, {
      body: { name, ...attributes },
    })
  }

  /** Changes the attributes of a field of the model. */
  async changeField(key: string, name: string, attributes: FieldAttributes): Promise<void> {
    await this.#send(
      'PATCH',
      `/model/collections/${encodeURIComponent(key)}/fields/${encodeURIComponent(name)}`,
      { body: attributes }
    )
  }

  /** Removes a field from the model: the column stays. */
  async removeField(key: string, name: string): Promise<void> {
    await this.#send(
      'DELETE',
      `/model/collections/${encodeURIComponent(key)}/fields/${encodeURIComponent(name)}`
    )
  }

  /** Moves a field of the model up or down. */
  async moveField(key: string, name: string, direction: 'up' | 'down'): Promise<void> {
    await this.#send(
      'POST',
      `/model/collections/${encodeURIComponent(key)}/fields/${encodeURIComponent(name)}/move`,
      { body: { direction } }
    )
  }

  /** Adds a relation to the model of a collection. */
  async addRelation(key: string, name: string, attributes: RelationAttributes): Promise<void> {
    await this.#send('POST', `/model/collections/${encodeURIComponent(key)}/relations`, {
      body: { name, ...attributes },
    })
  }

  /** Removes a relation from the model of a collection. */
  async removeRelation(key: string, name: string): Promise<void> {
    await this.#send(
      'DELETE',
      `/model/collections/${encodeURIComponent(key)}/relations/${encodeURIComponent(name)}`
    )
  }
}
