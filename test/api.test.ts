import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { documentedOf, nameOf, normalize, problemsOf, routesOf } from '../tooling/api'

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
    const problems = problemsOf('data service', [{ method: 'GET', path: '/healthz' }], [])
    expect(problems).toEqual([
      'the data service serves GET /healthz, and its documentation does not name it',
    ])
  })

  test('an endpoint the documentation names and the service does not serve is a problem', () => {
    const problems = problemsOf('data service', [], [{ method: 'GET', path: '/healthz' }])
    expect(problems).toEqual([
      'the documentation of the data service names GET /healthz, and the service does not serve it',
    ])
  })

  test('the two sides that share their endpoints have no problem', () => {
    expect(
      problemsOf(
        'data service',
        [{ method: 'GET', path: '/ws/:workspaceId/v1/me' }],
        [{ method: 'GET', path: '/ws/{workspaceId}/v1/me' }]
      )
    ).toEqual([])
  })
})

describe('the surface of the services of the platform', () => {
  test('every service serves the endpoints its documentation names', async () => {
    // The check itself, run on the repository: the services and their
    // documentation share their endpoints.
    const access = await readFile(join(root, 'packages/access/src/app/app.ts'), 'utf8')
    const document = await readFile(join(root, 'docs/access/api.md'), 'utf8')
    expect(problemsOf('access service', routesOf([access]), documentedOf(document))).toEqual([])
  })

  test('the data service publishes the endpoints it serves', async () => {
    const { openapiDocument } = await import('../packages/data/src/app/openapi')
    const document = openapiDocument('1', '1.0.0') as {
      paths: Record<string, Record<string, unknown>>
    }
    const described = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({ method: method.toUpperCase(), path }))
    )
    const routes = routesOf(
      [await readFile(join(root, 'packages/data/src/app/routes.ts'), 'utf8')],
      { scope: { name: 'scope', prefix: '/ws/:workspaceId/v1' } }
    )
    expect(problemsOf('data service', routes, described)).toEqual([])
  })
})
