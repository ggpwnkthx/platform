/**
 * The address of the caller of a request.
 *
 * The address of the socket is the address of the peer: behind an
 * ingress it is the address of the ingress, and every caller of the
 * deployment shares it. The audit of a change then names the ingress
 * instead of the operator that made the change.
 *
 * A deployment that is behind an ingress says so (`ACCESS_INGRESS_ONLY`),
 * and the address the ingress reports in `x-real-ip` is then the address
 * of the caller. The gateway writes that header for the services it
 * forwards to, and the console writes it for the calls it makes to
 * Access.
 *
 * The trust of the header is the trust of the deployment: the address is
 * only read when the deployment says that the ingress is the only way
 * in, and a service that is published reads nothing. The address of the
 * socket is the address of the peer in every other case.
 *
 * The address of the socket is still the key of the limiter of the
 * administration: a header is a value the caller controls, and the
 * budget of the failed authentications must not be one that a caller
 * names for itself.
 */

import ipaddr from 'ipaddr.js'

/** The header the ingress of the deployment reports the caller in. */
const CALLER_ADDRESS_HEADER = 'x-real-ip'

/** The options of the address of the caller. */
export interface CallerAddressOptions {
  /** The address of the peer of the request: the address of the socket. */
  readonly peerAddress: string
  /** The headers of the request. */
  readonly headers: Headers
  /**
   * True when the deployment is behind an ingress that is the only way in.
   *
   * Every peer of the service is then the ingress of the deployment, and
   * the address the ingress reports is the address of the caller.
   */
  readonly ingressOnly: boolean
}

/**
 * The address of the caller of a request.
 *
 * It is the address the ingress reports when the deployment is behind an
 * ingress that is the only way in, and the address of the socket
 * otherwise.
 */
export function callerAddress(options: CallerAddressOptions): string {
  if (!options.ingressOnly) return options.peerAddress
  return reportedAddress(options.headers) ?? options.peerAddress
}

/**
 * The address a request reports in the header of the caller, when it holds one.
 *
 * A value that is not an address is ignored: a header is a value the
 * caller controls, and a value that cannot be an address is not one.
 */
export function reportedAddress(headers: Headers): string | undefined {
  const reported = headers.get(CALLER_ADDRESS_HEADER)?.trim()
  if (!reported) return undefined
  return isAddress(reported) ? reported : undefined
}

/** Reports whether a value is the address of a host. */
function isAddress(value: string): boolean {
  try {
    ipaddr.parse(value)
    return true
  } catch {
    return false
  }
}
