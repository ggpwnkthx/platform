/**
 * The principals of the administration (spec §10.3).
 *
 * The handlers are thin: they read the body, they ask the
 * administration domain and they write the answer. The rules live in the
 * domain.
 */

import type { Context } from 'hono'
import { PrincipalBatchBody, PrincipalBody, type Principal } from '../../domains/administration'
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

/** The principal of an answer. */
function principalBody(principal: Principal): Record<string, unknown> {
  return {
    id: principal.id,
    tenant: principal.tenant,
    externalSubject: principal.externalSubject,
    email: principal.email,
    displayName: principal.displayName,
    status: principal.status,
    lastLoginAt: principal.lastLoginAt?.toISOString() ?? null,
    createdAt: principal.createdAt.toISOString(),
  }
}

/** `POST /v1/admin/users`: the principal of an external identity. */
export async function principalHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/users'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, PrincipalBody, PrincipalBatchBody, {
      maxBytes: MAX_BATCH_BODY_BYTES,
    })
    // A batch is the call that onboards a tenant: one call writes a
    // hundred principals instead of a hundred calls (spec §10.4).
    if ('principals' in body) {
      const outcomes = await dependencies.administration.upsertPrincipals(
        scope,
        body.principals.map((principal) => ({
          tenant: principal.tenant,
          externalSubject: principal.externalSubject,
          email: principal.email,
          displayName: principal.displayName,
          status: principal.status,
        })),
        auditContext(context, dependencies, scope)
      )
      return answer(context, dependencies, scope, endpoint, 200, {
        principals: outcomes.map((outcome) => ({
          tenant: outcome.tenant,
          externalSubject: outcome.externalSubject,
          id: outcome.id,
          created: outcome.created,
          ...(outcome.error ? { error: outcome.error, message: outcome.message } : {}),
        })),
      })
    }
    const result = await dependencies.administration.upsertPrincipal(
      scope,
      {
        tenant: body.tenant,
        externalSubject: body.externalSubject,
        email: body.email,
        displayName: body.displayName,
        status: body.status,
      },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      result.created ? 201 : 200,
      principalBody(result.principal),
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/** `GET /v1/admin/users`: the list of the principals. */
export async function principalsHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/users'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listPrincipals(scope, {
      tenant: query.tenant ?? null,
      status: query.status ?? null,
      email: query.email ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      principals: page.principals.map(principalBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}
