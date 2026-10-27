/**
 * The scope of the caller, read for the request.
 *
 * The scope is read from the contract of the access context with the
 * credential of the console, for the subject of the session, the tenant
 * of the subject and the route of the console. It is read once per
 * request, and the client of the contract keeps it until its
 * `validUntil` and never longer.
 *
 * A context that cannot be read is a scope that opens nothing: the
 * console fails closed, like the services it is a client of.
 */

import type { Context } from 'hono'
import { emptyScope, type OperatorScope, scopeOf } from '../../domains/operators'
import '../context'

/** The scope of the caller of a request. */
export async function operatorScope(c: Context): Promise<OperatorScope> {
  const known = c.var.scope
  if (known) return known
  const session = c.get('session')
  if (!session) return emptyScope('')
  const services = c.get('services')
  const tenant = session.principal.tenant
  let scope = emptyScope(tenant)
  if (services.context) {
    try {
      const tenantId = await services.tenantId(tenant)
      if (tenantId) {
        const context = await services.context.context({
          subject: session.principal.id,
          tenantId,
          workspaceId: tenant,
          routeId: services.config.routeId,
        })
        if (context.allow) scope = scopeOf(tenant, context.permissionKeys, services.credentials)
      }
    } catch (error) {
      services.log.warn('the scope of the operator could not be read', {
        requestId: c.get('requestId'),
        error: (error as Error).message,
      })
    }
  }
  c.set('scope', scope)
  return scope
}
