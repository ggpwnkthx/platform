/**
 * The vocabulary of the services of the platform.
 *
 * The three services are named by their role — Gateway, Access and
 * Data — and the identifiers of a service carry the name of that role:
 * the prefixes of its environment, the names of its metrics and the name
 * it reports in the health endpoint and in the logs.
 *
 * The names the services carried before were the names of the
 * repositories they were published from, and those repositories are
 * gone. An identifier that carries one of them is an identifier that
 * nothing reads: a deployment that sets a variable of a retired name
 * sets a variable that no service reads, a dashboard that watches a
 * metric of a retired name watches a metric that is never published, and
 * an upstream that verifies a header of a retired name verifies nothing.
 *
 * The check does not name the names that are gone: it refuses every
 * identifier whose name is not the name of the role of its service. A
 * list of dead ends is a list that has to be kept, and one that names
 * them again.
 */

/** The role of a service of the platform. */
export type Role = 'gateway' | 'access' | 'data'

/**
 * The names the identifiers of a service carry, by role.
 *
 * The environment of a service is read with the prefix of its role, its
 * metrics are published with the name of its role, and the service
 * answers with the name of its role.
 */
export const VOCABULARY: Record<Role, { environment: string; metric: string; service: string }> = {
  gateway: { environment: 'GATEWAY_', metric: 'gateway_', service: 'gateway' },
  access: { environment: 'ACCESS_', metric: 'access_', service: 'access' },
  data: { environment: 'DATA_', metric: 'data_', service: 'data' },
}

/**
 * The variables of the platform itself, and not of a service.
 *
 * The runtime of a service reads them, and they are the same in the
 * three: they are not the vocabulary of a service.
 */
export const PLATFORM_VARIABLES: readonly string[] = ['NODE_ENV']

/** The kind of identifier a file holds. */
export type IdentifierKind = 'environment' | 'metric' | 'service'

/** A file that holds the identifiers of a service. */
export interface VocabularySource {
  /** The path of the file, relative to the root of the check. */
  readonly path: string
  /** The role of the service the file belongs to. */
  readonly role: Role
  /** The kind of identifier the file holds. */
  readonly kind: IdentifierKind
}

/**
 * The files that hold the identifiers of the services.
 *
 * They are the files that read the environment, the files that publish
 * the metrics and the files that answer with the name of the service:
 * they are the places where a name is given to something, and they are
 * the only places where a name can be given.
 */
export const VOCABULARY_SOURCES: readonly VocabularySource[] = [
  { path: 'packages/gateway/src/runtime/env/schema.ts', role: 'gateway', kind: 'environment' },
  { path: 'packages/access/src/runtime/env.ts', role: 'access', kind: 'environment' },
  { path: 'packages/data/src/runtime/config.ts', role: 'data', kind: 'environment' },
  { path: 'packages/gateway/src/observability/metrics.ts', role: 'gateway', kind: 'metric' },
  { path: 'packages/access/src/observability/metrics.ts', role: 'access', kind: 'metric' },
  { path: 'packages/data/src/observability/metrics.ts', role: 'data', kind: 'metric' },
  { path: 'packages/gateway/src/app/endpoints.ts', role: 'gateway', kind: 'service' },
  { path: 'packages/access/src/app/endpoints.ts', role: 'access', kind: 'service' },
  { path: 'packages/data/src/app/app.ts', role: 'data', kind: 'service' },
]

/** An identifier that does not carry the name of the role of its service. */
export interface VocabularyFinding {
  /** The file the identifier is in. */
  readonly file: string
  /** The line the identifier is on, counted from one. */
  readonly line: number
  /** The identifier itself. */
  readonly name: string
  /** What it should have been. */
  readonly expected: string
}

/** The pattern that finds the variables of the environment of a service. */
const ENVIRONMENT = /^\s*([A-Z][A-Z0-9_]*)\s*:/gm

/** The pattern that finds the names of the metrics of a service. */
const METRIC = /\bname: '([a-z][a-z0-9_]*)'/g

/** The pattern that finds the name a service answers with. */
const SERVICE = /\bservice: '([a-z][a-z0-9-]*)'/g

/** The pattern of a kind of identifier. */
function patternOf(kind: IdentifierKind): RegExp {
  if (kind === 'environment') return ENVIRONMENT
  if (kind === 'metric') return METRIC
  return SERVICE
}

/**
 * Reports whether an identifier carries the name of the role of a
 * service.
 *
 * The variables of the platform are the ones exception: they are the
 * same in the three services and they are not the vocabulary of one.
 */
export function carriesTheRole(kind: IdentifierKind, role: Role, name: string): boolean {
  const vocabulary = VOCABULARY[role]
  if (kind === 'environment') {
    return name.startsWith(vocabulary.environment) || PLATFORM_VARIABLES.includes(name)
  }
  if (kind === 'metric') return name.startsWith(vocabulary.metric)
  return name === vocabulary.service || name.startsWith(`${vocabulary.service}-`)
}

/**
 * Reports the identifiers of a file that do not carry the name of the
 * role of their service.
 *
 * The line is the one of the identifier: a file that names a service
 * the wrong way is reported with the line that names it, and not with
 * the file alone.
 */
export function vocabularyOf(
  path: string,
  role: Role,
  kind: IdentifierKind,
  content: string
): VocabularyFinding[] {
  const findings: VocabularyFinding[] = []
  const vocabulary = VOCABULARY[role]
  const expected =
    kind === 'environment'
      ? vocabulary.environment
      : kind === 'metric'
        ? vocabulary.metric
        : vocabulary.service
  for (const match of content.matchAll(patternOf(kind))) {
    const name = match[1]!
    if (carriesTheRole(kind, role, name)) continue
    findings.push({
      file: path,
      line: content.slice(0, match.index).split('\n').length,
      name,
      expected,
    })
  }
  return findings
}
