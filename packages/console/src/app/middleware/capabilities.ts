/**
 * The capabilities of the deployment.
 *
 * The capabilities of the records are the deployment's own: the policies
 * of the deployment name them, and the operator of a tenant grants them.
 * Data publishes the collections each of them opens, and the console
 * asks it for them: the operator of a tenant reads the list where it
 * grants a right, and a caller whose collections are closed to it reads
 * the list where the page says what is missing.
 *
 * The call is a call of the tenant: the console asks with the token of
 * the caller, and a caller that holds no capability of its tenant is
 * refused. A refusal is not a failure: the console shows what it knows,
 * and the page says that it could not read the rest.
 */

import type { Context } from 'hono'
import type { DeploymentCollection } from '../../domains/data'
import { capabilitiesOf, type DeploymentCapability } from '../../domains/operators'
import { sessionOf } from './session'

/** What the console knows of the capabilities of the deployment. */
export interface DeploymentCapabilities {
  /** The capabilities of the deployment, and the collections they open. */
  readonly capabilities: readonly DeploymentCapability[]
  /** The collections of the deployment. */
  readonly collections: readonly DeploymentCollection[]
  /** Why the console could not ask, when it could not. */
  readonly unavailable: string | null
}

/** The capabilities of the deployment, and the collections they open. */
const NOTHING: DeploymentCapabilities = {
  capabilities: [],
  collections: [],
  unavailable: null,
}

/**
 * The capabilities of the deployment, as Data publishes them.
 *
 * @param c the request.
 * @param tenant the slug of the tenant the caller acts for.
 */
export async function deploymentCapabilities(
  c: Context,
  tenant: string
): Promise<DeploymentCapabilities> {
  const services = c.get('services')
  const session = sessionOf(c)
  // The answer the session keeps: the capabilities of the deployment
  // change with the deployment, and a page of the administration does
  // not wait for Data.
  const kept = session.deploymentCollections
  if (kept && kept.tenant === tenant) {
    return {
      capabilities: capabilitiesOf(kept.collections),
      collections: kept.collections,
      unavailable: null,
    }
  }
  const tenantId = await services.tenantId(tenant)
  if (!tenantId) {
    return {
      ...NOTHING,
      unavailable: 'The console could not read the identifier of your tenant.',
    }
  }
  try {
    const answer = await services.workspaces(session.accessToken).collections({
      slug: tenant,
      id: tenantId,
    })
    session.deploymentCollections = { tenant, collections: answer.collections }
    return {
      capabilities: capabilitiesOf(answer.collections),
      collections: answer.collections,
      unavailable: null,
    }
  } catch (error) {
    services.log.warn('the capabilities of the deployment could not be read', {
      requestId: c.get('requestId'),
      error: (error as Error).message,
    })
    return { ...NOTHING, unavailable: 'Data did not answer the question just now.' }
  }
}
