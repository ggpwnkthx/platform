/**
 * The trust of the forwarding headers.
 *
 * The gateway trusts the peer of a connection and not the header: a peer
 * that is inside a trusted range chooses the host of the request, the
 * address of the caller and the protocol of the request. The trust of a
 * range is therefore the trust of every workload of that range, and a range
 * that covers a private network is the trust of every workload of the
 * network.
 *
 * The rule belongs to the runtime and not to a domain: the domain of the
 * configuration owns the ranges of the table, and the domain of the
 * forwarding owns the evaluation of the peer, and neither of them may
 * depend on the other. The runtime is the place where the two are
 * assembled, and the check lives here.
 */

import { invalidRanges, MAX_TRUSTED_PROXY_ADDRESSES, wideRanges } from '../domains/forwarding'

/**
 * The problems of a list of ranges of trusted proxies.
 *
 * The list is empty when the ranges may be trusted: a range that is not a
 * range, and a range that covers more addresses than the trust of a proxy
 * allows, are problems. The answer names them, because an operator has to
 * know which range to narrow.
 */
export function trustedProxyProblems(ranges: readonly string[]): string[] {
  const problems: string[] = []
  const unreadable = invalidRanges(ranges)
  if (unreadable.length > 0) {
    problems.push(
      `the ranges of the trusted proxies that are not ranges: ${unreadable.join(', ')}. A value that cannot be read matches nothing, so the proxy it names is not trusted`
    )
  }
  const wide = wideRanges(ranges)
  if (wide.length > 0) {
    problems.push(
      `the ranges of the trusted proxies that are too wide: ${wide.join(', ')}. The trust of a proxy covers at most ${MAX_TRUSTED_PROXY_ADDRESSES} addresses, and a range that covers a whole network trusts every workload of that network: name the addresses of the proxies of the deployment instead`
    )
  }
  return problems
}
