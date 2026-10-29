/**
 * The data of a workspace.
 *
 * The data API is behind the gateway, and it needs the signed identity
 * of the gateway: the CLI is an API client, it authenticates like any
 * other, and it never reaches a database.
 *
 * The workspace is part of every path: a command of the data works on
 * one workspace, and the CLI never guesses it.
 */

import type { HttpPort } from './contracts'
import { expectSuccess } from './answer'

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

/**
 * Sends a request to the data API.
 *
 * @param call the parameters of the call.
 * @param method the method of the request.
 * @param path the path of the request, after the workspace.
 * @param query the query of the request.
 * @param body the body of the request.
 * @param headers the headers of the request.
 */
export async function dataRequest(
  call: DataCall,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
  body?: unknown,
  headers?: Readonly<Record<string, string>>
): Promise<unknown> {
  const url = new URL(`${call.baseUrl}/ws/${call.workspaceId}/v1${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  const request: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    url: string
    token: string
    headers: Record<string, string>
    body?: string
  } = {
    method,
    url: url.toString(),
    token: call.token,
    headers: { ...(headers ?? {}) },
  }
  if (body !== undefined) {
    request.headers['content-type'] = 'application/json'
    request.body = JSON.stringify(body)
  }
  const answer = await call.http.send(request)
  return expectSuccess(answer, `${method} ${path}`)
}

/**
 * The identity of the caller in the workspace.
 *
 * @param call the parameters of the call.
 */
export async function me(call: DataCall): Promise<unknown> {
  return dataRequest(call, 'GET', '/me')
}

/**
 * The metadata of the collections the caller may use.
 *
 * @param call the parameters of the call.
 */
export async function schema(call: DataCall): Promise<unknown> {
  return dataRequest(call, 'GET', '/schema')
}

/**
 * The metadata of one collection.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 */
export async function collection(call: DataCall, collection: string): Promise<unknown> {
  return dataRequest(call, 'GET', `/schema/${encodeURIComponent(collection)}`)
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
  return dataRequest(call, 'GET', `/items/${encodeURIComponent(collection)}`, query)
}

/**
 * One record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 */
export async function getItem(call: DataCall, collection: string, id: string): Promise<unknown> {
  return dataRequest(
    call,
    'GET',
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`
  )
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
  const headers: Record<string, string> = {}
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return dataRequest(
    call,
    'POST',
    `/items/${encodeURIComponent(collection)}`,
    undefined,
    record,
    headers
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
  const headers: Record<string, string> = {}
  if (etag) headers['if-match'] = etag
  return dataRequest(
    call,
    'PATCH',
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    undefined,
    change,
    headers
  )
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
  const headers: Record<string, string> = {}
  if (etag) headers['if-match'] = etag
  return dataRequest(
    call,
    'DELETE',
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    undefined,
    undefined,
    headers
  )
}

/**
 * The history of a record.
 *
 * @param call the parameters of the call.
 * @param collection the key of the collection.
 * @param id the id of the record.
 */
export async function versions(call: DataCall, collection: string, id: string): Promise<unknown> {
  return dataRequest(
    call,
    'GET',
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/versions`
  )
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
  return dataRequest(
    call,
    'GET',
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/versions/${version}`
  )
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
  const headers: Record<string, string> = {}
  if (etag) headers['if-match'] = etag
  return dataRequest(
    call,
    'POST',
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/rollback`,
    undefined,
    { version: target },
    headers
  )
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
  return dataRequest(call, 'GET', `/aggregate/${encodeURIComponent(collection)}`, query)
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
  return dataRequest(call, 'GET', '/audit', query)
}

/**
 * The model of the workspace.
 *
 * @param call the parameters of the call.
 */
export async function model(call: DataCall): Promise<unknown> {
  return dataRequest(call, 'GET', '/model')
}

/**
 * Registers a collection of the workspace.
 *
 * @param call the parameters of the call.
 * @param collection the collection to register.
 */
export async function registerCollection(call: DataCall, collection: unknown): Promise<unknown> {
  return dataRequest(call, 'POST', '/model/collections', undefined, collection)
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
  return dataRequest(
    call,
    'PATCH',
    `/model/collections/${encodeURIComponent(key)}`,
    undefined,
    change
  )
}

/**
 * Removes a collection from the model.
 *
 * @param call the parameters of the call.
 * @param key the key of the collection.
 */
export async function removeCollection(call: DataCall, key: string): Promise<unknown> {
  return dataRequest(call, 'DELETE', `/model/collections/${encodeURIComponent(key)}`)
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
  return dataRequest(
    call,
    'POST',
    `/model/collections/${encodeURIComponent(collection)}/fields`,
    undefined,
    field
  )
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
  return dataRequest(
    call,
    'PATCH',
    `/model/collections/${encodeURIComponent(collection)}/fields/${encodeURIComponent(field)}`,
    undefined,
    change
  )
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
  return dataRequest(
    call,
    'DELETE',
    `/model/collections/${encodeURIComponent(collection)}/fields/${encodeURIComponent(field)}`
  )
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
  return dataRequest(
    call,
    'POST',
    `/model/collections/${encodeURIComponent(collection)}/fields/${encodeURIComponent(field)}/move`,
    undefined,
    { direction }
  )
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
  return dataRequest(
    call,
    'POST',
    `/model/collections/${encodeURIComponent(collection)}/relations`,
    undefined,
    relation
  )
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
  return dataRequest(
    call,
    'PATCH',
    `/model/collections/${encodeURIComponent(collection)}/relations/${encodeURIComponent(relation)}`,
    undefined,
    change
  )
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
  return dataRequest(
    call,
    'DELETE',
    `/model/collections/${encodeURIComponent(collection)}/relations/${encodeURIComponent(relation)}`
  )
}
