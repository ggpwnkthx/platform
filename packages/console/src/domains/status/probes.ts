/**
 * The status of the services of the platform.
 *
 * The console reads the probes of the three services — `/healthz` and
 * `/readyz` — and it shows what they answer. A probe reads nothing about
 * a tenant, a caller or an operator: the summary of the status is a page
 * that anybody may read, and its detail is for the operators who hold
 * `console.status`.
 *
 * The probes are read in the client of the platform (`@platform/client`):
 * the console and the CLI read the same probes, and a probe that
 * answers differently in one of them is a probe a deployment cannot
 * read.
 */

import {
  overallOf as platformOverallOf,
  probeService as platformProbeService,
  summaryOf as platformSummaryOf,
  type ServiceStatus as PlatformServiceStatus,
} from '@platform/client'
import { transportOf, type Fetch } from '../transport'

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

/** The transport of the probes of the console. */
function transportOfProbes(fetcher: Fetch, timeoutMs: number): ReturnType<typeof transportOf> {
  return transportOf('the platform', fetcher, timeoutMs)
}

/** Probes a service. */
export async function probeService(
  target: ProbeTarget,
  options: { fetch?: Fetch; timeoutMs: number }
): Promise<ServiceStatus> {
  const status = await platformProbeService(
    transportOfProbes(options.fetch ?? fetch, options.timeoutMs),
    target
  )
  return status as unknown as ServiceStatus
}

/** The state of the platform: the worst state of its services. */
export function overallOf(services: readonly ServiceStatus[]): ServiceState {
  return platformOverallOf(services as readonly PlatformServiceStatus[])
}

/** The summary of a status that anybody may read: the states, and nothing else. */
export function summaryOf(service: ServiceStatus): ServiceStatus {
  return platformSummaryOf(service as unknown as PlatformServiceStatus) as unknown as ServiceStatus
}
