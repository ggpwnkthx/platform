/**
 * The status of the services of the platform.
 *
 * The console reads the probes of the three services — `/healthz` and
 * `/readyz` — and it shows what they answer. A probe reads nothing about
 * a tenant, a caller or an operator: the summary of the status is a page
 * that anybody may read, and its detail is for the operators who hold
 * `console.status`.
 */

import { bodyOf, type Fetch } from '../transport'

/** The state of a service, as its probes tell it. */
export type ServiceState = 'up' | 'degraded' | 'down' | 'unconfigured'

/** The answer of one probe. */
export interface ProbeAnswer {
  /** The status of the answer, or null when nothing answered. */
  readonly status: number | null
  readonly ok: boolean
  readonly latencyMs: number
  /** The body of the answer, when it is small json. */
  readonly body: unknown
  /** Why nothing answered. */
  readonly error: string | null
}

/** The status of one service. */
export interface ServiceStatus {
  readonly id: 'gateway' | 'access' | 'data' | 'console'
  readonly name: string
  readonly state: ServiceState
  readonly version: string | null
  readonly health: ProbeAnswer | null
  readonly ready: ProbeAnswer | null
  readonly checkedAt: string
}

/** A service the console probes. */
export interface ProbeTarget {
  readonly id: ServiceStatus['id']
  readonly name: string
  /** The url of the service, or null when the deployment names none. */
  readonly url: string | null
}

/** Reads one probe within a budget. */
async function probe(fetcher: Fetch, url: string, timeoutMs: number): Promise<ProbeAnswer> {
  const started = performance.now()
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
      redirect: 'manual',
    })
    const body = await bodyOf(response)
    return {
      status: response.status,
      ok: response.ok,
      latencyMs: Math.round(performance.now() - started),
      body: typeof body === 'string' && body.length > 500 ? `${body.slice(0, 500)}…` : body,
      error: null,
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      status: null,
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      body: null,
      error: timedOut ? `no answer within ${timeoutMs} ms` : (error as Error).message,
    }
  }
}

/** The state of a service from the answers of its two probes. */
export function stateOf(health: ProbeAnswer, ready: ProbeAnswer): ServiceState {
  if (!health.ok) return 'down'
  return ready.ok ? 'up' : 'degraded'
}

/** The version a service answers in its health probe. */
function versionOf(answer: ProbeAnswer): string | null {
  const body = answer.body
  if (typeof body === 'object' && body !== null && 'version' in body) {
    const version = (body as { version: unknown }).version
    return typeof version === 'string' ? version : null
  }
  return null
}

/** Probes a service. */
export async function probeService(
  target: ProbeTarget,
  options: { fetch?: Fetch; timeoutMs: number }
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
  const fetcher = options.fetch ?? fetch
  const [health, ready] = await Promise.all([
    probe(fetcher, `${target.url}/healthz`, options.timeoutMs),
    probe(fetcher, `${target.url}/readyz`, options.timeoutMs),
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

/** The state of the platform: the worst state of its services. */
export function overallOf(services: readonly ServiceStatus[]): ServiceState {
  const states = services
    .map((service) => service.state)
    .filter((state) => state !== 'unconfigured')
  if (states.length === 0) return 'unconfigured'
  if (states.includes('down')) return 'down'
  if (states.includes('degraded')) return 'degraded'
  return 'up'
}

/** The summary of a status that anybody may read: the states, and nothing else. */
export function summaryOf(service: ServiceStatus): ServiceStatus {
  return { ...service, version: null, health: null, ready: null }
}
