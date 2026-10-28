/**
 * The surface of the API of a service.
 *
 * A service serves the paths of its contract, and its documentation
 * names them. The two are two copies of the same fact, and prose
 * drifts: an endpoint that is added and not documented is an endpoint
 * that a client does not know about, and an endpoint that is documented
 * and not served is a promise the service does not keep.
 *
 * The engine reads the routes the code of a service registers and the
 * endpoints its documentation names, and it refuses the two when they
 * part company.
 */

/** An endpoint of a service. */
export interface Endpoint {
  /** The method of the endpoint: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. */
  readonly method: string
  /** The path of the endpoint. */
  readonly path: string
}

/**
 * The name of an endpoint: its method and its path.
 *
 * The name is what the report of the check reads, and what the two
 * sides of the check are compared by.
 */
export function nameOf(endpoint: Endpoint): string {
  return `${endpoint.method} ${endpoint.path}`
}

/**
 * The name a path carries in the code and in the documentation.
 *
 * The code names a parameter of a path with a colon, and the
 * documentation names it with braces. The two are the same parameter.
 */
export function normalize(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1').replace(/\/+$/, '')
}

/** The ways a service registers a route. */
export interface RouteOptions {
  /**
   * The prefix of the paths of the scope of a workspace, and the name
   * of the variable that holds it in the code.
   */
  readonly scope?: { readonly name: string; readonly prefix: string }
  /**
   * The endpoints the service names in constants, and the values of
   * those constants.
   */
  readonly constants?: Record<string, string>
}

/** The registration of a route with a path in it. */
const LITERAL = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g

/** The registration of a route with a path of the scope in it. */
const SCOPED = /app\.(get|post|put|patch|delete)\(\s*`\$\{(\w+)\}([^`]*)`/g

/** The registration of a route with a path in a constant. */
const NAMED = /app\.(get|post|put|patch|delete)\(\s*([A-Z][A-Z_]*)\.([a-zA-Z]+)/g

/**
 * The routes the code of a service registers.
 *
 * A route is registered with a path in it, with a path of the scope of
 * a workspace in it, or with the name of a constant in it.
 */
export function routesOf(sources: readonly string[], options: RouteOptions = {}): Endpoint[] {
  const endpoints: Endpoint[] = []
  for (const source of sources) {
    for (const match of source.matchAll(LITERAL)) {
      endpoints.push({ method: match[1]!.toUpperCase(), path: match[2]! })
    }
    for (const match of source.matchAll(SCOPED)) {
      const scope = options.scope
      if (!scope || scope.name !== match[2]) continue
      endpoints.push({
        method: match[1]!.toUpperCase(),
        path: `${scope.prefix}${match[3]!}`,
      })
    }
    for (const match of source.matchAll(NAMED)) {
      const value = options.constants?.[`${match[2]}.${match[3]}`]
      if (!value) continue
      endpoints.push({ method: match[1]!.toUpperCase(), path: value })
    }
  }
  return endpoints
}

/** The heading of a document that names an endpoint. */
const HEADING = /^#{2,4}\s+`?(GET|POST|PUT|PATCH|DELETE)\s+([^`\s]+)`?/gm

/**
 * The endpoints a document names.
 *
 * A document names an endpoint in a heading, or in a row of a table:
 * a row that holds the method and the path in one cell, or a row that
 * holds the paths in one cell and the methods in the next.
 */
export function documentedOf(content: string): Endpoint[] {
  const endpoints: Endpoint[] = []
  for (const match of content.matchAll(HEADING)) {
    endpoints.push({ method: match[1]!.toUpperCase(), path: match[2]! })
  }
  for (const line of content.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length < 2) continue
    const withMethod = /^`?(GET|POST|PUT|PATCH|DELETE)\s+([^`\s]+?)`?$/.exec(cells[0]!)
    if (withMethod) {
      endpoints.push({ method: withMethod[1]!.toUpperCase(), path: withMethod[2]! })
      continue
    }
    const paths = [...cells[0]!.matchAll(/`(\/[^`]+)`/g)].map((match) => match[1]!)
    const methods = [...cells[1]!.matchAll(/`(GET|POST|PUT|PATCH|DELETE)`/g)].map(
      (match) => match[1]!
    )
    if (paths.length === 0 || methods.length === 0) continue
    for (const path of paths) {
      for (const method of methods) endpoints.push({ method, path })
    }
  }
  return endpoints
}

/**
 * The problems between the routes of a service and the endpoints its
 * documentation names.
 *
 * A route that the documentation does not name is a route a client does
 * not know about, and an endpoint the documentation names and the
 * service does not serve is a promise the service does not keep.
 */
export function problemsOf(
  name: string,
  code: readonly Endpoint[],
  document: readonly Endpoint[]
): string[] {
  const served = new Set(code.map((endpoint) => `${endpoint.method} ${normalize(endpoint.path)}`))
  const named = new Set(
    document.map((endpoint) => `${endpoint.method} ${normalize(endpoint.path)}`)
  )
  const problems: string[] = []
  for (const endpoint of [...served].sort()) {
    if (!named.has(endpoint)) {
      problems.push(`the ${name} serves ${endpoint}, and its documentation does not name it`)
    }
  }
  for (const endpoint of [...named].sort()) {
    if (!served.has(endpoint)) {
      problems.push(
        `the documentation of the ${name} names ${endpoint}, and the service does not serve it`
      )
    }
  }
  return problems
}
