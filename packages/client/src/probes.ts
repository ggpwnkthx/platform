/**
 * The probes of the services of the platform.
 *
 * The gateway, Access and Data answer the same probes — `/healthz` and
 * `/readyz` — and they answer them the same way: the same paths, the
 * same fields and the same vocabulary of the readiness. A deployment
 * reads the probes of the three services with the same code, and a
 * probe that answers differently in one service is a probe the
 * deployment cannot read.
 *
 * The vocabulary of the readiness is `ready`, `draining` and
 * `not-ready`: a service that drains says so before it stops admitting
 * requests, and a service that is not ready says why.
 *
 * The timeout of a probe belongs to the transport: the console reads
 * the probes with a budget of time and the CLI with the budget of its
 * call.
 */

import { type ClientTransport, bodyOf } from './transport'

/** The state of a service, as its probes tell it. */
export type ServiceState = 'up' | 'degraded' | 'down' | 'unconfigured'

/** The answer of one probe. */
export interface ProbeAnswer {
  /** The status of the answer, or null when nothing answered. */
  readonly status: number | null
  /** True when the answer was a success. */
  readonly ok: boolean
  /** The time the probe took. */
  readonly latencyMs: number
  /** The body of the answer, when it is small json. */
  readonly body: unknown
  /** Why nothing answered. */
  readonly error: string | null
}

/** The status of one service. */
export interface ServiceStatus {
  readonly id: string
  readonly name: string
  readonly state: ServiceState
  readonly version: string | null
  readonly health: ProbeAnswer | null
  readonly ready: ProbeAnswer | null
  readonly checkedAt: string
}

/** A service to probe. */
export interface ProbeTarget {
  readonly id: string
  readonly name: string
  /** The url of the service, or null when the deployment names none. */
  readonly url: string | null
}

/**
 * Reads one probe.
 *
 * A probe that does not answer is a probe that failed, and the reason
 * is read from the failure: a service that cannot be reached is not a
 * service that is not ready.
 *
 * @param transport the transport of the call.
 * @param url the address of the probe.
 */
export async function probeOf(transport: ClientTransport, url: string): Promise<ProbeAnswer> {
  const started = performance.now()
  try {
    const answer = await transport.send({
      method: 'GET',
      url,
      headers: { accept: 'application/json' },
    })
    const body = bodyOf(answer)
    return {
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      latencyMs: Math.round(performance.now() - started),
      body: typeof body === 'string' && body.length > 500 ? `${body.slice(0, 500)}…` : body,
      error: null,
    }
  } catch (error) {
    return {
      status: null,
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      body: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * The state of a service from the answers of its two probes.
 *
 * @param health the answer of the health.
 * @param ready the answer of the readiness.
 */
export function stateOf(health: ProbeAnswer, ready: ProbeAnswer): ServiceState {
  if (!health.ok) return 'down'
  return ready.ok ? 'up' : 'degraded'
}

/**
 * The version a service answers in its health probe.
 *
 * @param answer the answer of the health.
 */
export function versionOf(answer: ProbeAnswer): string | null {
  const body = answer.body
  if (typeof body === 'object' && body !== null && 'version' in body) {
    const version = (body as { version: unknown }).version
    return typeof version === 'string' ? version : null
  }
  return null
}

/**
 * Probes a service.
 *
 * @param transport the transport of the calls.
 * @param target the service to probe.
 */
export async function probeService(
  transport: ClientTransport,
  target: ProbeTarget
): Promise<ServiceStatus> {
  const checkedAt = new Date().toISOString()
  if (!target.url) {
    return {
      id: target.id,
      name: target.name,
      state: 'unconfigured',
      version: null,
      health: null,
      ready: null,
      checkedAt,
    }
  }
  const [health, ready] = await Promise.all([
    probeOf(transport, `${target.url}/healthz`),
    probeOf(transport, `${target.url}/readyz`),
  ])
  return {
    id: target.id,
    name: target.name,
    state: stateOf(health, ready),
    version: versionOf(health),
    health,
    ready,
    checkedAt,
  }
}

/**
 * The state of the platform: the worst state of its services.
 *
 * @param services the statuses of the services.
 */
export function overallOf(services: readonly ServiceStatus[]): ServiceState {
  const states = services
    .map((service) => service.state)
    .filter((state) => state !== 'unconfigured')
  if (states.length === 0) return 'unconfigured'
  if (states.includes('down')) return 'down'
  if (states.includes('degraded')) return 'degraded'
  return 'up'
}

/**
 * The summary of a status that anybody may read: the states, and nothing else.
 *
 * @param service the status of a service.
 */
export function summaryOf(service: ServiceStatus): ServiceStatus {
  return { ...service, version: null, health: null, ready: null }
}
