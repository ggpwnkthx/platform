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
 *
 * The contract is read in the client of the platform (`@platform/client`):
 * the console and the CLI speak to the same services and read the same
 * paths. What is the CLI's is the way it turns a refusal into the
 * failure that carries the status the process ends with.
 */

import {
  AccessAdminClient as PlatformAdminClient,
  AccessClient as PlatformAccessClient,
  bodyOf,
  decide as platformDecide,
} from '@platform/client'
import { failureOf } from './answer'
import type { HttpPort } from './contracts'
import { transportOf } from './transport'

/** The parameters of a call to Access. */
export interface AccessCall {
  /** The transport of the call. */
  readonly http: HttpPort
  /** The address of Access. */
  readonly baseUrl: string
  /** The credential of the administration. */
  readonly token: string
}

/** The client of the administration of Access. */
function clientOf(call: AccessCall): PlatformAdminClient {
  return new PlatformAdminClient({
    baseUrl: call.baseUrl,
    credential: call.token,
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

/** The tenants of the deployment. */
export async function listTenants(call: AccessCall): Promise<unknown> {
  return await read(() => clientOf(call).send('GET', '/tenants').then(bodyOf))
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
  return await read(() => clientOf(call).send('POST', '/tenants', {}, tenant).then(bodyOf))
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
  return await read(() =>
    clientOf(call)
      .send('GET', '/users', query as Record<string, string>)
      .then(bodyOf)
  )
}

/**
 * Registers a principal, or a batch of them.
 *
 * @param call the parameters of the call.
 * @param principal the principal, or the batch of them.
 */
export async function writePrincipal(call: AccessCall, principal: unknown): Promise<unknown> {
  return await read(() => clientOf(call).send('POST', '/users', {}, principal).then(bodyOf))
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
  return await read(() =>
    clientOf(call)
      .send('GET', '/grants', query as Record<string, string>)
      .then(bodyOf)
  )
}

/**
 * Gives a grant, or changes it.
 *
 * @param call the parameters of the call.
 * @param grant the grant to write.
 */
export async function writeGrant(call: AccessCall, grant: unknown): Promise<unknown> {
  return await read(() => clientOf(call).send('PUT', '/grants', {}, grant).then(bodyOf))
}

/**
 * Revokes a grant.
 *
 * @param call the parameters of the call.
 * @param id the id of the grant.
 */
export async function revokeGrant(call: AccessCall, id: string): Promise<unknown> {
  return await read(() =>
    clientOf(call)
      .send('DELETE', `/grants/${encodeURIComponent(id)}`)
      .then(bodyOf)
  )
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
  return await read(() =>
    clientOf(call)
      .send('GET', '/groups', query as Record<string, string>)
      .then(bodyOf)
  )
}

/**
 * Writes a group, or changes it.
 *
 * @param call the parameters of the call.
 * @param group the group to write.
 */
export async function writeGroup(call: AccessCall, group: unknown): Promise<unknown> {
  return await read(() => clientOf(call).send('POST', '/groups', {}, group).then(bodyOf))
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
  return await read(() =>
    clientOf(call)
      .send('GET', '/roles', query as Record<string, string>)
      .then(bodyOf)
  )
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
  return await read(() => clientOf(call).send('PUT', '/roles', {}, role).then(bodyOf))
}

/**
 * Removes a role.
 *
 * @param call the parameters of the call.
 * @param id the id of the role.
 */
export async function removeRole(call: AccessCall, id: string): Promise<unknown> {
  return await read(() =>
    clientOf(call)
      .send('DELETE', `/roles/${encodeURIComponent(id)}`)
      .then(bodyOf)
  )
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
  return await read(() =>
    clientOf(call)
      .send('GET', '/audit', query as Record<string, string>)
      .then(bodyOf)
  )
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
  return await read(() =>
    platformDecide(
      {
        baseUrl: call.baseUrl,
        transport: transportOf(call.http),
      },
      decision,
      token ?? call.token
    )
  )
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
  return await read(() =>
    new PlatformAccessClient({
      baseUrl: call.baseUrl,
      transport: transportOf(call.http),
    }).context(request, token ?? call.token)
  )
}
