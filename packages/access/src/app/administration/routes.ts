/**
 * The administrative endpoints of the routes of the logins (spec §10.18).
 *
 * The handlers are thin: they read the body, they ask the administration
 * domain and they write the answer. The rules live in the domain.
 *
 * A route names the tenant of a login and the provider the login signs
 * in at. A route is a hint that the platform proves before it routes
 * anything, and the answer of a route carries the challenge its owner
 * publishes to prove the domain (§3.13).
 */

import type { Context } from 'hono'
import {
  AdministrationError,
  RouteBody,
  RouteVerificationBody,
  type Route,
} from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, auditContext, authenticate, failure, readBody } from './support'

/** The route of an answer. */
function routeBody(route: Route): Record<string, unknown> {
  return {
    id: route.id,
    kind: route.kind,
    key: route.key,
    tenant: route.tenant,
    provider: route.provider,
    status: route.status,
    verification: route.verification,
    challenge: route.challenge,
    verifiedAt: route.verifiedAt ? route.verifiedAt.toISOString() : null,
    verifiedBy: route.verifiedBy,
    createdAt: route.createdAt.toISOString(),
  }
}

/** `GET /v1/admin/routes`: the list of the routes. */
export async function routesHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/routes'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listRoutes(scope, {
      tenant: query.tenant ?? null,
      kind: query.kind ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      routes: page.routes.map(routeBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}

/**
 * `POST /v1/admin/routes`: the route of a domain or of an address.
 *
 * The call is an upsert on the pair `(kind, key)`. A route that is
 * created waits for its proof: it routes nothing until the owner of the
 * domain publishes the challenge, or the operator of the platform vouches
 * for it.
 */
export async function routeHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/routes'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, RouteBody)
    const result = await dependencies.administration.upsertRoute(
      scope,
      {
        tenant: body.tenant,
        key: body.key,
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.provider !== undefined ? { provider: body.provider } : {}),
      },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      result.created ? 201 : 200,
      { route: routeBody(result.route) },
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/**
 * `POST /v1/admin/routes/{id}/verify`: the proof of a route.
 *
 * The proof of a domain is the record its owner publishes: the service
 * reads the record of `_access` of the domain and compares it with the
 * challenge of the route. The operator of the platform may vouch for a
 * domain instead, and only the operator of the platform may.
 */
export async function verifyRouteHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/routes'
  try {
    const scope = await authenticate(context, dependencies)
    const id = context.req.param('id')
    // An id that is not an id names no route: the answer is the same as
    // the one of an id that does not exist.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AdministrationError('not_found', 'the route does not exist')
    }
    const body = await readBody(context, RouteVerificationBody)
    const result = await dependencies.administration.verifyRoute(
      scope,
      id,
      { status: body.status, verification: body.verification },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      200,
      { route: routeBody(result.route) },
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}
