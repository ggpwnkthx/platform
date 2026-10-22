/**
 * The tenants of the administration (spec §10.1).
 *
 * The handlers are thin: they read the body, they ask the
 * administration domain and they write the answer. The rules live in the
 * domain.
 */

import type { Context } from 'hono'
import { TenantBody, type Tenant } from '../../domains/administration'
import type { AccessDependencies } from '../dependencies'
import type { AccessEnv } from '../state'
import { answer, auditContext, authenticate, failure, readBody } from './support'

/** The tenant of an answer: it never carries a secret. */
function tenantBody(tenant: Tenant): Record<string, unknown> {
  return {
    id: tenant.id,
    slug: tenant.slug,
    displayName: tenant.displayName,
    issuer: tenant.issuer,
    emailDomain: tenant.emailDomain,
    clientId: tenant.clientId,
    clientRedirectUris: tenant.clientRedirectUris,
    autoProvision: tenant.autoProvision,
    sharedClient: tenant.sharedClient,
    default: tenant.isDefault,
    enabled: tenant.enabled,
    createdAt: tenant.createdAt.toISOString(),
  }
}

/** `POST /v1/admin/tenants`: the tenant of a slug is created or changed. */
export async function tenantHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/tenants'
  try {
    const scope = await authenticate(context, dependencies)
    const body = await readBody(context, TenantBody)
    const registration = {
      slug: body.slug,
      displayName: body.displayName,
      issuer: body.issuer,
      idpClientId: body.idpClientId,
      idpClientSecret: body.idpClientSecret,
      idpRedirectUri: body.idpRedirectUri ?? `${dependencies.publicUrl}/oauth/tenant/callback`,
      idpScopes: body.idpScopes ?? ['openid', 'email', 'profile'],
      idpAlgorithms: body.idpAlgorithms ?? ['RS256'],
      emailDomain: body.emailDomain ?? null,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      clientRedirectUris: body.clientRedirectUris,
      autoProvision: body.autoProvision ?? false,
      sharedClient: body.sharedClient ?? false,
      isDefault: body.default ?? false,
      enabled: body.enabled ?? true,
    }
    const result = await dependencies.administration.upsertTenant(
      scope,
      registration,
      auditContext(context, dependencies, scope)
    )
    return answer(
      context,
      dependencies,
      scope,
      endpoint,
      result.created ? 201 : 200,
      tenantBody(result.tenant),
      result.audit
    )
  } catch (error) {
    return failure(error)
  }
}

/** `GET /v1/admin/tenants`: the tenants of the platform. */
export async function tenantsHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const endpoint = '/v1/admin/tenants'
  try {
    const scope = await authenticate(context, dependencies)
    const tenants = await dependencies.administration.listTenants(scope)
    return answer(context, dependencies, scope, endpoint, 200, {
      tenants: tenants.map((tenant) => ({
        ...tenantBody(tenant),
        userCount: tenant.userCount,
        grantCount: tenant.grantCount,
      })),
    })
  } catch (error) {
    return failure(error)
  }
}
