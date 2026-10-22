/**
 * The endpoints of the access service.
 *
 * They are the paths the service serves itself. They are matched before
 * anything else and they are never forwarded anywhere.
 */

import type { Context } from 'hono'
import type { AccessDependencies } from './dependencies'
import type { AccessEnv } from './state'

/**
 * The health of the access service.
 *
 * It is always available: it says that the process answers, not that the
 * service can serve the traffic.
 */
export function healthHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Response {
  return context.json({
    status: 'ok',
    service: 'access',
    version: dependencies.version,
  })
}

/**
 * The readiness of the access service.
 *
 * The service is ready when its dependencies answer and when it is not
 * draining: a task that cannot reach the database would reject every
 * decision.
 */
export async function readyHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  // A service that is draining does not accept new work: the readiness
  // probe takes it out of the rotation.
  if (dependencies.isDraining()) {
    return context.json({ status: 'draining' }, 503)
  }
  const ready = await dependencies.probe.ready()
  if (!ready) {
    return context.json({ status: 'not-ready' }, 503)
  }
  return context.json({ status: 'ready' })
}
