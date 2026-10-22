/**
 * The shared parts of the administration (spec §10).
 *
 * The handlers of the administration are thin: they authenticate the
 * call, they validate the body, they ask the administration domain and
 * they write the answer. The parts they share live here: the reading of
 * a body, the authentication of a call, the refusal of a failure and the
 * log of a call.
 */

import type { Context } from 'hono'
import { fingerprint } from '../../observability'
import {
  AdministrationError,
  type AdminScope,
  type AuditContext,
  type AuditEntry,
} from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import { jsonError } from '../errors'
import type { AccessEnv } from '../state'

/** The size of a body of the administration. */
const MAX_BODY_BYTES = 65_536

/**
 * The size of the body of a batch.
 *
 * A batch carries a list of principals or of grants: a thousand of them
 * are a hundred kilobytes, and the limit of a single body would refuse
 * the call that onboards a tenant. The body of a batch is read by the
 * endpoint that accepts a list, and the number of items of the list is
 * bounded by the domain (spec §10.4).
 */
export const MAX_BATCH_BODY_BYTES = 1_048_576

/** The options of the reading of a body. */
interface BodyOptions {
  /** The size of the body that is accepted, in bytes. */
  maxBytes?: number
}

/** A schema of the body of a call. */
interface BodySchema<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } }
}

/** The type of the body that a schema reads. */
type BodyOf<S> = S extends BodySchema<infer T> ? T : never

/**
 * Reads the body of a call and validates it.
 *
 * A body that is too large is a `413`, a body that is not JSON or that
 * does not match the schema is a `400`: the database is not touched
 * before the body is understood.
 *
 * A call accepts **one** shape or another: the body of one principal and
 * the body of a batch of principals, for instance. The schemas are tried
 * in the order they are given, and the problems of the first one are
 * the ones of the refusal: it is the shape of the documentation.
 */
export async function readBody<S1 extends BodySchema<unknown>>(
  context: Context<AccessEnv>,
  first: S1,
  options?: BodyOptions
): Promise<BodyOf<S1>>
export async function readBody<S1 extends BodySchema<unknown>, S2 extends BodySchema<unknown>>(
  context: Context<AccessEnv>,
  first: S1,
  second: S2,
  options?: BodyOptions
): Promise<BodyOf<S1> | BodyOf<S2>>
export async function readBody(context: Context<AccessEnv>, ...rest: unknown[]): Promise<unknown> {
  const schemas = rest.filter(
    (
      entry
    ): entry is {
      safeParse: (value: unknown) => {
        success: boolean
        data?: unknown
        error?: { issues: unknown[] }
      }
    } => typeof entry === 'object' && entry !== null && 'safeParse' in entry
  )
  const options = rest.find(
    (entry): entry is BodyOptions =>
      typeof entry === 'object' && entry !== null && 'maxBytes' in entry
  )
  const maxBytes = options?.maxBytes ?? MAX_BODY_BYTES
  const declared = Number(context.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError()
  }
  const raw = await context.req.text()
  if (raw.length > maxBytes) {
    throw new BodyTooLargeError()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AdministrationError('invalid_request', 'the body is not json')
  }
  for (const schema of schemas) {
    const result = schema.safeParse(parsed)
    if (result.success && result.data !== undefined) return result.data
  }
  const first = schemas[0]
  const issues = (first?.safeParse(parsed).error?.issues ?? []) as {
    path?: unknown[]
    message?: string
  }[]
  const issue = issues[0]
  const field = Array.isArray(issue?.path) && issue.path.length > 0 ? issue.path.join('.') : 'body'
  throw new AdministrationError(
    'invalid_request',
    `${field}: ${issue?.message ?? 'the body is not valid'}`
  )
}

/** The refusal of a body that is too large. */
class BodyTooLargeError extends Error {
  constructor() {
    super('the body is too large')
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Authenticates the call and answers the scope of the credential.
 *
 * The address of the caller is the key of the limiter: it is the address
 * of the socket, not the one of a header the caller controls.
 *
 * The scope is what the credential allows: the tenant it may act for and
 * the operator it is (spec §10.1).
 */
export async function authenticate(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<AdminScope> {
  const address = dependencies.peerAddress(context.req.raw)
  try {
    return await dependencies.administration.authenticate(
      context.req.header('authorization'),
      address
    )
  } catch (error) {
    if (error instanceof AdministrationError) {
      dependencies.logger.warn('the administrative call was refused', {
        endpoint: context.req.path,
        address,
        code: error.code,
      })
      throw error
    }
    // The count of the failed authentications is held by the shared store
    // of the deployment: a store that is down is a call that cannot be
    // authenticated, and the answer says so (spec §10.1).
    dependencies.logger.error('the administrative call could not be authenticated', {
      endpoint: context.req.path,
      address,
      error,
    })
    throw new AdministrationError(
      'service_unavailable',
      'the count of the failed authentications could not be read'
    )
  }
}

/** Turns a failure of the domain into the answer of the protocol. */
export function failure(error: unknown): Response {
  if (error instanceof AdministrationError) {
    const headers: Record<string, string> = {}
    if (error.retryAfterMs !== undefined) {
      headers['retry-after'] = String(Math.max(1, Math.ceil(error.retryAfterMs / 1000)))
    }
    return new Response(JSON.stringify({ error: error.code, message: error.message }), {
      status: error.status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }
  if (error instanceof BodyTooLargeError) {
    return jsonError(413, 'invalid_request', 'the body is too large')
  }
  throw error
}

/**
 * The facts of the call that the domain cannot know.
 *
 * The operator is the name of the credential when it carries one, and
 * the fingerprint of the credential when it does not: two operators that
 * hold two credentials are two operators in the audit, and the
 * credential itself is never written.
 */
export function auditContext(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies,
  scope: AdminScope
): AuditContext {
  return {
    operator: scope.operator ?? operatorOf(context),
    address: dependencies.peerAddress(context.req.raw),
    requestId: context.get('requestId'),
  }
}

/**
 * The answer of a change, with the audit of the change.
 *
 * The row of the audit is written by the statement that changed the
 * thing: the change and its audit are committed together, or neither is
 * (spec §10.1). What is left to the application is the log of the call.
 */
export async function answer(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies,
  scope: AdminScope,
  endpoint: string,
  status: number,
  body: unknown,
  audit?: AuditEntry
): Promise<Response> {
  const address = dependencies.peerAddress(context.req.raw)
  dependencies.logger.info('the administrative call', {
    endpoint,
    status,
    address,
    // The operator of the call: the name of the credential when it
    // carries one, and the fingerprint of the credential when it does
    // not.
    operator: scope.operator ?? operatorOf(context),
    ...(audit?.action ? { action: audit.action } : {}),
    ...(audit?.id ? { id: audit.id } : {}),
    ...(audit?.tenant ? { tenant: audit.tenant } : {}),
  })
  return context.json(body, status as 200)
}

/**
 * The fingerprint of the credential of the operator.
 *
 * The audit names the operator by the fingerprint of the token that made
 * the call: two operators that hold two tokens are two operators in the
 * audit, and the token itself is never written.
 */
function operatorOf(context: Context<AccessEnv>): string | null {
  const header = context.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const presented = match?.[1]?.trim()
  return presented ? fingerprint(presented) : null
}
