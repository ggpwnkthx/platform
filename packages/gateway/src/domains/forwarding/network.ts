/**
 * The addresses of the network.
 *
 * The trusted proxy evaluation needs to know whether an address belongs to a
 * range. The syntax of the ranges (`10.0.0.0/8`) and of the addresses is
 * parsed by a library: the gateway does not implement a format that a
 * library already does.
 */

import ipaddr from 'ipaddr.js'
import { LRUCache } from 'lru-cache'

type Address = ipaddr.IPv4 | ipaddr.IPv6

/** A compiled range: a network and the length of its prefix. */
interface Range {
  address: Address
  prefix: number
  family: 'ipv4' | 'ipv6'
}

/**
 * The compiled ranges, by the key of the list they came from.
 *
 * The ranges of the trusted proxies change only when the configuration is
 * reloaded, so compiling them once per list keeps the request path cheap.
 * The cache is bounded: a pathological configuration cannot grow it without
 * limit.
 */
const compiled = new LRUCache<string, Range[]>({ max: 32 })

/**
 * Parses a range (`10.0.0.0/8`) or a single address (`127.0.0.1`).
 *
 * A value that cannot be parsed is dropped: it never matches, instead of
 * making the whole list unusable.
 */
function parseRange(value: string): Range | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes('/')) {
    try {
      const [address, prefix] = ipaddr.parseCIDR(trimmed)
      return { address, prefix, family: address.kind() }
    } catch {
      return null
    }
  }
  let address: Address
  try {
    address = ipaddr.parse(trimmed)
  } catch {
    return null
  }
  return { address, prefix: address.kind() === 'ipv4' ? 32 : 128, family: address.kind() }
}

/**
 * The largest number of addresses the trust of a proxy may cover.
 *
 * The trust of a forwarding header is the trust of an address: a peer that
 * is inside the trusted range chooses the host of the request, the address
 * of the caller and the protocol of the request. A range that covers a
 * whole private network is therefore the trust of every workload of the
 * network, and not the trust of a proxy.
 *
 * The bound is sixteen addresses: an ingress is one or two pods, and the
 * range of a deployment that names them is a handful of addresses.
 */
export const MAX_TRUSTED_PROXY_ADDRESSES = 16

/**
 * The shortest prefix an IPv4 range may have to be inside the bound.
 *
 * A /28 covers sixteen addresses, a /24 covers two hundred and fifty six.
 */
const MINIMUM_IPV4_PREFIX = 28

/**
 * The shortest prefix an IPv6 range may have to be inside the bound.
 *
 * A /124 covers sixteen addresses.
 */
const MINIMUM_IPV6_PREFIX = 124

/**
 * Reports whether a range is covered by the bound of the trust.
 *
 * A range that cannot be parsed is not a range: it is reported by
 * `invalidRanges` and not by this function, so an operator reads two
 * different reasons.
 */
export function isWideRange(value: string): boolean {
  const range = parseRange(value)
  if (!range) return false
  const minimum = range.family === 'ipv4' ? MINIMUM_IPV4_PREFIX : MINIMUM_IPV6_PREFIX
  return range.prefix < minimum
}

/**
 * Reports whether a value is a range the gateway can read.
 *
 * A value that is not a range matches nothing: it is dropped, and the
 * proxy it was meant to name is not trusted. A deployment that does not
 * know it has a typo in its trust believes it is protected by a proxy that
 * is not there.
 */
export function isRange(value: string): boolean {
  return parseRange(value) !== null
}

/**
 * The ranges of a list that are too wide to be trusted.
 *
 * The list is the list of the ranges of the deployment, and the answer is
 * the ranges an operator has to narrow: the message of the refusal names
 * them.
 */
export function wideRanges(ranges: readonly string[]): string[] {
  return ranges.filter((range) => isWideRange(range))
}

/**
 * The ranges of a list that are not ranges.
 *
 * They are named apart from the wide ones: a value that cannot be read is
 * a typo of the operator and not a trust that is too wide.
 */
export function invalidRanges(ranges: readonly string[]): string[] {
  return ranges.filter((range) => !isRange(range))
}

/**
 * Reports whether an address is covered by one of the given ranges.
 *
 * A range is a CIDR range (`10.0.0.0/8`) or a single address
 * (`127.0.0.1`). A range of another address family never matches.
 */
export function ipInRanges(ip: string, ranges: readonly string[]): boolean {
  const trimmed = ip.trim()
  if (!trimmed) return false
  let address: Address
  try {
    address = ipaddr.parse(trimmed)
  } catch {
    return false
  }
  const key = ranges.join(',')
  let compiledRanges = compiled.get(key)
  if (!compiledRanges) {
    compiledRanges = []
    for (const range of ranges) {
      const parsed = parseRange(range)
      if (parsed) compiledRanges.push(parsed)
    }
    compiled.set(key, compiledRanges)
  }
  for (const range of compiledRanges) {
    if (range.family !== address.kind()) continue
    if (address.match(range.address, range.prefix)) return true
  }
  return false
}
