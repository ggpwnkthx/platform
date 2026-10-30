/**
 * The client of the data of a workspace.
 *
 * The console reads the data through the gateway, with the access token
 * of the caller as a bearer token: the gateway authenticates it, asks
 * the Access, signs the identity and forwards the request. The data
 * service decides what the caller sees and what it may change; the
 * console shows the answer and decides nothing.
 *
 * The contract is read in the client of the platform (`@platform/client`):
 * the console and the CLI speak to the same services and read the same
 * paths. What is the console's is the way it shows a refusal and the
 * way it reads the envelope of the contract.
 */

import { DataClient as PlatformDataClient } from '@platform/client'
import { transportOf, type Fetch } from '../transport'
import { failureOf } from './errors'
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
export type ListQuery = {
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
export type AggregateQuery = {
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
  readonly #client: PlatformDataClient

  constructor(options: DataClientOptions) {
    this.#client = new PlatformDataClient({
      baseUrl: options.gatewayUrl,
      workspaceId: options.workspaceId,
      token: options.token,
      transport: transportOf('gateway', options.fetch ?? fetch, options.timeoutMs),
    })
  }

  /**
   * Reads the data of an answer of the contract.
   *
   * The contract of the data API wraps the value in an envelope: the
   * answer of `GET /me` is `{"data":{...}}`, and the console reads the
   * value out of it.
   */
  async #data<T>(call: () => Promise<unknown>): Promise<T> {
    try {
      const body = await call()
      if (typeof body !== 'object' || body === null) return body as T
      return (body as { data: T }).data
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** The identity of the caller in the workspace. */
  async me(): Promise<Me> {
    return await this.#data<Me>(() => this.#client.me())
  }

  /** The metadata of the collections the caller may use. */
  async schema(): Promise<SchemaMetadata> {
    return await this.#data<SchemaMetadata>(() => this.#client.schema())
  }

  /** The metadata of one collection. */
  async collection(key: string): Promise<CollectionMetadata> {
    return await this.#data<CollectionMetadata>(() => this.#client.collection(key))
  }

  /** A page of the records of a collection. */
  async list(key: string, query: ListQuery = {}): Promise<Page> {
    try {
      return (await this.#client.list(key, query)) as Page
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** The groups of an aggregate. */
  async aggregate(key: string, query: AggregateQuery = {}): Promise<Aggregate> {
    try {
      return (await this.#client.aggregate(key, query)) as Aggregate
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** One record and its validator. */
  async get(key: string, id: string): Promise<Validated> {
    try {
      const answer = await this.#client.get(key, id)
      return { record: (answer.body as { data: RecordValue }).data, etag: answer.etag }
    } catch (error) {
      throw failureOf(error)
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
    try {
      const answer = await this.#client.create(key, values, idempotencyKey)
      const receipt = (answer.body as { data: { id: string; version: number } }).data
      return { ...receipt, replayed: answer.replayed }
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Updates a record, against the validator the caller read. */
  async update(
    key: string,
    id: string,
    values: Record<string, unknown>,
    etag: string
  ): Promise<Validated> {
    try {
      const answer = await this.#client.update(key, id, values, etag)
      return { record: (answer.body as { data: RecordValue }).data, etag: answer.etag }
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Deletes a record, against the validator the caller read. */
  async remove(key: string, id: string, etag: string): Promise<void> {
    try {
      await this.#client.remove(key, id, etag)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** The history of the versions of a record. */
  async versions(key: string, id: string): Promise<readonly VersionEntry[]> {
    return await this.#data<VersionEntry[]>(() => this.#client.versions(key, id))
  }

  /** One version of a record. */
  async version(key: string, id: string, version: number): Promise<RecordValue> {
    return await this.#data<RecordValue>(() => this.#client.version(key, id, version))
  }

  /** Rolls a record back to one of its versions. */
  async rollback(key: string, id: string, version: number, etag: string): Promise<Validated> {
    try {
      const answer = await this.#client.rollback(key, id, version, etag)
      return { record: (answer.body as { data: RecordValue }).data, etag: answer.etag }
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** A page of the audit of the workspace. */
  async audit(query: { limit?: number; cursor?: string } = {}): Promise<{
    data: readonly AuditEntry[]
    meta: { limit: number; nextCursor: string | null }
  }> {
    try {
      return (await this.#client.audit(query)) as {
        data: AuditEntry[]
        meta: { limit: number; nextCursor: string | null }
      }
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** The model of the workspace. */
  async model(): Promise<Model> {
    return await this.#data<Model>(() => this.#client.model())
  }

  /** Serves a collection of the deployment in the workspace. */
  async registerCollection(key: string): Promise<void> {
    try {
      await this.#client.registerCollection(key)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Stops serving a collection in the workspace. */
  async unregisterCollection(key: string): Promise<void> {
    try {
      await this.#client.removeCollection(key)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Changes the label and the description of a collection. */
  async describeCollection(
    key: string,
    attributes: { label?: string; description?: string }
  ): Promise<void> {
    try {
      await this.#client.updateCollection(key, attributes)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Holds a field of the collection in the model. */
  async addField(key: string, name: string, attributes: FieldAttributes): Promise<void> {
    try {
      await this.#client.addField(key, { name, ...attributes })
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Changes the attributes of a field of the model. */
  async changeField(key: string, name: string, attributes: FieldAttributes): Promise<void> {
    try {
      await this.#client.updateField(key, name, attributes)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Removes a field from the model: the column stays. */
  async removeField(key: string, name: string): Promise<void> {
    try {
      await this.#client.removeField(key, name)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Moves a field of the model up or down. */
  async moveField(key: string, name: string, direction: 'up' | 'down'): Promise<void> {
    try {
      await this.#client.moveField(key, name, direction)
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Adds a relation to the model of a collection. */
  async addRelation(key: string, name: string, attributes: RelationAttributes): Promise<void> {
    try {
      await this.#client.addRelation(key, { name, ...attributes })
    } catch (error) {
      throw failureOf(error)
    }
  }

  /** Removes a relation from the model of a collection. */
  async removeRelation(key: string, name: string): Promise<void> {
    try {
      await this.#client.removeRelation(key, name)
    } catch (error) {
      throw failureOf(error)
    }
  }
}
