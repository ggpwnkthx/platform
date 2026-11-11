/**
 * The catalog of the providers of the platform (spec §5.4.3).
 *
 * The catalog is a description of the platform: it names the providers
 * it supports out of the box, and it says how the client of Access is
 * registered at each of them. It holds no secret and no row of a
 * tenant, and every caller may read it.
 */

import type { Context } from 'hono'
import { CATALOG } from '../domains/administration'
import type { AccessDependencies } from './dependencies'
import type { AccessEnv } from './state'

/** `GET /v1/catalog`: the providers the platform supports out of the box. */
export async function catalogHandler(
  _context: Context<AccessEnv>,
  _dependencies: AccessDependencies
): Promise<Response> {
  return Response.json({
    providers: CATALOG.map((entry) => ({
      key: entry.key,
      displayName: entry.displayName,
      slug: entry.slug,
      issuer: entry.issuer,
      scopes: entry.scopes,
      algorithms: entry.algorithms,
      steps: entry.steps,
    })),
  })
}
