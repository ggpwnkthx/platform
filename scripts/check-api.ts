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
 * they part company. The data service publishes a description of its
 * API as well: the check reads it, and it refuses it when it does not
 * hold every route of the service.
 *
 *   bun run scripts/check-api.ts
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openapiDocument } from '../packages/data/src/app/openapi'
import { documentedOf, problemsOf, routesOf, type Endpoint } from '../tooling/api'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** A service of the platform, and the surface of its API. */
interface Service {
  /** The name of the service. */
  readonly name: string
  /** The files of the code that register the routes. */
  readonly code: readonly string[]
  /** The document that names the endpoints. */
  readonly document: string
  /** The prefix of the paths of the scope of a workspace. */
  readonly scope?: { readonly name: string; readonly prefix: string }
  /** The endpoints the service names in constants. */
  readonly constants?: { readonly file: string; readonly name: string }
  /** Whether the service publishes a description of its API. */
  readonly openapi?: boolean
}

/** The services of the platform, and the surface of their API. */
const SERVICES: readonly Service[] = [
  {
    name: 'access service',
    code: ['packages/access/src/app/app.ts'],
    document: 'docs/access/api.md',
  },
  {
    name: 'data service',
    code: ['packages/data/src/app/app.ts', 'packages/data/src/app/routes.ts'],
    document: 'docs/data/api.md',
    scope: { name: 'scope', prefix: '/ws/:workspaceId/v1' },
    openapi: true,
  },
  {
    name: 'gateway',
    code: ['packages/gateway/src/app/app.ts', 'packages/gateway/src/app/control.ts'],
    document: 'docs/gateway/spec.md',
    constants: {
      file: 'packages/gateway/src/domains/configuration/schema.ts',
      name: 'GATEWAY_ENDPOINTS',
    },
  },
]

/** The endpoints of the description of the API of the data service. */
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
  for (const service of SERVICES) {
    const sources = await Promise.all(
      service.code.map((path) => readFile(join(root, path), 'utf8'))
    )
    const constants = await constantsOf(service)
    const code = routesOf(sources, {
      ...(service.scope ? { scope: service.scope } : {}),
      ...(constants ? { constants } : {}),
    })
    const document = documentedOf(await readFile(join(root, service.document), 'utf8'))
    problems.push(...problemsOf(service.name, code, document))
    if (!service.openapi) continue
    // The description of the API holds the paths of the scope of a
    // workspace: the probes of the deployment are not behind the
    // gateway, and they are not in it.
    const scoped = service.scope
      ? code.filter((endpoint) => endpoint.path.startsWith(service.scope!.prefix))
      : code
    const described = describedOf(openapiDocument('1', '1.0.0'))
    problems.push(...problemsOf(`description of the API of the ${service.name}`, scoped, described))
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    console.error(`${problems.length} endpoints that the code and the documentation do not share`)
    process.exit(1)
  }
  console.log(
    `the ${SERVICES.length} services serve the endpoints their documentation names, and no other`
  )
}

/** The constants the endpoints of a service are named by. */
async function constantsOf(service: Service): Promise<Record<string, string> | undefined> {
  if (!service.constants) return undefined
  const source = await readFile(join(root, service.constants.file), 'utf8')
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

if (import.meta.main) await main()
