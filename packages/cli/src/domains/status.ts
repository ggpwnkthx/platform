/**
 * The state of a deployment.
 *
 * Every service of the platform answers two probes: one that says the
 * process is alive, and one that says it may serve. The CLI reads both
 * and shows them, and it never guesses: a service that does not answer
 * is unreachable, and that is what it is told.
 */

import type { HttpPort } from './contracts'

/** The answer of a probe. */
export interface Probe {
  /** The name of the service, or of the surface. */
  readonly name: string
  /** The address of the probe. */
  readonly url: string
  /** The status of the answer, or zero when there was none. */
  readonly status: number
  /** True when the answer was a success. */
  readonly ok: boolean
  /** The body of the answer, when it was a json one. */
  readonly body: unknown
  /** The message of the failure, when the service did not answer. */
  readonly error?: string
}

/**
 * The probes of a deployment.
 *
 * The names are the names of the roles of the services: the gateway,
 * Access and Data, and the control plane of the gateway.
 */
export interface Deployment {
  /** The address of the gateway. */
  readonly gatewayUrl?: string
  /** The address of the control plane of the gateway. */
  readonly controlUrl?: string
  /** The address of Access. */
  readonly accessUrl?: string
}

/**
 * Reads one probe.
 *
 * @param http the transport of the call.
 * @param name the name of the service.
 * @param url the address of the service.
 * @param path the path of the probe.
 */
export async function probe(
  http: HttpPort,
  name: string,
  url: string,
  path: string
): Promise<Probe> {
  const address = `${url.replace(/\/+$/, '')}${path}`
  try {
    const answer = await http.send({ method: 'GET', url: address })
    let body: unknown = null
    try {
      body = answer.body.trim() === '' ? null : JSON.parse(answer.body)
    } catch {
      body = answer.body
    }
    return {
      name,
      url: address,
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      body,
    }
  } catch (error) {
    return {
      name,
      url: address,
      status: 0,
      ok: false,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Reads the probes of every service of a deployment.
 *
 * @param http the transport of the call.
 * @param deployment the addresses of the deployment.
 */
export async function probesOf(http: HttpPort, deployment: Deployment): Promise<readonly Probe[]> {
  const wanted: { name: string; url: string | undefined }[] = [
    { name: 'gateway', url: deployment.gatewayUrl },
    { name: 'access', url: deployment.accessUrl },
    { name: 'control', url: deployment.controlUrl },
  ]
  const found: Probe[] = []
  for (const { name, url } of wanted) {
    if (!url) continue
    found.push(await probe(http, `${name} (health)`, url, '/healthz'))
    found.push(await probe(http, `${name} (ready)`, url, '/readyz'))
  }
  return found
}
