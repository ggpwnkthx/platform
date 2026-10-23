/**
 * The description of the API (spec §12).
 *
 * The document describes the fixed protocol: the paths, the envelopes, the
 * headers and the errors. The details of the collections are the runtime
 * metadata of the deployment: they are not in the document, because they
 * change with the deployment and because they depend on the caller.
 */

import { ERROR_CODES } from '../protocol/errors'
import { apiPaths } from './openapi-paths'

/** The description of the API. */
export function openapiDocument(
  schemaVersion: string,
  serviceVersion: string
): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Headless Data Backend',
      version: serviceVersion,
      'x-schema-version': schemaVersion,
      description:
        'Permission aware data APIs behind the gateway. The identity of the caller is carried by the gateway; the caller authenticates at the gateway.',
    },
    servers: [{ url: '/', description: 'The origin of the deployment.' }],
    security: [],
    paths: apiPaths(),
    components: {
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'requestId'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: {
                  type: 'string',
                  description: 'The stable, machine readable code of the error.',
                  enum: [...ERROR_CODES],
                },
                message: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['field', 'code'],
                    properties: { field: { type: 'string' }, code: { type: 'string' } },
                  },
                },
              },
            },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }
}
