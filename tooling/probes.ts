/**
 * The probes of the services of the platform.
 *
 * The gateway, the access service and the data service answer the same
 * probes, and they answer them the same way: the same paths, the same
 * fields and the same vocabulary of the readiness. A deployment reads
 * the probes of the three services with the same code, and a probe that
 * answers differently in one service is a probe the deployment cannot
 * read.
 *
 * The vocabulary of the readiness is `ready`, `draining` and
 * `not-ready`: a service that drains says so before it stops admitting
 * requests, and a service that is not ready says why.
 */

/** The description of the probes of a surface of a service. */
export interface ProbeDescription {
  /** The name of the surface. */
  readonly name: string
  /** The schema of the answer of the health. */
  readonly health: Record<string, unknown>
  /** The schema of the answer of the readiness when the service is ready. */
  readonly ready: Record<string, unknown>
  /** The schema of the answer of the readiness when the service refuses it. */
  readonly refused: Record<string, unknown>
}

/** The fields the answer of the health of every service carries. */
const HEALTH = ['status', 'service', 'version']

/** The fields the answer of the readiness of every service carries. */
const READY = ['status']

/**
 * The problems between the probes of the surfaces.
 *
 * Every surface describes the health and the readiness, every answer
 * carries the fields of the platform, and the vocabulary of the status
 * is the same in every surface.
 */
export function probeProblemsOf(descriptions: readonly ProbeDescription[]): string[] {
  const problems: string[] = []
  for (const description of descriptions) {
    for (const field of HEALTH) {
      if (!carries(description.health, field)) {
        problems.push(
          `the health of ${description.name} does not carry ${field}, and the health of every service carries it`
        )
      }
    }
    for (const field of READY) {
      if (!carries(description.ready, field)) {
        problems.push(
          `the readiness of ${description.name} does not carry ${field}, and the readiness of every service carries it`
        )
      }
      if (!carries(description.refused, field)) {
        problems.push(
          `the refusal of the readiness of ${description.name} does not carry ${field}, and the refusal of every service carries it`
        )
      }
    }
  }
  problems.push(...vocabularyProblemsOf(descriptions))
  return problems
}

/**
 * The problems between the vocabularies of the status.
 *
 * The status of the health is `ok`, and the status of the readiness is
 * `ready`, `draining` or `not-ready`. The vocabulary is the same in
 * every surface of the platform.
 */
function vocabularyProblemsOf(descriptions: readonly ProbeDescription[]): string[] {
  const problems: string[] = []
  const vocabularies = [
    { label: 'the health', values: descriptions.map((d) => statusOf(d.health)) },
    { label: 'the readiness', values: descriptions.map((d) => statusOf(d.ready)) },
    { label: 'the refusal of the readiness', values: descriptions.map((d) => statusOf(d.refused)) },
  ]
  for (const vocabulary of vocabularies) {
    const names = new Map<string, string[]>()
    vocabulary.values.forEach((values, index) => {
      const key = [...values].sort().join(',')
      const surfaces = names.get(key) ?? []
      surfaces.push(descriptions[index]!.name)
      names.set(key, surfaces)
    })
    if (names.size <= 1) continue
    for (const [key, surfaces] of names) {
      problems.push(
        `the status of ${vocabulary.label} is \`${key || 'nothing'}\` in ${surfaces.join(', ')}, ` +
          'and it is the same in every surface of the platform'
      )
    }
  }
  return problems
}

/** The values the status of an answer may carry. */
function statusOf(schema: Record<string, unknown>): string[] {
  const properties = (schema.properties ?? {}) as Record<string, { enum?: unknown }>
  const values = properties.status?.enum
  return Array.isArray(values) ? values.map((value) => String(value)) : []
}

/**
 * Reports whether a schema requires a field.
 *
 * A field of the answer of a probe is required: the answer of the
 * health of every service carries the version, and the answer of the
 * readiness of every service carries the status.
 */
function carries(schema: Record<string, unknown>, field: string): boolean {
  const required = (schema.required ?? []) as string[]
  return required.includes(field)
}
