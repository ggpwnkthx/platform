/**
 * The paths of the description of the API of the gateway.
 *
 * The module holds the paths of the contract and the parameters and the
 * responses they use. The document itself is in openapi.ts.
 *
 * The gateway has two surfaces: the one the callers reach, and the
 * control plane, which is the management of the deployment. Their paths
 * do not meet, except the probes of the process.
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

/** A response of an error of the gateway. */
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
 * The health of the process.
 *
 * The answer is the one of the three services: the status, the name of
 * the role of the service and the version of the release.
 */
function healthPath(service: string): Record<string, unknown> {
  return {
    get: {
      summary: 'The health of the process.',
      description:
        'It says that the process answers. It calls no dependency, and it answers as long as the process is alive.',
      responses: {
        200: shapedResponse('The process is alive.', {
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
            uptimeMs: { type: 'number', description: 'The time the process has been alive.' },
          },
        }),
      },
    },
  }
}

/**
 * The readiness of the process.
 *
 * The vocabulary of the status is the one of the three services:
 * `ready`, `draining` and `not-ready`.
 */
function readyPath(): Record<string, unknown> {
  return {
    get: {
      summary: 'The readiness of the process.',
      description:
        'It says that the gateway accepts new work. A gateway that drains answers `draining` before it stops admitting requests.',
      responses: {
        200: shapedResponse('The gateway is ready.', {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['ready'] },
          },
        }),
        503: shapedResponse('The gateway is not ready.', {
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

/** The paths of the surface the callers reach. */
export function gatewayPaths(): Record<string, unknown> {
  return {
    '/healthz': healthPath('gateway'),
    '/readyz': readyPath(),
    '/metrics': {
      get: {
        summary: 'The metrics of the gateway.',
        description:
          'The text of Prometheus. It answers only when a token is configured, and the token is a bearer token.',
        responses: {
          200: { description: 'The metrics of the gateway.' },
          401: errorResponse('The token of the metrics is missing or wrong.'),
          404: errorResponse('The metrics are disabled.'),
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'This document.',
        description:
          'The description of the API of the gateway: the paths it serves itself and the shape of their answers.',
        responses: {
          200: jsonResponse('The description of the API.'),
        },
      },
    },
    '/auth/login': {
      get: {
        summary: 'The beginning of a sign-in.',
        description:
          'The gateway sends the browser of the caller to the provider of the tenant, and it holds the state of the flow.',
        responses: {
          302: { description: 'The browser is sent to the provider of the tenant.' },
          429: errorResponse('The limiter of the sign-ins is reached.'),
          503: errorResponse('The provider of the tenant is not reachable.'),
        },
      },
    },
    '/auth/callback': {
      get: {
        summary: 'The end of a sign-in.',
        description:
          'The provider of the tenant sends the browser back here with the code, and the gateway exchanges it for a session.',
        responses: {
          302: { description: 'The browser is sent to the console of the platform.' },
          400: errorResponse('The provider did not answer a valid code.'),
        },
      },
    },
    '/auth/logout': {
      get: {
        summary: 'The end of a session.',
        description:
          'The gateway destroys the session of the caller and answers a redirection to the origin of the request.',
        responses: {
          302: { description: 'The browser is sent to the origin of the request.' },
          403: errorResponse('The request comes from another site.'),
        },
      },
    },
  }
}

/** The paths of the control plane of the gateway. */
export function controlPaths(): Record<string, unknown> {
  return {
    '/healthz': healthPath('gateway-control'),
    '/readyz': {
      get: {
        summary: 'The readiness of the control plane.',
        description:
          'It says that the control plane accepts new work: the shared state it acts on answers.',
        responses: {
          200: shapedResponse('The control plane is ready.', {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['ready'] },
            },
          }),
          503: shapedResponse('The control plane is not ready.', {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['draining', 'not-ready'] },
            },
          }),
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'This document.',
        description:
          'The description of the API of the control plane: the paths it serves and the shape of their answers.',
        responses: {
          200: jsonResponse('The description of the API.'),
        },
      },
    },
    '/v1/config': {
      get: {
        summary: 'The configuration of the gateway.',
        description:
          'The revision that is active, the table it holds, the source of it and the warnings of the configuration.',
        responses: {
          200: jsonResponse('The active configuration.'),
          401: errorResponse('The caller does not hold the read of the configuration.'),
        },
      },
      put: {
        summary: 'The configuration of the gateway.',
        description: 'It writes the whole table of the configuration as a new revision.',
        responses: {
          200: jsonResponse('The revision that is active.'),
          401: errorResponse('The caller does not hold the write of the configuration.'),
          409: errorResponse('The configuration changed since it was read.'),
        },
      },
    },
    '/v1/config/validate': {
      post: {
        summary: 'The validation of a configuration.',
        description:
          'The errors, the conflicts, the warnings and the diff against the active table. It writes nothing.',
        responses: {
          200: jsonResponse('The configuration is valid.'),
          422: jsonResponse('The configuration is not valid.'),
        },
      },
    },
    '/v1/config/history': {
      get: {
        summary: 'The history of the revisions of the configuration.',
        description: 'The revisions of the configuration, paginated.',
        responses: {
          200: jsonResponse('The revisions of the configuration.'),
          401: errorResponse('The caller does not hold the read of the configuration.'),
        },
      },
    },
    '/v1/config/rollback': {
      post: {
        summary: 'The rollback of the configuration.',
        description: 'It writes the table of an older revision again, as a new revision.',
        responses: {
          200: jsonResponse('The revision that is active.'),
          401: errorResponse('The caller does not hold the write of the configuration.'),
          404: errorResponse('The revision does not exist.'),
        },
      },
    },
    '/v1/replicas': {
      get: {
        summary: 'The replicas of the gateway.',
        description: 'The heartbeats of the replicas of the deployment.',
        responses: {
          200: jsonResponse('The replicas of the deployment.'),
          401: errorResponse('The caller does not hold the read of the configuration.'),
        },
      },
    },
    '/v1/sessions': {
      delete: {
        summary: 'The revocation of the sessions of a subject.',
        description: 'It revokes the sessions of a subject, in every replica.',
        responses: {
          200: jsonResponse('The number of the sessions that were revoked.'),
          401: errorResponse('The caller does not hold the operation of the deployment.'),
        },
      },
    },
    '/v1/decisions': {
      delete: {
        summary: 'The purge of the decisions of a subject.',
        description: 'It purges the cached decisions of a subject and of a workspace.',
        responses: {
          200: jsonResponse('The number of the decisions that were purged.'),
          401: errorResponse('The caller does not hold the operation of the deployment.'),
        },
      },
    },
    '/v1/audit': {
      get: {
        summary: 'The audit of the gateway.',
        description: 'The trail of the decisions of the gateway, paginated.',
        responses: {
          200: jsonResponse('The trail of the decisions.'),
          401: errorResponse('The caller does not hold the read of the configuration.'),
        },
      },
    },
  }
}
