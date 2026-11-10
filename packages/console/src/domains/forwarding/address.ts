/**
 * The address of the caller of a request.
 *
 * The console is a client of Access: it acts for the operator, and the
 * audit of Access names the address the change came from. The console
 * therefore tells Access the address of the caller it serves.
 *
 * The address is the one the gateway reports in `x-real-ip`: the gateway
 * resolves it once, at the edge, and the console passes it on. A
 * deployment that is behind an ingress that is the only way in says so
 * (`CONSOLE_INGRESS_ONLY`), and the header is then the address of the
 * caller.
 *
 * A console that is published reads nothing: a browser that reaches the
 * console directly chooses the header it sends, and an address it chose
 * is not the address of a caller.
 */

import ipaddr from 'ipaddr.js'

/** The header the gateway reports the address of the caller in. */
export const CALLER_ADDRESS_HEADER = 'x-real-ip'

/** The options of the address of the caller. */
export interface CallerAddressOptions {
  /** The headers of the request the console answers. */
  readonly headers: Headers
  /**
   * True when the deployment is behind an ingress that is the only way in.
   *
   * Every peer of the console is then the ingress of the deployment, and
   * the address the ingress reports is the address of the caller.
   */
  readonly ingressOnly: boolean
}

/**
 * The address of the caller, when the console knows one.
 *
 * It is absent when the console is not behind an ingress that is the
 * only way in, and when the request carries no address: the console
 * tells Access nothing, and Access writes the address of the socket.
 */
export function callerAddress(options: CallerAddressOptions): string | undefined {
  if (!options.ingressOnly) return undefined
  const reported = options.headers.get(CALLER_ADDRESS_HEADER)?.trim()
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
