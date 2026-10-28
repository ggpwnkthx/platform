/**
 * The description of the API of the access service.
 *
 * The document describes the fixed protocol: the paths, the envelopes,
 * the headers and the errors. The details of the tenants and of their
 * principals are the state of the deployment: they are not in the
 * document, because they change with the deployment and because they
 * depend on the caller.
 *
 * The probes are described the way the three services describe them:
 * the same paths, the same fields and the same vocabulary of the
 * readiness. The check of the API refuses the documents when they part
 * company.
 */

import { apiPaths } from './openapi-paths'

/** The description of the API of the access service. */
export function openapiDocument(serviceVersion: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'The access service',
      version: serviceVersion,
      description:
        'The access service holds the tenants, their principals and their rights, and it answers the decisions of the gateway. It is the provider of the gateway.',
    },
    servers: [{ url: '/', description: 'The origin of the deployment.' }],
    security: [],
    paths: apiPaths(),
  }
}
