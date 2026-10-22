/**
 * The metrics of the service (spec §5.1).
 *
 * The endpoint is only served when a token is configured, so the metrics
 * never end up on a public listener by accident.
 */

import type { Context } from 'hono'
import { sameSecret } from '../observability'
import type { AccessDependencies } from './dependencies'
import { jsonError } from './errors'
import type { AccessEnv } from './state'

/** `GET /metrics`: the metrics in the text format of Prometheus. */
export async function metricsHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const token = dependencies.metricsToken
  if (!token) {
    return jsonError(404, 'not_found', 'unknown reserved path')
  }
  const header = context.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const presented = match?.[1]?.trim() ?? ''
  if (!presented || !sameSecret(presented, token)) {
    return jsonError(401, 'unauthorized', 'a valid metrics token is required')
  }
  return new Response(await dependencies.observer.render(), {
    headers: { 'content-type': dependencies.observer.contentType },
  })
}
