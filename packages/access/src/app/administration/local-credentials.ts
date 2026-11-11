/**
 * The administrative endpoints of the credentials (spec §10.17).
 *
 * The handlers are thin: they read the body, they ask the administration
 * domain and they write the answer. The rules live in the domain.
 *
 * The answer never carries the verifier of a password, and it never
 * carries the password either.
 */

import type { Context } from 'hono'
import { AdministrationError, CredentialBody, type Credential } from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, auditContext, authenticate, failure, readBody } from './support'

/** The credential of an answer. The verifier of the password is not one of its fields. */
function credentialBody(credential: Credential): Record<string, unknown> {
  return {
    id: credential.id,
    tenant: credential.tenant,
    provider: credential.provider,
    email: credential.email,
    status: credential.status,
    failedAttempts: credential.failedAttempts,
    lockedUntil: credential.lockedUntil?.toISOString() ?? null,
    passwordChangedAt: credential.passwordChangedAt.toISOString(),
    createdAt: credential.createdAt.toISOString(),
  }
}

/** `GET /v1/admin/credentials`: the list of the credentials. */
export async function credentialsHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/credentials'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listCredentials(scope, {
      tenant: query.tenant ?? null,
      provider: query.provider ?? null,
      email: query.email ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      credentials: page.credentials.map(credentialBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}

/**
 * `POST /v1/admin/credentials`: the credential of a local provider.
 *
 * The call is an upsert on the pair `(tenant, provider, email)`: the
 * operator changes the password of an account by calling it again.
 */
export async function credentialHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/credentials'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, CredentialBody)
    const result = await dependencies.administration.upsertCredential(
      scope,
      {
        tenant: body.tenant,
        provider: body.provider,
        email: body.email,
        password: body.password,
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
      { credential: credentialBody(result.credential) },
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/**
 * `DELETE /v1/admin/credentials/{id}`: removes a credential.
 *
 * The principal the credential created stays: it cannot be signed in
 * with any more, and the operator revokes its rights.
 */
export async function removeCredentialHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/credentials'
  try {
    const scope = await authenticate(context, dependencies)
    const id = context.req.param('id')
    // An id that is not an id names no credential: the answer is the same
    // as the one of an id that does not exist.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AdministrationError('not_found', 'the credential does not exist')
    }
    const audit = await dependencies.administration.removeCredential(
      scope,
      id,
      auditContext(context, dependencies, scope)
    )
    dependencies.logger.info('the administrative call', {
      endpoint,
      status: 204,
      address: dependencies.callerAddress(context.req.raw),
      action: audit.action,
      id: audit.id,
      ...(audit.tenant ? { tenant: audit.tenant } : {}),
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    return failure(error)
  }
}
