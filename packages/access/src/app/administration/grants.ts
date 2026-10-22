/**
 * The grants of the administration (spec §10.2, §10.6).
 *
 * The handlers are thin: they read the body, they ask the
 * administration domain and they write the answer. The rules live in the
 * domain.
 */

import type { Context } from 'hono'
import {
  AdministrationError,
  GrantBatchBody,
  GrantBody,
  type Grant,
} from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import {
  answer,
  auditContext,
  authenticate,
  failure,
  MAX_BATCH_BODY_BYTES,
  readBody,
} from './support'

/** The grant of an answer. */
function grantBody(grant: Grant): Record<string, unknown> {
  return {
    id: grant.id,
    tenant: grant.tenant,
    userId: grant.userId,
    group: grant.group,
    permission: grant.permission,
    role: grant.role,
    workspaceId: grant.workspaceId,
    routeId: grant.routeId,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    grantedBy: grant.grantedBy,
    createdAt: grant.createdAt.toISOString(),
  }
}

/** `PUT /v1/admin/grants`: the grant of a scope. */
export async function grantHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/grants'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, GrantBody, GrantBatchBody, {
      maxBytes: MAX_BATCH_BODY_BYTES,
    })
    // A batch is the call that writes the grants of a tenant at once
    // (spec §10.6).
    if ('grants' in body) {
      const outcomes = await dependencies.administration.upsertGrants(
        scope,
        body.grants.map((grant) => ({
          tenant: grant.tenant,
          userId: grant.userId ?? null,
          group: grant.group ?? null,
          permission: grant.permission ?? null,
          role: grant.role ?? null,
          workspaceId: grant.workspaceId ?? null,
          routeId: grant.routeId ?? null,
          expiresAt: grant.expiresAt ? new Date(grant.expiresAt) : null,
          grantedBy: grant.grantedBy ?? null,
        })),
        auditContext(context, dependencies, scope)
      )
      return answer(context, dependencies, scope, endpoint, 200, {
        grants: outcomes.map((outcome) => ({
          tenant: outcome.tenant,
          id: outcome.id,
          created: outcome.created,
          ...(outcome.error ? { error: outcome.error, message: outcome.message } : {}),
        })),
      })
    }
    const result = await dependencies.administration.upsertGrant(
      scope,
      {
        tenant: body.tenant,
        userId: body.userId ?? null,
        group: body.group ?? null,
        permission: body.permission ?? null,
        role: body.role ?? null,
        workspaceId: body.workspaceId ?? null,
        routeId: body.routeId ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        grantedBy: body.grantedBy ?? null,
      },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      200,
      grantBody(result.grant),
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/** `GET /v1/admin/grants`: the list of the grants. */
export async function grantsHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/grants'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listGrants(scope, {
      tenant: query.tenant ?? null,
      userId: query.userId ?? null,
      live: query.live ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      grants: page.grants.map(grantBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}

/** `DELETE /v1/admin/grants/{id}`: the revocation of a grant. */
export async function revokeGrantHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/grants'
  try {
    const scope = await authenticate(context, dependencies)
    const id = context.req.param('id')
    // An id that is not an id names no grant: the answer is the same as
    // the one of an id that does not exist.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AdministrationError('not_found', 'the grant does not exist')
    }
    const audit = await dependencies.administration.revokeGrant(
      scope,
      id,
      auditContext(context, dependencies, scope)
    )
    dependencies.logger.info('the administrative call', {
      endpoint,
      status: 204,
      address: dependencies.peerAddress(context.req.raw),
      action: audit.action,
      id: audit.id,
      ...(audit.tenant ? { tenant: audit.tenant } : {}),
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    return failure(error)
  }
}
