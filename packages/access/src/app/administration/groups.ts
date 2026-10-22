/**
 * The groups of the administration (spec §10.5).
 *
 * The handlers are thin: they read the body, they ask the
 * administration domain and they write the answer. The rules live in the
 * domain.
 */

import type { Context } from 'hono'
import { GroupBody, type Group } from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, auditContext, authenticate, failure, readBody } from './support'

/** The group of an answer. */
function groupBody(group: Group): Record<string, unknown> {
  return {
    id: group.id,
    tenant: group.tenant,
    key: group.key,
    displayName: group.displayName,
    members: group.members,
    createdAt: group.createdAt.toISOString(),
  }
}

/** `GET /v1/admin/groups`: the list of the groups. */
export async function groupsHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/groups'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listGroups(scope, {
      tenant: query.tenant ?? null,
      key: query.key ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      groups: page.groups.map(groupBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}

/** `POST /v1/admin/groups`: the group and its membership. */
export async function groupHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/groups'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, GroupBody)
    const result = await dependencies.administration.upsertGroup(
      scope,
      {
        tenant: body.tenant,
        key: body.key,
        displayName: body.displayName,
        members: body.members ?? [],
      },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      result.created ? 201 : 200,
      groupBody(result.group),
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}
