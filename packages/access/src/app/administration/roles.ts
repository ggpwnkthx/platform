/**
 * The roles of the administration (spec §10.7).
 *
 * The handlers are thin: they read the body, they ask the
 * administration domain and they write the answer. The rules live in the
 * domain.
 */

import type { Context } from 'hono'
import { AdministrationError, RoleBody, type Role } from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, auditContext, authenticate, failure, readBody } from './support'

/** The role of an answer. */
function roleBody(role: Role): Record<string, unknown> {
  return {
    id: role.id,
    tenant: role.tenant,
    key: role.key,
    displayName: role.displayName,
    description: role.description,
    permissions: role.permissionKeys,
    roles: role.roleKeys,
    createdAt: role.createdAt.toISOString(),
  }
}

/** `GET /v1/admin/roles`: the list of the roles. */
export async function rolesHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/roles'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listRoles(scope, {
      tenant: query.tenant ?? null,
      key: query.key ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      roles: page.roles.map(roleBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}

/**
 * `PUT /v1/admin/roles`: the role and its memberships.
 *
 * The memberships are replaced: the permissions and the roles of the
 * body are the ones the role holds, and the ones that are not in the
 * body are not held by the role any more.
 */
export async function roleHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/roles'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, RoleBody)
    const result = await dependencies.administration.upsertRole(
      scope,
      {
        tenant: body.tenant,
        key: body.key,
        displayName: body.displayName,
        description: body.description,
        permissionKeys: body.permissions ?? [],
        roleKeys: body.roles ?? [],
      },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      result.created ? 201 : 200,
      roleBody(result.role),
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/** `DELETE /v1/admin/roles/{id}`: the removal of a role. */
export async function removeRoleHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/roles'
  try {
    const scope = await authenticate(context, dependencies)
    const id = context.req.param('id')
    // An id that is not an id names no role: the answer is the same as
    // the one of an id that does not exist.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AdministrationError('not_found', 'the role does not exist')
    }
    const audit = await dependencies.administration.removeRole(
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
