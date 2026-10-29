/**
 * The control plane of the gateway.
 *
 * The gateway has no administrative endpoint and accepts no
 * administrative token: a surface that decides who reaches the
 * applications is a surface an attacker reaches. The administration is
 * done by a separate process, and the CLI is a client of it, exactly as
 * the console is a client of the three services.
 *
 * The scopes of the control plane are not a hierarchy: a token that may
 * operate may not write the route table, and a token that may write it
 * may not purge a session. The CLI does not pretend otherwise, and it
 * never retries a refusal with another credential.
 */

import type { HttpPort } from './contracts'
import { expectSuccess } from './answer'
import { CliFailure } from './failure'

/** The parameters of a call to the control plane. */
export interface ControlCall {
  /** The transport of the call. */
  readonly http: HttpPort
  /** The address of the control plane. */
  readonly baseUrl: string
  /** The credential of the operator. */
  readonly token: string
}

/**
 * Sends a request to the control plane.
 *
 * @param call the parameters of the call.
 * @param method the method of the request.
 * @param path the path of the request.
 * @param query the query of the request.
 * @param body the body of the request.
 * @param headers the headers of the request.
 */
export async function controlRequest(
  call: ControlCall,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
  body?: unknown,
  headers?: Readonly<Record<string, string>>
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
 * Reads the route table that is active.
 *
 * @param call the parameters of the call.
 */
export async function activeConfiguration(call: ControlCall): Promise<{
  revision: number
  table: unknown
  author?: string
  createdAt?: string
  warnings: readonly string[]
}> {
  const body = (await controlRequest(call, 'GET', '/v1/config')) as {
    revision?: number
    table?: unknown
    author?: string
    createdAt?: string
    warnings?: readonly string[]
  }
  return {
    revision: body.revision ?? 0,
    table: body.table ?? null,
    author: body.author,
    createdAt: body.createdAt,
    warnings: body.warnings ?? [],
  }
}

/**
 * Validates a route table without writing it.
 *
 * @param call the parameters of the call.
 * @param table the table to validate.
 */
export async function validateConfiguration(
  call: ControlCall,
  table: unknown
): Promise<{
  ok: boolean
  errors: readonly string[]
  conflicts: readonly string[]
  warnings: readonly string[]
  diff?: unknown
}> {
  const body = (await controlRequest(call, 'POST', '/v1/config/validate', undefined, table)) as {
    ok?: boolean
    errors?: readonly string[]
    conflicts?: readonly string[]
    warnings?: readonly string[]
    diff?: unknown
  }
  return {
    ok: body.ok ?? true,
    errors: body.errors ?? [],
    conflicts: body.conflicts ?? [],
    warnings: body.warnings ?? [],
    diff: body.diff,
  }
}

/**
 * Writes a route table as a new revision.
 *
 * The write is a compare-and-swap: the revision the caller believes is
 * active is the one it names, and the write is refused when the pointer
 * moved. A write without a revision is refused by the service, and the
 * CLI does not hide it.
 *
 * @param call the parameters of the call.
 * @param table the table to write.
 * @param revision the revision the caller believes is active.
 */
export async function writeConfiguration(
  call: ControlCall,
  table: unknown,
  revision: number
): Promise<number> {
  const body = (await controlRequest(call, 'PUT', '/v1/config', undefined, table, {
    'if-match': String(revision),
  })) as { revision?: number }
  return body.revision ?? revision
}

/**
 * Writes an older revision again, as a new revision.
 *
 * @param call the parameters of the call.
 * @param revision the revision to write again.
 */
export async function rollbackConfiguration(call: ControlCall, revision: number): Promise<number> {
  const body = (await controlRequest(call, 'POST', '/v1/config/rollback', undefined, {
    revision,
  })) as { revision?: number }
  return body.revision ?? revision
}

/**
 * The history of the route table.
 *
 * @param call the parameters of the call.
 * @param limit the size of the page.
 * @param offset the offset of the page.
 */
export async function configurationHistory(
  call: ControlCall,
  limit: number,
  offset: number
): Promise<unknown> {
  return controlRequest(call, 'GET', '/v1/config/history', { limit, offset })
}

/**
 * The replicas that serve the route table.
 *
 * @param call the parameters of the call.
 */
export async function replicas(call: ControlCall): Promise<unknown> {
  return controlRequest(call, 'GET', '/v1/replicas')
}

/**
 * The trail of the writes of the control plane.
 *
 * @param call the parameters of the call.
 * @param limit the size of the page.
 * @param offset the offset of the page.
 */
export async function auditTrail(
  call: ControlCall,
  limit: number,
  offset: number
): Promise<unknown> {
  return controlRequest(call, 'GET', '/v1/audit', { limit, offset })
}

/**
 * Ends the sessions of a caller.
 *
 * @param call the parameters of the call.
 * @param subject the subject whose sessions end.
 */
export async function revokeSessions(call: ControlCall, subject: string): Promise<number> {
  const body = (await controlRequest(call, 'DELETE', '/v1/sessions', { subject })) as {
    revoked?: number
  }
  return body.revoked ?? 0
}

/**
 * Purges the cached decisions of a caller.
 *
 * @param call the parameters of the call.
 * @param subject the subject whose decisions are purged.
 * @param workspace the workspace whose decisions are purged.
 */
export async function purgeDecisions(
  call: ControlCall,
  subject?: string,
  workspace?: string
): Promise<number> {
  if (!subject && !workspace) {
    throw new CliFailure(
      'a subject or a workspace is needed to purge the decisions',
      2,
      'not_configured'
    )
  }
  const body = (await controlRequest(call, 'DELETE', '/v1/decisions', {
    subject,
    workspace,
  })) as { purged?: number }
  return body.purged ?? 0
}
