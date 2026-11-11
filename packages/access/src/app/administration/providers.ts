/**
 * The administrative endpoints of the providers (spec §10.16).
 *
 * The handlers are thin: they read the body, they ask the administration
 * domain and they write the answer. The rules live in the domain.
 *
 * A provider is named by its slug inside its tenant, and the slug never
 * changes: a principal carries it (spec §6.2). The default provider of
 * a tenant is the registration of the tenant, and it is written with it
 * (§3.11): it is not administered here.
 */

import type { Context } from 'hono'
import { AdministrationError, ProviderBody, type Provider } from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, auditContext, authenticate, failure, readBody } from './support'

/** The provider of an answer. The secret of a provider is never answered. */
function providerBody(provider: Provider): Record<string, unknown> {
  return {
    id: provider.id,
    tenant: provider.tenant,
    slug: provider.slug,
    displayName: provider.displayName,
    enabled: provider.enabled,
    issuer: provider.issuer,
    idpClientId: provider.idpClientId,
    idpRedirectUri: provider.idpRedirectUri,
    idpScopes: provider.idpScopes,
    idpAlgorithms: provider.idpAlgorithms,
    createdAt: provider.createdAt.toISOString(),
  }
}

/** `GET /v1/admin/providers`: the list of the providers. */
export async function providersHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/providers'
  try {
    const scope = await authenticate(context, dependencies)
    const query = context.req.query()
    const page = await dependencies.administration.listProviders(scope, {
      tenant: query.tenant ?? null,
      slug: query.slug ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    })
    return answer(context, dependencies, scope, endpoint, 200, {
      providers: page.providers.map(providerBody),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    })
  } catch (error) {
    return failure(error)
  }
}

/**
 * `POST /v1/admin/providers`: the provider of a tenant.
 *
 * The call is an upsert on the pair `(tenant, slug)`. A slug that names
 * the default provider of the tenant is refused: that one is the
 * registration of the tenant, and it is changed with the tenant.
 */
export async function providerHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/providers'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, ProviderBody)
    const result = await dependencies.administration.upsertProvider(
      scope,
      {
        tenant: body.tenant,
        slug: body.slug,
        displayName: body.displayName,
        enabled: body.enabled,
        issuer: body.issuer,
        idpClientId: body.idpClientId,
        idpClientSecret: body.idpClientSecret,
        idpRedirectUri: body.idpRedirectUri,
        idpScopes: body.idpScopes,
        idpAlgorithms: body.idpAlgorithms,
      },
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      result.created ? 201 : 200,
      { provider: providerBody(result.provider) },
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/**
 * `DELETE /v1/admin/providers/{id}`: removes a provider of a tenant.
 *
 * The default provider of a tenant is not removed, and a provider that
 * has principals is not removed either: the principals carry its slug.
 */
export async function removeProviderHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/providers'
  try {
    const scope = await authenticate(context, dependencies)
    const id = context.req.param('id')
    // An id that is not an id names no provider: the answer is the same
    // as the one of an id that does not exist.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AdministrationError('not_found', 'the provider does not exist')
    }
    const audit = await dependencies.administration.removeProvider(
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
