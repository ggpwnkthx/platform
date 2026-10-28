/**
 * The paths of the description of the API of the access service.
 *
 * The module holds the paths of the contract and the parameters and the
 * responses they use. The document itself is in openapi.ts.
 */

/** A response with a json body. */
function jsonResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: { type: 'object' },
      },
    },
  }
}

/** A response with a json body of a known shape. */
function shapedResponse(
  description: string,
  schema: Record<string, unknown>
): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  }
}

/** A response of an error of the service. */
function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }
}

/**
 * The health of the service.
 *
 * The answer is the one of the three services: the status, the name of
 * the role of the service and the version of the release.
 */
function healthPath(service: string): Record<string, unknown> {
  return {
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
            service: {
              type: 'string',
              enum: [service],
              description: 'The name of the role of the service.',
            },
            version: { type: 'string', description: 'The version of the release.' },
          },
        }),
      },
    },
  }
}

/**
 * The readiness of the service.
 *
 * The vocabulary of the status is the one of the three services:
 * `ready`, `draining` and `not-ready`.
 */
function readyPath(): Record<string, unknown> {
  return {
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
          },
        }),
      },
    },
  }
}

/** The paths of the description of the API of the access service. */
export function apiPaths(): Record<string, unknown> {
  return {
    '/healthz': healthPath('access'),
    '/readyz': readyPath(),
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
    '/openapi.json': {
      get: {
        summary: 'This document.',
        description:
          'The description of the API of the access service: the paths it serves and the shape of their answers.',
        responses: {
          200: jsonResponse('The description of the API.'),
        },
      },
    },
    '/.well-known/openid-configuration': {
      get: {
        summary: 'The discovery document of the provider of the gateway.',
        description:
          'The fields of the discovery document are in the specification of the access service.',
        responses: {
          200: jsonResponse('The discovery document.'),
        },
      },
    },
    '/oauth/authorize': {
      get: {
        summary: 'The authorization endpoint.',
        description:
          'The gateway sends the browser of a caller here. The access service authenticates the caller against the provider of the tenant.',
        parameters: [
          {
            name: 'client_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'The identifier of the client of the tenant.',
          },
          {
            name: 'redirect_uri',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'The address the provider sends the browser back to.',
          },
          {
            name: 'state',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'The state of the flow, given back to the caller.',
          },
          {
            name: 'code_challenge',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'The challenge of the proof key of the code.',
          },
        ],
        responses: {
          302: { description: 'The browser is sent to the provider of the tenant.' },
          400: errorResponse('The request is not a valid authorization request.'),
        },
      },
    },
    '/oauth/tenant/callback': {
      get: {
        summary: 'The callback of the access service at the provider of a tenant.',
        description:
          'The provider of the tenant sends the browser back here with the code of the authorization.',
        responses: {
          302: { description: 'The browser is sent to the gateway with the code.' },
          400: errorResponse('The provider did not answer a valid code.'),
        },
      },
    },
    '/oauth/token': {
      post: {
        summary: 'The exchange of the code for the tokens.',
        description:
          'The client authenticates with its secret, and the code for the tokens of the caller.',
        responses: {
          200: jsonResponse('The tokens of the caller.'),
          400: errorResponse('The grant is not valid.'),
          401: errorResponse('The client did not authenticate.'),
        },
      },
    },
    '/oauth/jwks': {
      get: {
        summary: 'The public keys of the access service.',
        description:
          'The keys are in the JWKS format. The provider of the tenant uses them to sign the identity of a request.',
        responses: {
          200: jsonResponse('The public keys of the service.'),
        },
      },
    },
    '/oauth/userinfo': {
      get: {
        summary: 'The claims of the principal of a token.',
        description:
          'The claims are the subject, the e-mail, the name and the tenant of the caller.',
        responses: {
          200: jsonResponse('The claims of the caller.'),
          401: errorResponse('The token is missing or wrong.'),
        },
      },
    },
    '/v1/decisions': {
      post: {
        summary: 'The decision of the access service.',
        description:
          'The contract the gateway already speaks: the caller, the workspace and the action, and the answer of the access service.',
        responses: {
          200: jsonResponse('The decision of the access service.'),
          400: errorResponse('The request is not a valid decision.'),
        },
      },
    },
    '/v1/access-context': {
      get: {
        summary: 'The discovery of the contract of the access context.',
        description: 'It is the readiness check of a consumer of the access context.',
        responses: {
          200: jsonResponse('The discovery of the contract.'),
        },
      },
      post: {
        summary: 'The context of a principal.',
        description:
          'The context of a principal in a workspace: the subject, the tenant, the route and the keys of its scope.',
        responses: {
          200: jsonResponse('The context of the principal.'),
          403: errorResponse('The principal holds no right on the workspace.'),
        },
      },
    },
    '/v1/admin/tenants': {
      post: {
        summary: 'The registration of a tenant.',
        description:
          'It creates a tenant, or it updates the tenant of that slug: the call is an upsert.',
        responses: {
          201: jsonResponse('The tenant is registered.'),
          403: errorResponse('The caller does not hold the administration of the platform.'),
        },
      },
      get: {
        summary: 'The list of the tenants.',
        description: 'The tenants of the platform, with their counts.',
        responses: {
          200: jsonResponse('The tenants of the platform.'),
          403: errorResponse('The caller does not hold the administration of the platform.'),
        },
      },
    },
    '/v1/admin/users': {
      post: {
        summary: 'The registration of a principal.',
        description:
          'It creates a principal, or it updates the principal of that `(tenant, user)` pair: the call is an upsert.',
        responses: {
          201: jsonResponse('The principal is registered.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
      get: {
        summary: 'The list of the principals.',
        description: 'The principals of the tenant, filtered by e-mail and by status.',
        responses: {
          200: jsonResponse('The principals of the tenant.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
    },
    '/v1/admin/groups': {
      post: {
        summary: 'The registration of a group.',
        description:
          'It creates a group, or it changes the group of that key: the call is an upsert.',
        responses: {
          201: jsonResponse('The group is registered.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
      get: {
        summary: 'The list of the groups.',
        description: 'The groups of the tenant, the newest first.',
        responses: {
          200: jsonResponse('The groups of the tenant.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
    },
    '/v1/admin/roles': {
      put: {
        summary: 'The registration of a role.',
        description:
          'It creates a role, or it changes the role of that key: the call is an upsert.',
        responses: {
          201: jsonResponse('The role is registered.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
      get: {
        summary: 'The list of the roles.',
        description: 'The roles of the tenant, the newest first.',
        responses: {
          200: jsonResponse('The roles of the tenant.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
    },
    '/v1/admin/roles/{id}': {
      delete: {
        summary: 'The removal of a role.',
        description: 'The role is ended: it is not deleted, it is stamped.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The identifier of the role.',
          },
        ],
        responses: {
          200: jsonResponse('The role is ended.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
          404: errorResponse('The tenant holds no role of that identifier.'),
        },
      },
    },
    '/v1/admin/grants': {
      put: {
        summary: 'The registration of a grant.',
        description:
          'It creates a grant, or it updates the grant of that `(tenant, user, permission, workspace)` tuple: the call is an upsert.',
        responses: {
          201: jsonResponse('The grant is registered.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
      get: {
        summary: 'The list of the grants.',
        description: 'The grants of the tenant, the live ones and the ended ones.',
        responses: {
          200: jsonResponse('The grants of the tenant.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
    },
    '/v1/admin/grants/{id}': {
      delete: {
        summary: 'The revocation of a grant.',
        description: 'The row is kept and stamped with the date of the revocation.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The identifier of the grant.',
          },
        ],
        responses: {
          200: jsonResponse('The grant is revoked.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
          404: errorResponse('The tenant holds no grant of that identifier.'),
        },
      },
    },
    '/v1/admin/audit': {
      get: {
        summary: 'The audit of the administration.',
        description:
          'The changes of the administration of the tenant, with the actor and the date of every one of them.',
        responses: {
          200: jsonResponse('The audit of the administration.'),
          403: errorResponse('The caller does not hold the administration of the tenant.'),
        },
      },
    },
  }
}
