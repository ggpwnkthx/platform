import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { documentedOf, nameOf, normalize, problemsOf, routesOf } from '../tooling/api'
import { probeProblemsOf, type ProbeDescription } from '../tooling/probes'

/**
 * The surface of the API of the services.
 *
 * A service serves the paths of its contract, and its documentation
 * names them. The check refuses the two when they part company, and
 * these tests prove that it reads the two sides: a check that never
 * fails is not a check.
 */

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

describe('the routes of the code', () => {
  test('a route is a method and a path', () => {
    const routes = routesOf(["app.get('/healthz', handler)"])
    expect(routes.map(nameOf)).toEqual(['GET /healthz'])
  })

  test('a route that is registered on many lines is a route', () => {
    const routes = routesOf(["app.post(\n  '/v1/admin/tenants',\n  handler\n)"])
    expect(routes.map(nameOf)).toEqual(['POST /v1/admin/tenants'])
  })

  test('a route of the scope of a workspace carries the prefix of the scope', () => {
    const routes = routesOf([`app.get(\`\${scope}/items/:collection\`, handler)`], {
      scope: { name: 'scope', prefix: '/ws/:workspaceId/v1' },
    })
    expect(routes.map(nameOf)).toEqual(['GET /ws/:workspaceId/v1/items/:collection'])
  })

  test('a route that is named by a constant carries the path of the constant', () => {
    const routes = routesOf(['app.get(GATEWAY_ENDPOINTS.health, handler)'], {
      constants: { 'GATEWAY_ENDPOINTS.health': '/healthz' },
    })
    expect(routes.map(nameOf)).toEqual(['GET /healthz'])
  })
})

describe('the endpoints of the documentation', () => {
  test('a heading names an endpoint', () => {
    expect(documentedOf('### `GET /oauth/authorize`\n').map(nameOf)).toEqual([
      'GET /oauth/authorize',
    ])
  })

  test('a row of a table names an endpoint', () => {
    expect(documentedOf('| `GET /healthz` | `200` |\n').map(nameOf)).toEqual(['GET /healthz'])
  })

  test('a row that holds the paths and the methods names every endpoint', () => {
    const endpoints = documentedOf(
      '| `/ws/{id}/v1/items/{key}` | `GET`, `POST` | A page of records. |\n'
    )
    expect(endpoints.map(nameOf)).toEqual([
      'GET /ws/{id}/v1/items/{key}',
      'POST /ws/{id}/v1/items/{key}',
    ])
  })

  test('a row that holds nothing but prose names no endpoint', () => {
    expect(documentedOf('| The probes | They answer the state. |\n')).toEqual([])
  })
})

describe('the two sides of the surface', () => {
  test('a parameter of a path is the same parameter on both sides', () => {
    expect(normalize('/ws/{workspaceId}/v1/items/{collection}')).toBe(
      '/ws/:workspaceId/v1/items/:collection'
    )
  })

  test('a route that the documentation does not name is a problem', () => {
    const problems = problemsOf('Data', [{ method: 'GET', path: '/healthz' }], [])
    expect(problems).toEqual(['Data serves GET /healthz, and its documentation does not name it'])
  })

  test('an endpoint the documentation names and the service does not serve is a problem', () => {
    const problems = problemsOf('Data', [], [{ method: 'GET', path: '/healthz' }])
    expect(problems).toEqual([
      'the documentation of Data names GET /healthz, and the service does not serve it',
    ])
  })

  test('the two sides that share their endpoints have no problem', () => {
    expect(
      problemsOf(
        'Data',
        [{ method: 'GET', path: '/ws/:workspaceId/v1/me' }],
        [{ method: 'GET', path: '/ws/{workspaceId}/v1/me' }]
      )
    ).toEqual([])
  })
})

describe('the probes of the services', () => {
  test('the probes of two surfaces that agree have no problem', () => {
    const descriptions = [
      { name: 'the gateway', ...probes() },
      { name: 'Access', ...probes() },
    ]
    expect(probeProblemsOf(descriptions)).toEqual([])
  })

  test('a vocabulary of the status that is not the same is a problem', () => {
    const descriptions = [
      { name: 'the gateway', ...probes() },
      {
        name: 'Access',
        ...probes(),
        refused: {
          type: 'object',
          required: ['status'],
          properties: { status: { enum: ['draining', 'not_ready'] } },
        },
      },
    ]
    expect(probeProblemsOf(descriptions)).toHaveLength(2)
  })

  test('a health that does not carry the version is a problem', () => {
    const descriptions = [
      { name: 'the gateway', ...probes() },
      {
        name: 'Access',
        ...probes(),
        health: {
          type: 'object',
          required: ['status', 'service'],
          properties: { status: { enum: ['ok'] } },
        },
      },
    ]
    expect(probeProblemsOf(descriptions)).toEqual([
      'the health of Access does not carry version, and the health of every service carries it',
    ])
  })

  test('the three services describe their probes the same way', async () => {
    // The alignment of the platform, proved on the documents of the
    // services themselves.
    const { openapiDocument: access } = await import('../packages/access/src/app/openapi')
    const { controlDocument, gatewayDocument } = await import('../packages/gateway/src/app/openapi')
    const { openapiDocument: data } = await import('../packages/data/src/app/openapi')
    const documents = [
      access('1.0.0'),
      gatewayDocument('1.0.0'),
      controlDocument('1.0.0'),
      data('1', '1.0.0'),
    ]
    expect(probeProblemsOf(documents.map((document) => probeOf(document)))).toEqual([])
  })
})

describe('the surface of the services of the platform', () => {
  test('every service serves the endpoints its documentation names', async () => {
    // The check itself, run on the repository: the services and their
    // documentation share their endpoints.
    const access = await readFile(join(root, 'packages/access/src/app/app.ts'), 'utf8')
    const document = await readFile(join(root, 'docs/access/api.md'), 'utf8')
    expect(problemsOf('Access', routesOf([access]), documentedOf(document))).toEqual([])
  })

  test('Data publishes the endpoints it serves', async () => {
    const { openapiDocument } = await import('../packages/data/src/app/openapi')
    const document = openapiDocument('1', '1.0.0') as {
      paths: Record<string, Record<string, unknown>>
    }
    const described = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({ method: method.toUpperCase(), path }))
    )
    const routes = routesOf(
      [
        await readFile(join(root, 'packages/data/src/app/routes.ts'), 'utf8'),
        await readFile(join(root, 'packages/data/src/app/app.ts'), 'utf8'),
      ],
      { scope: { name: 'scope', prefix: '/ws/:workspaceId/v1' } }
    )
    expect(problemsOf('Data', routes, described)).toEqual([])
  })

  test('Access publishes the endpoints it serves', async () => {
    const { openapiDocument } = await import('../packages/access/src/app/openapi')
    const document = openapiDocument('1.0.0') as {
      paths: Record<string, Record<string, unknown>>
    }
    const described = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({ method: method.toUpperCase(), path }))
    )
    const routes = routesOf([await readFile(join(root, 'packages/access/src/app/app.ts'), 'utf8')])
    expect(problemsOf('Access', routes, described)).toEqual([])
  })

  test('the gateway publishes the endpoints it serves', async () => {
    const { controlDocument, gatewayDocument } = await import('../packages/gateway/src/app/openapi')
    const schema = await readFile(
      join(root, 'packages/gateway/src/domains/configuration/schema.ts'),
      'utf8'
    )
    const constants: Record<string, string> = {}
    for (const match of schema.matchAll(/(\w+):\s*'([^']+)'/g)) {
      constants[`GATEWAY_ENDPOINTS.${match[1]}`] = match[2]!
    }
    const describedOf = (document: unknown): { method: string; path: string }[] => {
      const paths = (document as { paths: Record<string, Record<string, unknown>> }).paths
      return Object.entries(paths).flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => ({ method: method.toUpperCase(), path }))
      )
    }
    const gateway = routesOf(
      [await readFile(join(root, 'packages/gateway/src/app/app.ts'), 'utf8')],
      { constants }
    )
    expect(problemsOf('the gateway', gateway, describedOf(gatewayDocument('1.0.0')))).toEqual([])
    const control = routesOf(
      [await readFile(join(root, 'packages/gateway/src/app/control.ts'), 'utf8')],
      { constants }
    )
    expect(problemsOf('the control plane', control, describedOf(controlDocument('1.0.0')))).toEqual(
      []
    )
  })
})

/** The probes of a surface, as the platform describes them. */
function probes(): Omit<ProbeDescription, 'name'> {
  return {
    health: {
      type: 'object',
      required: ['status', 'service', 'version'],
      properties: { status: { enum: ['ok'] } },
    },
    ready: {
      type: 'object',
      required: ['status'],
      properties: { status: { enum: ['ready'] } },
    },
    refused: {
      type: 'object',
      required: ['status'],
      properties: { status: { enum: ['draining', 'not-ready'] } },
    },
  }
}

/** The description of the probes of a document. */
function probeOf(document: unknown): ProbeDescription {
  const paths = (document as { paths: Record<string, Record<string, unknown>> }).paths
  const responses = (path: string): Record<string, unknown> =>
    ((paths[path]?.get as { responses?: Record<string, unknown> })?.responses ?? {}) as Record<
      string,
      unknown
    >
  const schema = (response: unknown): Record<string, unknown> =>
    ((response as { content?: Record<string, { schema?: Record<string, unknown> }> })?.content?.[
      'application/json'
    ]?.schema ?? {}) as Record<string, unknown>
  return {
    name: 'a surface',
    health: schema(responses('/healthz')['200']),
    ready: schema(responses('/readyz')['200']),
    refused: schema(responses('/readyz')['503']),
  }
}
