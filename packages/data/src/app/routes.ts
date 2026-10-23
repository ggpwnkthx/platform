/**
 * The routes of the API (spec §9).
 *
 * The module owns the paths of the contract and the reading of their
 * parameters. Every route of the scope of a workspace is established
 * before it runs: no domain operation starts without a verified
 * principal and a resolved workspace.
 */

import type { Context, Hono, Next } from 'hono'
import type { RequestContext } from '../domains/authorization'
import { verifyGatewayRequest } from '../domains/gateway-context'
import { ModelError, type ModelScope } from '../domains/model'
import { ServiceError } from '../protocol/errors'
import {
  collectionOf,
  parseMetrics,
  readJsonBody,
  recordId,
  recordOf,
  requireContext,
} from './helpers'
import { openapiDocument } from './openapi'
import { parseJson, readQuery } from './query'
import { buildSchemaMetadata } from './schema-metadata'
import type { AppDependencies, AppEnv } from './types'

/**
 * Registers the routes of the scope of a workspace.
 *
 * The routes share the establishment of the context: the gateway signs
 * the identity of the caller, the backend verifies the signature, it
 * resolves the workspace in its registry and it asks the access service for the
 * capabilities of the principal.
 */
export function registerRoutes(app: Hono<AppEnv>, dependencies: AppDependencies): void {
  const establish = async (c: Context<AppEnv>, next: Next): Promise<void> => {
    const url = new URL(c.req.url)
    const identity = await verifyGatewayRequest(dependencies.bindings, {
      method: c.req.method,
      path: url.pathname,
      query: url.search,
      headers: c.req.raw.headers,
    })
    const workspaceId = c.req.param('workspaceId')
    if (workspaceId !== identity.workspaceId) {
      throw new ServiceError('UNAUTHENTICATED')
    }
    // The workspace and its catalog are read together: the identity of
    // the workspace is the identity of the registry, and the catalog is
    // the configuration of the workspace.
    const found = await dependencies.catalog.find(identity.workspaceId)
    if (!found) {
      throw new ServiceError('NOT_FOUND')
    }
    const workspace = found.workspace
    if (workspace.status !== 'active') {
      throw new ServiceError('NOT_FOUND')
    }
    if (identity.expectedTenantId && identity.expectedTenantId !== workspace.tenantId) {
      throw new ServiceError('NOT_FOUND')
    }
    const fresh = MUTATIONS.has(c.req.method)
    const resolved = await dependencies.resolver.resolve(
      {
        subject: identity.subject,
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        routeId: identity.routeId,
      },
      {
        fresh,
        source: 'gateway',
        requestId: c.get('requestId') ?? 'unknown',
        policyBundleVersion: found.catalog.policyBundleVersion,
      }
    )
    const context: RequestContext = {
      ...resolved.context,
      policyBundleVersion: found.catalog.policyBundleVersion,
      catalog: {
        manifest: found.catalog.manifest,
        bundle: found.catalog.bundle,
        schemaVersion: found.catalog.schemaVersion,
        collectionKeys: found.catalog.collectionKeys,
      },
    }
    c.set('context', context)
    c.set('gateway', identity)
    c.set('workspace', workspace)
    // The room of the tenant: the bound of the listener is the bound of
    // the machine, and this one is the bound of the tenant inside it.
    dependencies.limiter.enter(context.tenantId)
    try {
      await next()
    } finally {
      dependencies.limiter.leave(context.tenantId)
    }
  }

  const scope = '/ws/:workspaceId/v1'

  app.get(`${scope}/me`, establish, (c) => {
    const context = requireContext(c)
    const workspace = c.get('workspace')
    return c.json(
      {
        data: {
          principalId: context.principalId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          // The name of the workspace is the name the registry holds
          // for it: the caller reads the name of the workspace it is
          // in, and it reads nothing else of the registry.
          workspace: {
            id: context.workspaceId,
            slug: workspace?.slug ?? null,
            displayName: workspace?.displayName ?? null,
          },
          routeId: context.routeId,
          apiVersion: 'v1',
        },
      },
      200,
      { 'cache-control': 'no-store' }
    )
  })

  app.get(`${scope}/openapi.json`, establish, (c) =>
    c.json(openapiDocument(dependencies.schemaVersion, dependencies.serviceVersion), 200, {
      'cache-control': 'no-store',
    })
  )

  app.get(`${scope}/schema`, establish, (c) => {
    const context = requireContext(c)
    const metadata = buildSchemaMetadata({
      context,
      manifest: context.catalog.manifest,
      bundle: context.catalog.bundle,
      schemaVersion: context.catalog.manifest.schemaVersion,
    })
    return c.json({ data: metadata }, 200, { 'cache-control': 'no-store' })
  })

  app.get(`${scope}/schema/:collection`, establish, (c) => {
    const context = requireContext(c)
    const key = collectionOf(c) ?? ''
    const metadata = buildSchemaMetadata({
      context,
      manifest: context.catalog.manifest,
      bundle: context.catalog.bundle,
      schemaVersion: context.catalog.manifest.schemaVersion,
    })
    const collection = metadata.collections.find((entry) => entry.key === key)
    if (!collection) {
      throw new ServiceError('NOT_FOUND')
    }
    return c.json({ data: collection }, 200, { 'cache-control': 'no-store' })
  })

  app.get(`${scope}/aggregate/:collection`, establish, async (c) => {
    const context = requireContext(c)
    const url = new URL(c.req.url)
    const query = readQuery(url, ['group_by', 'metrics', 'filter', 'search', 'limit'])
    const limit = query.has('limit') ? Number(query.get('limit')) : undefined
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
      throw new ServiceError('INVALID_QUERY', { message: 'the limit is not a valid number' })
    }
    const groupBy = (query.get('group_by') ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
    const metrics = parseMetrics(query.get('metrics') ?? '')
    const filter = query.has('filter') ? parseJson(query.get('filter')!) : undefined
    const result = await dependencies.records.aggregate(context, collectionOf(c), {
      groupBy,
      metrics,
      ...(filter === undefined ? {} : { filter }),
      ...(query.has('search') ? { search: query.get('search')! } : {}),
      limit: limit ?? 100,
    })
    return c.json({ data: result.data, meta: result.meta }, 200, { 'cache-control': 'no-store' })
  })

  app.get(`${scope}/items/:collection`, establish, async (c) => {
    const context = requireContext(c)
    const url = new URL(c.req.url)
    const query = readQuery(url, [
      'fields',
      'filter',
      'search',
      'sort',
      'limit',
      'cursor',
      'include',
      'include_count',
    ])
    const limit = query.has('limit') ? Number(query.get('limit')) : undefined
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      throw new ServiceError('INVALID_QUERY', { message: 'the limit is not a valid number' })
    }
    const filter = query.has('filter') ? parseJson(query.get('filter')!) : undefined
    const result = await dependencies.records.list(context, collectionOf(c), {
      ...(query.has('fields')
        ? {
            fields: query
              .get('fields')!
              .split(',')
              .filter((f) => f.length > 0),
          }
        : {}),
      ...(filter === undefined ? {} : { filter }),
      ...(query.has('search') ? { search: query.get('search')! } : {}),
      ...(query.has('sort')
        ? {
            sort: query
              .get('sort')!
              .split(',')
              .filter((f) => f.length > 0),
          }
        : {}),
      limit: limit ?? 50,
      ...(query.has('cursor') ? { cursor: query.get('cursor')! } : {}),
      ...(query.has('include')
        ? {
            include: query
              .get('include')!
              .split(',')
              .filter((f) => f.length > 0),
          }
        : {}),
      includeCount: query.get('include_count') === 'true',
    })
    return c.json({ data: result.data, meta: result.meta }, 200, { 'cache-control': 'no-store' })
  })

  app.get(`${scope}/items/:collection/:id`, establish, async (c) => {
    const context = requireContext(c)
    // The endpoint of a record takes no parameter of a query: a
    // projection is the work of the list, and a parameter that is not
    // known is refused like it is refused everywhere else.
    readQuery(new URL(c.req.url), [])
    const result = await dependencies.records.get(context, collectionOf(c), recordId(recordOf(c)))
    return new Response(JSON.stringify({ data: result.representation }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: result.etag,
        'cache-control': 'no-store',
      },
    })
  })

  app.post(`${scope}/items/:collection`, establish, async (c) => {
    const context = requireContext(c)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const key = c.req.header('idempotency-key')
    if (!key || !/^[A-Za-z0-9._-]{1,128}$/.test(key)) {
      throw new ServiceError('INVALID_REQUEST', {
        message: 'the idempotency key is required and it is a short string',
      })
    }
    const result = await dependencies.records.create(context, collectionOf(c), {
      body,
      idempotencyKey: key,
    })
    const id = result.receipt!.id
    return new Response(JSON.stringify({ data: result.receipt }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        location: `/ws/${context.workspaceId}/v1/items/${collectionOf(c)}/${id}`,
        ...(result.replayed ? { 'idempotency-replayed': 'true' } : {}),
        'cache-control': 'no-store',
      },
    })
  })

  app.patch(`${scope}/items/:collection/:id`, establish, async (c) => {
    const context = requireContext(c)
    readQuery(new URL(c.req.url), [])
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const result = await dependencies.records.update(context, collectionOf(c), {
      id: recordId(recordOf(c)),
      body,
      expectedEtag: c.req.header('if-match') ?? '',
    })
    return new Response(JSON.stringify({ data: result.representation }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: result.etag!,
        'cache-control': 'no-store',
      },
    })
  })

  app.delete(`${scope}/items/:collection/:id`, establish, async (c) => {
    const context = requireContext(c)
    readQuery(new URL(c.req.url), [])
    await dependencies.records.remove(context, collectionOf(c), {
      id: recordId(recordOf(c)),
      expectedEtag: c.req.header('if-match') ?? '',
    })
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  })

  app.get(`${scope}/items/:collection/:id/versions`, establish, async (c) => {
    const context = requireContext(c)
    readQuery(new URL(c.req.url), [])
    const result = await dependencies.records.versions(
      context,
      collectionOf(c),
      recordId(recordOf(c))
    )
    return c.json({ data: result.data }, 200, { 'cache-control': 'no-store' })
  })

  app.get(`${scope}/items/:collection/:id/versions/:version`, establish, async (c) => {
    const context = requireContext(c)
    readQuery(new URL(c.req.url), [])
    const version = Number(c.req.param('version'))
    if (!Number.isInteger(version) || version < 1) {
      throw new ServiceError('NOT_FOUND')
    }
    const result = await dependencies.records.version(
      context,
      collectionOf(c),
      recordId(recordOf(c)),
      version
    )
    return new Response(JSON.stringify({ data: result.representation }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: result.etag,
        'cache-control': 'no-store',
      },
    })
  })

  app.post(`${scope}/items/:collection/:id/rollback`, establish, async (c) => {
    const context = requireContext(c)
    readQuery(new URL(c.req.url), [])
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const unknown = Object.keys(body).filter((key) => key !== 'version')
    if (unknown.length > 0) {
      throw new ServiceError('INVALID_REQUEST', {
        message: `the body holds unknown properties: ${unknown.sort().join(', ')}`,
      })
    }
    const version = body.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new ServiceError('INVALID_REQUEST', {
        message: 'the version is required and it is a positive integer',
      })
    }
    const result = await dependencies.records.rollback(context, collectionOf(c), {
      id: recordId(recordOf(c)),
      version,
      expectedEtag: c.req.header('if-match') ?? '',
    })
    return new Response(JSON.stringify({ data: result.representation }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: result.etag ?? '',
        'cache-control': 'no-store',
      },
    })
  })

  app.get(`${scope}/model`, establish, async (c) => {
    const context = requireContext(c)
    requireModelReader(context)
    const document = await dependencies.model.describe(
      context.workspaceId,
      context.catalog.schemaVersion ?? '',
      context.catalog.collectionKeys ?? []
    )
    return c.json(
      {
        data: {
          ...document,
          // The model of the workspace is read by anybody, and it is
          // written by the administrator of the workspace: the page
          // shows the acts that the caller may perform.
          writable: context.permissionKeys.includes(MODEL_WRITE),
        },
      },
      200,
      { 'cache-control': 'no-store' }
    )
  })

  app.post(`${scope}/model/collections`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    await changeModel(context, async (scope) => {
      await dependencies.model.registerCollection(scope, String(body.key ?? ''))
      return 0
    })
    return c.json({ data: { registered: true } }, 201, { 'cache-control': 'no-store' })
  })

  app.delete(`${scope}/model/collections/:collection`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    await changeModel(context, async (scope) => {
      await dependencies.model.unregisterCollection(scope, collectionOf(c))
      return 0
    })
    return c.json({ data: { registered: false } }, 200, { 'cache-control': 'no-store' })
  })

  app.patch(`${scope}/model/collections/:collection`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const version = await changeModel(context, (scope) =>
      dependencies.model.setCollection(scope, collectionOf(c), {
        ...(body.label !== undefined ? { label: String(body.label) } : {}),
        ...(body.description !== undefined ? { description: String(body.description) } : {}),
      })
    )
    return c.json({ data: { version } }, 200, { 'cache-control': 'no-store' })
  })

  app.post(`${scope}/model/collections/:collection/fields`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const name = String(body.name ?? '')
    const version = await changeModel(context, (scope) =>
      dependencies.model.addField(scope, collectionOf(c), name, attributesOf(body))
    )
    return c.json({ data: { version } }, 201, { 'cache-control': 'no-store' })
  })

  app.patch(`${scope}/model/collections/:collection/fields/:field`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const version = await changeModel(context, (scope) =>
      dependencies.model.changeField(
        scope,
        collectionOf(c),
        c.req.param('field') ?? '',
        attributesOf(body)
      )
    )
    return c.json({ data: { version } }, 200, { 'cache-control': 'no-store' })
  })

  app.delete(`${scope}/model/collections/:collection/fields/:field`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const version = await changeModel(context, (scope) =>
      dependencies.model.removeField(scope, collectionOf(c), c.req.param('field') ?? '')
    )
    return c.json({ data: { version } }, 200, { 'cache-control': 'no-store' })
  })

  app.post(`${scope}/model/collections/:collection/fields/:field/move`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const direction = body.direction === 'down' ? 'down' : 'up'
    const version = await changeModel(context, (scope) =>
      dependencies.model.moveField(scope, collectionOf(c), c.req.param('field') ?? '', direction)
    )
    return c.json({ data: { version } }, 200, { 'cache-control': 'no-store' })
  })

  app.post(`${scope}/model/collections/:collection/relations`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const name = String(body.name ?? '')
    const version = await changeModel(context, (scope) =>
      dependencies.model.addRelation(scope, collectionOf(c), name, relationOf(body))
    )
    return c.json({ data: { version } }, 201, { 'cache-control': 'no-store' })
  })

  app.patch(`${scope}/model/collections/:collection/relations/:relation`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const body = await readJsonBody(c, dependencies.settings.requests.maxBodyBytes)
    const version = await changeModel(context, (scope) =>
      dependencies.model.changeRelation(
        scope,
        collectionOf(c),
        c.req.param('relation') ?? '',
        relationOf(body)
      )
    )
    return c.json({ data: { version } }, 200, { 'cache-control': 'no-store' })
  })

  app.delete(`${scope}/model/collections/:collection/relations/:relation`, establish, async (c) => {
    const context = requireContext(c)
    requireModelWriter(context)
    const version = await changeModel(context, (scope) =>
      dependencies.model.removeRelation(scope, collectionOf(c), c.req.param('relation') ?? '')
    )
    return c.json({ data: { version } }, 200, { 'cache-control': 'no-store' })
  })

  app.get(`${scope}/audit`, establish, async (c) => {
    const context = requireContext(c)
    if (!context.permissionKeys.includes('data.audit.read')) {
      throw new ServiceError('FORBIDDEN')
    }
    const url = new URL(c.req.url)
    const query = readQuery(url, ['limit', 'cursor'])
    const limit = query.has('limit') ? Number(query.get('limit')) : 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ServiceError('INVALID_QUERY', { message: 'the limit is not a valid number' })
    }
    let position: { occurredAt: string; id: string } | undefined
    if (query.has('cursor')) {
      const raw = query.get('cursor')!
      const index = raw.indexOf('|')
      if (index < 0) {
        throw new ServiceError('INVALID_CURSOR')
      }
      position = { occurredAt: raw.slice(0, index), id: raw.slice(index + 1) }
    }
    const page = await dependencies.auditReader.list(
      { tenantId: context.tenantId, workspaceId: context.workspaceId },
      { limit, ...(position ? { position } : {}) }
    )
    return c.json(
      {
        data: page.entries,
        meta: { limit, nextCursor: page.nextCursor },
      },
      200,
      { 'cache-control': 'no-store' }
    )
  })
}

/** The methods that change the data. */
const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * The capabilities that let an administrator read and change the model
 * of a workspace.
 *
 * The model of a workspace is its configuration: the administrator of
 * the workspace reads it and writes it, and the access service says who
 * the administrator is. The model names the fields of the collections
 * of the workspace, and the metadata of the schema is the answer that
 * every other caller reads.
 */
const MODEL_WRITE = 'data.model.write'
const MODEL_READ = 'data.model.read'

/** Refuses a caller that may not read the model of the workspace. */
function requireModelReader(context: RequestContext): void {
  if (
    !context.permissionKeys.includes(MODEL_READ) &&
    !context.permissionKeys.includes(MODEL_WRITE)
  ) {
    throw new ServiceError('FORBIDDEN', {
      message: 'the caller may not read the model of the workspace',
    })
  }
}

/** Refuses a caller that may not change the model of the workspace. */
function requireModelWriter(context: RequestContext): void {
  if (!context.permissionKeys.includes(MODEL_WRITE)) {
    throw new ServiceError('FORBIDDEN', {
      message: 'the caller may not change the model of the workspace',
    })
  }
}

/** The scope of a change of the model of a workspace. */
function scopeOf(context: RequestContext): ModelScope {
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    principalId: context.principalId,
  }
}

/**
 * Runs a change of the model and answers with its version.
 *
 * The refusal of the model is the refusal of the contract: a change
 * that cannot hold is a bad request, and a model that changed in
 * between is a conflict.
 */
async function changeModel(
  context: RequestContext,
  action: (scope: ModelScope) => Promise<number>
): Promise<number> {
  try {
    return await action(scopeOf(context))
  } catch (error) {
    if (error instanceof ModelError) {
      if (error.code === 'NOT_FOUND')
        throw new ServiceError('NOT_FOUND', { message: error.message })
      if (error.code === 'CONFLICT') throw new ServiceError('CONFLICT', { message: error.message })
      throw new ServiceError('INVALID_REQUEST', { message: error.message })
    }
    throw error
  }
}

/** The attributes of a field, as the body of a change carries them. */
function attributesOf(body: Record<string, unknown>): {
  type?:
    | 'string'
    | 'text'
    | 'boolean'
    | 'integer'
    | 'decimal'
    | 'uuid'
    | 'timestamp'
    | 'json'
    | 'enum'
  required?: boolean
  nullable?: boolean
  label?: string
  description?: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
  minLength?: number
} {
  const attributes: Record<string, unknown> = {}
  if (typeof body.type === 'string') attributes.type = body.type
  if (typeof body.required === 'boolean') attributes.required = body.required
  if (typeof body.nullable === 'boolean') attributes.nullable = body.nullable
  if (typeof body.label === 'string') attributes.label = body.label
  if (typeof body.description === 'string') attributes.description = body.description
  if (Array.isArray(body.enum)) attributes.enum = body.enum.map((value) => String(value))
  if (body.default !== undefined) attributes.default = body.default
  if (typeof body.minimum === 'number') attributes.minimum = body.minimum
  if (typeof body.maximum === 'number') attributes.maximum = body.maximum
  if (typeof body.maxLength === 'number') attributes.maxLength = body.maxLength
  if (typeof body.minLength === 'number') attributes.minLength = body.minLength
  return attributes as never
}

/** The attributes of a relation, as the body of a change carries them. */
function relationOf(body: Record<string, unknown>): {
  target: string
  type: 'many-to-one' | 'one-to-many'
  field: string
  label?: string
  description?: string
} {
  return {
    target: String(body.target ?? ''),
    type: body.type === 'one-to-many' ? 'one-to-many' : 'many-to-one',
    field: String(body.field ?? ''),
    ...(typeof body.label === 'string' ? { label: body.label } : {}),
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
  }
}
