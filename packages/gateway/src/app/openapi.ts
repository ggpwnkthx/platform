/**
 * The description of the API of the gateway.
 *
 * The gateway has two surfaces: the one the callers reach, which
 * authenticates them and forwards their requests, and the control
 * plane, which is the management of the deployment. Each surface has
 * its description, and each one holds the paths of that surface only.
 *
 * The probes are described the way the three services describe them:
 * the same paths, the same fields and the same vocabulary of the
 * readiness. The check of the API refuses the documents when they part
 * company.
 */

import { controlPaths, gatewayPaths } from './openapi-paths'

/** The description of the API the callers reach. */
export function gatewayDocument(serviceVersion: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'The gateway',
      version: serviceVersion,
      description:
        'The application gateway of the platform. It authenticates the callers, asks the access service what they may do, and forwards their requests to the upstream of the route it matched.',
    },
    servers: [{ url: '/', description: 'The origin of the deployment.' }],
    security: [],
    paths: gatewayPaths(),
  }
}

/** The description of the API of the control plane. */
export function controlDocument(serviceVersion: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'The control plane of the gateway',
      version: serviceVersion,
      description:
        'The management of the deployment of the gateway: its configuration, its replicas, its sessions and the audit of its decisions. The control plane is internal: it is not reached by the callers.',
    },
    servers: [{ url: '/', description: 'The origin of the control plane.' }],
    security: [],
    paths: controlPaths(),
  }
}
