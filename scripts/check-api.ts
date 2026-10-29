#!/usr/bin/env bun
/**
 * The surface of the API of the services.
 *
 * A service serves the paths of its contract, and its documentation
 * names them. The two are two copies of the same fact, and prose
 * drifts: an endpoint that is added and not documented is an endpoint
 * that a client does not know about, and an endpoint that is documented
 * and not served is a promise the service does not keep.
 *
 * The check reads the routes the code of every service registers and
 * the endpoints its documentation names, and it refuses the two when
 * they part company. Each service publishes a description of its API as
 * well: the check reads it, and it refuses it when it does not hold
 * every route of the surface it describes.
 *
 * The probes of the three services are aligned: they answer the same
 * paths, with the same fields and the same vocabulary of the readiness.
 * The check refuses the descriptions when they part company too.
 *
 *   bun run scripts/check-api.ts
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openapiDocument as accessDocument } from '../packages/access/src/app/openapi'
import { controlDocument, gatewayDocument } from '../packages/gateway/src/app/openapi'
import { openapiDocument as dataDocument } from '../packages/data/src/app/openapi'
import { documentedOf, problemsOf, routesOf, type Endpoint } from '../tooling/api'
import { probeProblemsOf, type ProbeDescription } from '../tooling/probes'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** A surface of a service: the routes it serves and the document that names them. */
interface Surface {
  /** The name of the surface. */
  readonly name: string
  /** The files of the code that register the routes. */
  readonly code: readonly string[]
  /** The description of the API of the surface. */
  readonly described: Record<string, unknown>
}

/** A service of the platform, and the surface of its API. */
interface Service {
  /** The name of the service. */
  readonly name: string
  /** The surfaces of the service. */
  readonly surfaces: readonly Surface[]
  /** The document that names the endpoints of the service. */
  readonly document: string
  /** The prefix of the paths of the scope of a workspace. */
  readonly scope?: { readonly name: string; readonly prefix: string }
  /** The endpoints the service names in constants. */
  readonly constants?: { readonly file: string; readonly name: string }
}

/** The services of the platform, and the surface of their API. */
const SERVICES: readonly Service[] = [
  {
    name: 'Access',
    code: [],
    document: 'docs/access/api.md',
    surfaces: [
      {
        name: 'Access',
        code: ['packages/access/src/app/app.ts'],
        described: accessDocument('1.0.0'),
      },
    ],
  },
  {
    name: 'Data',
    code: [],
    document: 'docs/data/api.md',
    scope: { name: 'scope', prefix: '/ws/:workspaceId/v1' },
    surfaces: [
      {
        name: 'Data',
        code: ['packages/data/src/app/app.ts', 'packages/data/src/app/routes.ts'],
        described: dataDocument('1', '1.0.0'),
      },
    ],
  },
  {
    name: 'the gateway',
    code: [],
    document: 'docs/gateway/spec.md',
    constants: {
      file: 'packages/gateway/src/domains/configuration/schema.ts',
      name: 'GATEWAY_ENDPOINTS',
    },
    surfaces: [
      {
        name: 'the gateway',
        code: ['packages/gateway/src/app/app.ts'],
        described: gatewayDocument('1.0.0'),
      },
      {
        name: 'the control plane of the gateway',
        code: ['packages/gateway/src/app/control.ts'],
        described: controlDocument('1.0.0'),
      },
    ],
  },
]

/** The endpoints of a description of the API. */
function describedOf(document: unknown): Endpoint[] {
  const paths = (document as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}
  const endpoints: Endpoint[] = []
  for (const [path, methods] of Object.entries(paths)) {
    for (const method of Object.keys(methods)) {
      endpoints.push({ method: method.toUpperCase(), path })
    }
  }
  return endpoints
}

/** The main of the check. */
async function main(): Promise<void> {
  const problems: string[] = []
  const probes: ProbeDescription[] = []
  for (const service of SERVICES) {
    const constants = await constantsOf(service)
    const options = {
      ...(service.scope ? { scope: service.scope } : {}),
      ...(constants ? { constants } : {}),
    }
    // The routes of the service, and the endpoints its documentation
    // names. The two are compared as one set: the control plane of the
    // gateway answers the probes of the gateway too.
    const code = routesOf(
      await Promise.all(
        service.surfaces.flatMap((surface) => surface.code).map((path) => read(join(root, path)))
      ),
      options
    )
    const document = documentedOf(await read(join(root, service.document)))
    problems.push(...problemsOf(service.name, code, document))
    // The description of the API of each surface, against the routes
    // of that surface.
    for (const surface of service.surfaces) {
      const routes = routesOf(
        await Promise.all(surface.code.map((path) => read(join(root, path)))),
        options
      )
      problems.push(...problemsOf(surface.name, routes, describedOf(surface.described)))
      probes.push(probeOf(surface.name, surface.described))
    }
  }
  problems.push(...probeProblemsOf(probes))
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`${problems.length} endpoints that the code and the documentation do not share`)
    process.exit(1)
  }
  console.log(
    `the ${SERVICES.length} services serve the endpoints their documentation names, ` +
      'and their probes are aligned'
  )
}

/** The description of the probes of a surface. */
function probeOf(name: string, document: unknown): ProbeDescription {
  const paths = (document as { paths?: Record<string, Record<string, unknown>> }).paths ?? {}
  const health = (paths['/healthz']?.get ?? {}) as {
    responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }>
  }
  const ready = (paths['/readyz']?.get ?? {}) as {
    responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }>
  }
  return {
    name,
    health: schemaOf(health.responses?.['200']),
    ready: schemaOf(ready.responses?.['200']),
    refused: schemaOf(ready.responses?.['503']),
  }
}

/** The schema of a response of a description. */
function schemaOf(
  response: { content?: Record<string, { schema?: Record<string, unknown> }> } | undefined
): Record<string, unknown> {
  return response?.content?.['application/json']?.schema ?? {}
}

/** The constants the endpoints of a service are named by. */
async function constantsOf(service: Service): Promise<Record<string, string> | undefined> {
  if (!service.constants) return undefined
  const source = await read(join(root, service.constants.file))
  const block = new RegExp(
    `export const ${service.constants.name} = \\{([\\s\\S]*?)\\n\\} as const`
  ).exec(source)
  if (!block) {
    throw new Error(`${service.constants.name} is not in ${service.constants.file}`)
  }
  const constants: Record<string, string> = {}
  for (const match of block[1]!.matchAll(/(\w+):\s*'([^']+)'/g)) {
    constants[`${service.constants.name}.${match[1]}`] = match[2]!
  }
  return constants
}

/** Reads a file of the repository. */
async function read(path: string): Promise<string> {
  return await readFile(path, 'utf8')
}

if (import.meta.main) await main()
