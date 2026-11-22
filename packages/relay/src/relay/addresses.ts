import { BlockList, isIP } from 'node:net'

const plainAddress = (address: string) => address.trim().replace(/^::ffff:(?=\d+\.)/i, '')

/** The addresses a list of addresses and CIDR blocks names. */
export function addressList(blocks: string[]): BlockList {
  const list = new BlockList()
  for (const block of blocks) {
    const [address = '', prefix, ...rest] = block.split('/')
    const family = isIP(address)
    const bits = prefix === undefined ? null : Number(prefix)
    if (
      !family ||
      rest.length ||
      (bits !== null && (!/^\d+$/.test(prefix ?? '') || bits > (family === 4 ? 32 : 128)))
    )
      throw new Error(`Not an address or a CIDR block: ${block}`)
    const type = family === 4 ? 'ipv4' : 'ipv6'
    if (bits === null) list.addAddress(address, type)
    else list.addSubnet(address, bits, type)
  }
  return list
}

/**
 * The address a session is counted against. It is the peer's, unless the peer is a proxy the
 * deployment trusts: then it is the nearest address in X-Forwarded-For that is not such a
 * proxy itself. Anything further left in that header is the client's own word, and a client
 * that could choose its address would have a budget for every address it can think of.
 */
export function clientAddress(peer: string, forwarded: string | null, trusted: BlockList): string {
  const isTrusted = (address: string) => {
    const family = isIP(address)
    return family !== 0 && trusted.check(address, family === 4 ? 'ipv4' : 'ipv6')
  }
  let address = plainAddress(peer)
  const hops = (forwarded ?? '').split(',').map(plainAddress).filter(Boolean)
  while (isTrusted(address)) {
    const hop = hops.pop()
    if (!hop || !isIP(hop)) break
    address = hop
  }
  return address
}

/** The type letter of the message PostgreSQL reports a setting with. */
