/**
 * The data of a workspace.
 *
 * The data API is behind the gateway, and it needs the signed identity
 * of the gateway: the CLI is an API client, it authenticates like any
 * other, and it never reaches a database.
 *
 * The workspace is part of every path: a command of the data works on
 * one workspace, and the CLI never guesses it.
 *
 * The contract is read in the client of the platform (`@platform/client`):
 * the console and the CLI speak to the same services and read the same
 * paths. What is the CLI's is the way it turns a refusal into the
 * failure that carries the status the process ends with.
 */

import { DataClient as PlatformDataClient } from '@platform/client'
import { failureOf } from './answer'
import type { HttpPort } from './contracts'
import { transportOf } from './transport'

/** The parameters of a call to the data API. */
export interface DataCall {
  /** The transport of the call. */
  readonly http: HttpPort
  /** The address of the gateway. */
  readonly baseUrl: string
  /** The credential of the caller. */
  readonly token: string
  /** The workspace the commands work on. */
  readonly workspaceId: string
}

/** The client of the data of the workspace of a call. */
function clientOf(call: DataCall): PlatformDataClient {
  return new PlatformDataClient({
    baseUrl: call.baseUrl,
    workspaceId: call.workspaceId,
    token: call.token,
    transport: transportOf(call.http),
  })
}

/**
 * Reads the answer of the client, or turns its refusal into a failure.
 *
 * @param call the call that was made.
 */
async function read<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw failureOf(error)
  }
}

/**
 * The identity of the caller in the workspace.
 *
 * @param call the parameters of the call.
 */
export async function me(call: DataCall): Promise<unknown> {
  return await read(() => clientOf(call).me())
}

/**
 * The metadata of the collections the caller may use.
 *
 * @param call the parameters of the call.
 */
export async function schema(call: DataCall): Promise<unknown> {
  return await read(() => clientOf(call).schema())
}

/**
 * The metadata of one collection.
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 */
export async function collection(call: DataCall, collection: string): Promise<unknown> {
  return await read(() => clientOf(call).collection(collection))
}

/**
 * A page of records.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param query the query of the page.
 */
export async function listItems(
  call: DataCall,
  collection: string,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return await read(() => clientOf(call).list(collection, query))
}

/**
 * One record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 */
export async function getItem(call: DataCall, collection: string, id: string): Promise<unknown> {
  return await read(async () => (await clientOf(call).get(collection, id)).body)
}

/**
 * Creates a record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param record the record to create.
 * @param idempotencyKey the key that makes the creation repeatable.
 */
export async function createItem(
  call: DataCall,
  collection: string,
  record: unknown,
  idempotencyKey?: string
): Promise<unknown> {
  return await read(
    async () => (await clientOf(call).create(collection, record, idempotencyKey)).body
  )
}

/**
 * Changes a record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 * @param change the change to write.
 * @param etag the validator of the record the caller believes it changes.
 */
export async function updateItem(
  call: DataCall,
  collection: string,
  id: string,
  change: unknown,
  etag?: string
): Promise<unknown> {
  return await read(async () => (await clientOf(call).update(collection, id, change, etag)).body)
}

/**
 * Removes a record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 * @param etag the validator of the record the caller believes it removes.
 */
export async function removeItem(
  call: DataCall,
  collection: string,
  id: string,
  etag?: string
): Promise<unknown> {
  return await read(() => clientOf(call).remove(collection, id, etag))
}

/**
 * The history of a record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 */
export async function versions(call: DataCall, collection: string, id: string): Promise<unknown> {
  return await read(() => clientOf(call).versions(collection, id))
}

/**
 * One version of a record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 * @param version the number of the version.
 */
export async function version(
  call: DataCall,
  collection: string,
  id: string,
  version: number
): Promise<unknown> {
  return await read(() => clientOf(call).version(collection, id, version))
}

/**
 * Rolls a record back to one of its versions.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 * @param target the number of the version to roll back to.
 * @param etag the validator of the record the caller believes it changes.
 */
export async function rollback(
  call: DataCall,
  collection: string,
  id: string,
  target: number,
  etag?: string
): Promise<unknown> {
  return await read(async () => (await clientOf(call).rollback(collection, id, target, etag)).body)
}

/**
 * The aggregate of a collection.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param query the query of the aggregate.
 */
export async function aggregate(
  call: DataCall,
  collection: string,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return await read(() => clientOf(call).aggregate(collection, query))
}

/**
 * The audit of the workspace.
 *
 * @param call the parameters of the call.
 * @param query the query of the page.
 */
export async function audit(
  call: DataCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return await read(() => clientOf(call).audit(query))
}

/**
 * The model of the workspace.
 *
 * @param call the parameters of the call.
 */
export async function model(call: DataCall): Promise<unknown> {
  return await read(() => clientOf(call).model())
}

/**
 * Registers a collection of the workspace.
 *
 * @param call the parameters of the call.
 * @param collection the collection to register.
 */
export async function registerCollection(call: DataCall, collection: unknown): Promise<unknown> {
  return await read(() =>
    clientOf(call).registerCollection(collection as string | Record<string, unknown>)
  )
}

/**
 * Changes a collection of the model.
 *
 * @param call the parameters of the call.
 * @param key the key of the collection.
 * @param change the change to write.
 */
export async function updateCollection(
  call: DataCall,
  key: string,
  change: unknown
): Promise<unknown> {
  return await read(() => clientOf(call).updateCollection(key, change))
}

/**
 * Removes a collection from the model.
 *
 * @param call the parameters of the call.
 * @param key the key of the collection.
 */
export async function removeCollection(call: DataCall, key: string): Promise<unknown> {
  return await read(() => clientOf(call).removeCollection(key))
}

/**
 * Adds a field to a collection of the model.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param field the field to add.
 */
export async function addField(
  call: DataCall,
  collection: string,
  field: unknown
): Promise<unknown> {
  return await read(() => clientOf(call).addField(collection, field))
}

/**
 * Changes a field of the model.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param field the key of the field.
 * @param change the change to write.
 */
export async function updateField(
  call: DataCall,
  collection: string,
  field: string,
  change: unknown
): Promise<unknown> {
  return await read(() => clientOf(call).updateField(collection, field, change))
}

/**
 * Removes a field from the model.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param field the key of the field.
 */
export async function removeField(
  call: DataCall,
  collection: string,
  field: string
): Promise<unknown> {
  return await read(() => clientOf(call).removeField(collection, field))
}

/**
 * Moves a field in the order of its collection.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param field the key of the field.
 * @param direction the direction of the move.
 */
export async function moveField(
  call: DataCall,
  collection: string,
  field: string,
  direction: 'up' | 'down'
): Promise<unknown> {
  return await read(() => clientOf(call).moveField(collection, field, direction))
}

/**
 * Adds a relation to the model.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param relation the relation to add.
 */
export async function addRelation(
  call: DataCall,
  collection: string,
  relation: unknown
): Promise<unknown> {
  return await read(() => clientOf(call).addRelation(collection, relation))
}

/**
 * Changes a relation of the model.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param relation the key of the relation.
 * @param change the change to write.
 */
export async function updateRelation(
  call: DataCall,
  collection: string,
  relation: string,
  change: unknown
): Promise<unknown> {
  return await read(() => clientOf(call).updateRelation(collection, relation, change))
}

/**
 * Removes a relation from the model.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param relation the key of the relation.
 */
export async function removeRelation(
  call: DataCall,
  collection: string,
  relation: string
): Promise<unknown> {
  return await read(() => clientOf(call).removeRelation(collection, relation))
}
