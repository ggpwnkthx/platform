/**
 * Access.
 *
 * Access is the service that decides what a caller may do, and it
 * administers the tenants, the principals, the groups, the roles and the
 * grants. The CLI is a client of that administration, and it decides
 * nothing: it asks, and it shows the answer.
 *
 * The decision contract is a contract of its own: the CLI may ask for a
 * decision, and it may ask for the context of a principal, and it never
 * computes either of them locally.
 */

import type { HttpPort } from './contracts'
import { expectSuccess } from './answer'

/** The parameters of a call to Access. */
export interface AccessCall {
  /** The transport of the call. */
  readonly http: HttpPort
  /** The address of Access. */
  readonly baseUrl: string
  /** The credential of the administration. */
  readonly token: string
}

/**
 * Sends a request to Access.
 *
 * @param call the parameters of the call.
 * @param method the method of the request.
 * @param path the path of the request.
 * @param query the query of the request.
 * @param body the body of the request.
 * @param token the credential of the request, when it is not the one of the call.
 */
export async function accessRequest(
  call: AccessCall,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
  body?: unknown,
  token?: string
): Promise<unknown> {
  const url = new URL(`${call.baseUrl}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }
  const request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    url: string
    token: string
    headers: Record<string, string>
    body?: string
  } = {
    method,
    url: url.toString(),
    token: token ?? call.token,
    headers: {},
  }
  if (body !== undefined) {
    request.headers['content-type'] = 'application/json'
    request.body = JSON.stringify(body)
  }
  const answer = await call.http.send(request)
  return expectSuccess(answer, `${method} ${path}`)
}

/** The tenants of the deployment. */
export async function listTenants(call: AccessCall): Promise<unknown> {
  return accessRequest(call, 'GET', '/v1/admin/tenants')
}

/**
 * Registers a tenant, or changes it.
 *
 * The call is an upsert by slug: a tenant that exists is changed, and a
 * tenant that does not exist is created.
 *
 * @param call the parameters of the call.
 * @param tenant the tenant to write.
 */
export async function writeTenant(call: AccessCall, tenant: unknown): Promise<unknown> {
  return accessRequest(call, 'POST', '/v1/admin/tenants', undefined, tenant)
}

/**
 * The principals of the deployment.
 *
 * @param call the parameters of the call.
 * @param query the query of the page.
 */
export async function listPrincipals(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return accessRequest(call, 'GET', '/v1/admin/users', query)
}

/**
 * Registers a principal, or a batch of them.
 *
 * @param call the parameters of the call.
 * @param principal the principal, or the batch of them.
 */
export async function writePrincipal(call: AccessCall, principal: unknown): Promise<unknown> {
  return accessRequest(call, 'POST', '/v1/admin/users', undefined, principal)
}

/**
 * The grants of the deployment.
 *
 * @param call the parameters of the call.
 * @param query the query of the page.
 */
export async function listGrants(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return accessRequest(call, 'GET', '/v1/admin/grants', query)
}

/**
 * Gives a grant, or changes it.
 *
 * @param call the parameters of the call.
 * @param grant the grant to write.
 */
export async function writeGrant(call: AccessCall, grant: unknown): Promise<unknown> {
  return accessRequest(call, 'PUT', '/v1/admin/grants', undefined, grant)
}

/**
 * Revokes a grant.
 *
 * @param call the parameters of the call.
 * @param id the id of the grant.
 */
export async function revokeGrant(call: AccessCall, id: string): Promise<unknown> {
  return accessRequest(call, 'DELETE', `/v1/admin/grants/${encodeURIComponent(id)}`)
}

/**
 * The groups of the deployment.
 *
 * @param call the parameters of the call.
 * @param query the query of the page.
 */
export async function listGroups(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return accessRequest(call, 'GET', '/v1/admin/groups', query)
}

/**
 * Writes a group, or changes it.
 *
 * @param call the parameters of the call.
 * @param group the group to write.
 */
export async function writeGroup(call: AccessCall, group: unknown): Promise<unknown> {
  return accessRequest(call, 'POST', '/v1/admin/groups', undefined, group)
}

/**
 * The roles of the deployment.
 *
 * @param call the parameters of the call.
 * @param query the query of the page.
 */
export async function listRoles(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return accessRequest(call, 'GET', '/v1/admin/roles', query)
}

/**
 * Writes a role, or changes it.
 *
 * A role that is written is replaced: the write carries the whole role,
 * and the permissions that are not in it are not in the role anymore.
 *
 * @param call the parameters of the call.
 * @param role the role to write.
 */
export async function writeRole(call: AccessCall, role: unknown): Promise<unknown> {
  return accessRequest(call, 'PUT', '/v1/admin/roles', undefined, role)
}

/**
 * Removes a role.
 *
 * @param call the parameters of the call.
 * @param id the id of the role.
 */
export async function removeRole(call: AccessCall, id: string): Promise<unknown> {
  return accessRequest(call, 'DELETE', `/v1/admin/roles/${encodeURIComponent(id)}`)
}

/**
 * The audit of the administration.
 *
 * @param call the parameters of the call.
 * @param query the query of the page.
 */
export async function audit(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return accessRequest(call, 'GET', '/v1/admin/audit', query)
}

/**
 * Asks Access for a decision.
 *
 * @param call the parameters of the call.
 * @param decision the question.
 * @param token the credential of the decision, when it is not the one of the call.
 */
export async function decide(
  call: AccessCall,
  decision: unknown,
  token?: string
): Promise<unknown> {
  return accessRequest(call, 'POST', '/v1/decisions', undefined, decision, token)
}

/**
 * Reads the context of a principal.
 *
 * @param call the parameters of the call.
 * @param request the question.
 * @param token the credential of the context, when it is not the one of the call.
 */
export async function accessContext(
  call: AccessCall,
  request: unknown,
  token?: string
): Promise<unknown> {
  return accessRequest(call, 'POST', '/v1/access-context', undefined, request, token)
}
