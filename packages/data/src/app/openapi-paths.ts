/**
 * The paths of the description of the API (spec §12).
 *
 * The module holds the paths of the contract and the parameters and the
 * responses they use. The document itself is in openapi.ts.
 */

/** The parameter of the workspace. */
export function workspaceParameter(): Record<string, unknown> {
  return {
    name: 'workspaceId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }
}

/** The parameter of a collection. */
export function collectionParameter(): Record<string, unknown> {
  return {
    name: 'collection',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }
}

/** The parameter of a record. */
export function idParameter(): Record<string, unknown> {
  return {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }
}

/** The parameter of a field. */
export function fieldParameter(): Record<string, unknown> {
  return {
    name: 'field',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }
}

/** A parameter of a query. */
export function queryParameter(
  name: string,
  description: string,
  type: string
): Record<string, unknown> {
  return { name, in: 'query', required: false, description, schema: { type } }
}

/** A response with a json body. */
export function jsonResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object' } } },
  }
}

/** A response with a json body of a known shape. */
export function shapedResponse(
  description: string,
  schema: Record<string, unknown>
): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema } },
  }
}

/** A response with an error envelope. */
export function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Error' } },
    },
  }
}

/** The paths of the API. */
export function apiPaths(): Record<string, unknown> {
  return {
    '/healthz': {
      get: {
        summary: 'The health of the service.',
        description:
          'It says that the process answers. It calls no dependency, and it answers as long as the process is alive.',
        responses: {
          200: shapedResponse('The service is alive.', {
            type: 'object',
            required: ['status', 'service', 'version'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              service: { type: 'string', description: 'The name of the role of the service.' },
              version: { type: 'string', description: 'The version of the release.' },
              schemaVersion: { type: 'string', description: 'The version of the manifest.' },
            },
          }),
        },
      },
    },
    '/readyz': {
      get: {
        summary: 'The readiness of the service.',
        description:
          'It says that the service accepts new work. A service that drains answers `draining` before it stops admitting requests.',
        responses: {
          200: shapedResponse('The service is ready.', {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['ready'] },
            },
          }),
          503: shapedResponse('The service is not ready.', {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['draining', 'not-ready'] },
              reason: { type: 'string', description: 'Why the service is not ready.' },
            },
          }),
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'The metrics of the service.',
        description:
          'The text of Prometheus. It answers only when a token is configured, and the token is a bearer token.',
        responses: {
          200: { description: 'The metrics of the service.' },
          401: errorResponse('The token of the metrics is missing or wrong.'),
          404: errorResponse('The metrics are disabled.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/me': {
      get: {
        summary: 'The identity of the caller in the workspace.',
        parameters: [workspaceParameter()],
        responses: {
          200: jsonResponse('The principal, the tenant and the workspace.'),
          401: errorResponse('The request could not be authenticated.'),
          403: errorResponse('The principal has no access to the workspace.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/schema': {
      get: {
        summary: 'The metadata of the collections the caller may use.',
        parameters: [workspaceParameter()],
        responses: {
          200: jsonResponse('The authorized metadata.'),
          401: errorResponse('The request could not be authenticated.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/schema/{collection}': {
      get: {
        summary: 'The metadata of one collection.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          200: jsonResponse('The authorized metadata of the collection.'),
          404: errorResponse('The collection is not visible.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/aggregate/{collection}': {
      get: {
        summary: 'The groups of an aggregate.',
        description:
          'The aggregate reads the rows that a list would read: the same scope, the same predicates of the policies and the same filter. The number of the groups is bounded, and the answer says when the groups of the answer are not all of them.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          queryParameter('group_by', 'Up to three fields the rows are grouped by.', 'string'),
          queryParameter(
            'metrics',
            'The metrics of the groups: `sum:amount`, `avg:amount`, `min:amount`, `max:amount`.',
            'string'
          ),
          queryParameter('filter', 'A url encoded json filter.', 'string'),
          queryParameter(
            'search',
            'The text of the search of the collection, over the fields the deployment declares searchable.',
            'string'
          ),
          queryParameter('limit', 'The maximum number of the groups, at most 1000.', 'integer'),
        ],
        responses: {
          200: jsonResponse('The groups and their meta.'),
          400: errorResponse('The query is not valid.'),
          403: errorResponse('The caller may not read the collection.'),
          404: errorResponse('The collection does not exist.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/items/{collection}': {
      get: {
        summary: 'A bounded, permission aware list.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          queryParameter('fields', 'Comma separated field names.', 'string'),
          queryParameter('filter', 'A url encoded json filter.', 'string'),
          queryParameter(
            'search',
            'The text of the search of the collection, over the fields the deployment declares searchable.',
            'string'
          ),
          queryParameter('sort', 'Up to three fields, `-` for descending.', 'string'),
          queryParameter('limit', 'The size of the page, at most 200.', 'integer'),
          queryParameter('cursor', 'The cursor of the next page.', 'string'),
          queryParameter('include', 'Comma separated relation names.', 'string'),
          queryParameter('include_count', 'Whether the count is returned.', 'boolean'),
        ],
        responses: {
          200: jsonResponse('The page and its meta.'),
          400: errorResponse('The query is not valid.'),
          403: errorResponse('The caller may not read the collection.'),
        },
      },
      post: {
        summary: 'Creates one record.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 128 },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          201: jsonResponse('The receipt of the creation.'),
          409: errorResponse('The key was used with another body, or the operation is running.'),
          422: errorResponse('The body holds invalid values.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/items/{collection}/{id}': {
      get: {
        summary: 'One record and its validator.',
        parameters: [workspaceParameter(), collectionParameter(), idParameter()],
        responses: {
          200: {
            description: 'The canonical representation of the record.',
            headers: { ETag: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          404: errorResponse('The record does not exist or is not readable.'),
        },
      },
      patch: {
        summary: 'Updates one record.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          idParameter(),
          {
            name: 'If-Match',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'The strong validator of the current representation.',
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          200: {
            description: 'The new canonical representation of the record.',
            headers: { ETag: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          400: errorResponse('The validator is not valid.'),
          404: errorResponse('The record does not exist or is not readable.'),
          412: errorResponse('The record changed since the validator was issued.'),
          428: errorResponse('The validator is required.'),
          422: errorResponse('The body holds invalid values.'),
        },
      },
      delete: {
        summary: 'Deletes one record.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          idParameter(),
          {
            name: 'If-Match',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          204: { description: 'The record was deleted.' },
          400: errorResponse('The validator is not valid.'),
          404: errorResponse('The record does not exist or is not readable.'),
          412: errorResponse('The record changed since the validator was issued.'),
          428: errorResponse('The validator is required.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/items/{collection}/{id}/versions': {
      get: {
        summary: 'The history of the versions of a record.',
        description:
          'The list holds the versions that are not the current one: the current version of a record is the record itself. A record that was deleted holds its tombstone, the image of its last version with the operation `delete`. The versions that the caller may not read are not in the list.',
        parameters: [workspaceParameter(), collectionParameter(), idParameter()],
        responses: {
          200: jsonResponse('The versions of the record and their meta.'),
          403: errorResponse('The caller may not read the collection.'),
          404: errorResponse('The record does not exist, or the collection keeps no history.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/items/{collection}/{id}/versions/{version}': {
      get: {
        summary: 'One version of a record.',
        description:
          'The version is read with the policies of the deployment: a version that the caller may not read answers `404`, and the fields that the policies do not grant are not in the answer.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          idParameter(),
          {
            name: 'version',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: 'The canonical representation of the version.',
            headers: { ETag: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          404: errorResponse('The version does not exist or is not readable.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/items/{collection}/{id}/rollback': {
      post: {
        summary: 'Rolls a record back to one of its versions.',
        description:
          'The rollback is a write and not a privileged command: the version is read with the policies of the deployment and the write that restores it is authorized by the same policies as any other update. The version of the record never moves back: the record holds the version that follows the one it had.',
        parameters: [
          workspaceParameter(),
          collectionParameter(),
          idParameter(),
          {
            name: 'If-Match',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description:
              'The strong validator of the current state of the record: the validator of the record, or the one of its tombstone when the record was deleted.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['version'],
                properties: { version: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'The new canonical representation of the record.',
            headers: { ETag: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          400: errorResponse('The validator is not valid, or the body holds no version.'),
          403: errorResponse('The policies of the deployment forbid the write.'),
          404: errorResponse('The version does not exist or is not readable.'),
          409: errorResponse('The record already holds that version.'),
          412: errorResponse('The record changed since the validator was issued.'),
          428: errorResponse('The validator is required.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/audit': {
      get: {
        summary: 'The audit metadata of the workspace.',
        parameters: [
          workspaceParameter(),
          queryParameter('limit', 'The size of the page.', 'integer'),
          queryParameter('cursor', 'The cursor of the next page.', 'string'),
        ],
        responses: {
          200: jsonResponse('The page of the audit log.'),
          403: errorResponse('The caller does not hold the audit permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model': {
      get: {
        summary: 'The model of the workspace.',
        description:
          'The model of a workspace is the logical shape of its collections: the labels, the constraints, the relations and the fields that the workspace added to the collections of the deployment. The model is applied to the manifest of the deployment when the catalog of the workspace is resolved, and a change of the model is a change of the schema of the workspace for every request that follows it.',
        parameters: [workspaceParameter()],
        responses: {
          200: jsonResponse('The model of the workspace.'),
          401: errorResponse('The request could not be authenticated.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections': {
      post: {
        summary: 'The registration of a collection of the deployment.',
        description:
          'A collection of the model is a collection of the deployment that the workspace uses: the registration names the collection of the deployment, and the workspace may change the fields of it.',
        parameters: [workspaceParameter()],
        responses: {
          201: jsonResponse('The collection is registered.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections/{collection}': {
      patch: {
        summary: 'The label and the description of a collection of the model.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          200: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
          409: errorResponse('The model changed since it was read.'),
        },
      },
      delete: {
        summary: 'A collection that the model does not hold.',
        description:
          'The collection of the deployment is not removed: the workspace stops using it, and the records it holds are left as they are.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          200: jsonResponse('The collection is not used by the workspace any more.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections/{collection}/fields': {
      post: {
        summary: 'A field of the model of a collection.',
        description:
          'A field of the model is a column of the table of the collection: the deployment holds the tables, and a field that names no column is refused.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          201: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections/{collection}/fields/{field}': {
      patch: {
        summary: 'The attributes of a field of the model.',
        parameters: [workspaceParameter(), collectionParameter(), fieldParameter()],
        responses: {
          200: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
      delete: {
        summary: 'A field that the model does not hold.',
        parameters: [workspaceParameter(), collectionParameter(), fieldParameter()],
        responses: {
          200: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections/{collection}/fields/{field}/move': {
      post: {
        summary: 'The place of a field of the model.',
        description:
          'A field moves up or down in the order of the fields of its collection: the order is the order the records are shown in.',
        parameters: [workspaceParameter(), collectionParameter(), fieldParameter()],
        responses: {
          200: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections/{collection}/relations': {
      post: {
        summary: 'A relation of the model of a collection.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          201: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/model/collections/{collection}/relations/{relation}': {
      patch: {
        summary: 'The attributes of a relation of the model.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          200: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
      delete: {
        summary: 'A relation that the model does not hold.',
        parameters: [workspaceParameter(), collectionParameter()],
        responses: {
          200: jsonResponse('The version of the model.'),
          403: errorResponse('The caller does not hold the model permission.'),
        },
      },
    },
    '/ws/{workspaceId}/v1/openapi.json': {
      get: {
        summary: 'This document.',
        parameters: [workspaceParameter()],
        responses: { 200: jsonResponse('The description of the API.') },
      },
    },
  }
}
