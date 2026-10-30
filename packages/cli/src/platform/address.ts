/**
 * The public address of the machine of the operator.
 *
 * The account of the state of a deployment is closed to every address
 * but the ones of the operator, and the address that reaches Azure is
 * the address the internet sees: the address of the machine itself is
 * a private one, and the network of the operator is what the state of
 * the deployment answers to.
 *
 * The address is read from a service that answers with it. The CLI
 * reads the release of the platform from the repository that publishes
 * it, and it reads the address of the machine from a service that
 * answers with nothing but the address.
 *
 * A service that cannot be reached is not a failure: the operator is
 * asked for the address, and the answer of the operator is the answer
 * that is used.
 */

/** The services that answer with the public address of the machine. */
export const ADDRESS_SERVICES: readonly string[] = [
  'https://icanhazip.com',
  'https://api.ipify.org',
]

/** The values that refuse the reading of the address. */
const REFUSES = new Set(['0', 'off', 'false', 'no'])

/** The timeout of a call, in milliseconds. */
const TIMEOUT_MS = 5_000

/** The function that asks a service for the address of the machine. */
export type Fetcher = (
  url: string,
  init?: { readonly signal?: AbortSignal }
) => Promise<{ readonly ok: boolean; text(): Promise<string> }>

/**
 * The services the address of the machine is read from.
 *
 * The operator names the service with `PLATFORMCTL_ADDRESS_SERVICE`,
 * and refuses the reading with `PLATFORMCTL_ADDRESS_LOOKUP` set to
 * `off`: the address of the machine is not a secret, and a reader who
 * wants no call to a service of the internet says so.
 *
 * @param environment the environment of the process.
 */
export function servicesOf(
  environment: Readonly<Record<string, string | undefined>>
): readonly string[] {
  const refused = environment.PLATFORMCTL_ADDRESS_LOOKUP?.trim().toLowerCase()
  if (refused !== undefined && REFUSES.has(refused)) return []
  const named = environment.PLATFORMCTL_ADDRESS_SERVICE?.trim()
  if (named !== undefined && named !== '') return [named]
  return ADDRESS_SERVICES
}

/**
 * The public address of the machine of the operator.
 *
 * The services are asked one after the other, and the first one that
 * answers with an address is the answer. A service that cannot be
 * reached, and a service that answers with something that is not an
 * address, are the same thing: the next one is asked.
 *
 * @param fetch the function that asks a service.
 * @param services the services that answer with the address.
 */
export async function publicAddressOf(
  fetch: Fetcher = globalThis.fetch as unknown as Fetcher,
  services: readonly string[] = ADDRESS_SERVICES
): Promise<string | undefined> {
  for (const service of services) {
    const address = await addressOf(service, fetch)
    if (address !== undefined) return address
  }
  return undefined
}

/**
 * The address a service answers with.
 *
 * @param service the service that answers with the address.
 * @param fetch the function that asks the service.
 */
async function addressOf(service: string, fetch: Fetcher): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const answer = await fetch(service, { signal: controller.signal })
    if (!answer.ok) return undefined
    const text = (await answer.text()).trim()
    return isAddress(text) ? text : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reports whether a text is the address of a machine.
 *
 * @param text the text a service answered with.
 */
export function isAddress(text: string): boolean {
  return isIpv4(text) || isIpv6(text)
}

/**
 * Reports whether a text is the address of a machine, in the notation
 * of the fourth version of the protocol.
 *
 * @param text the text a service answered with.
 */
function isIpv4(text: string): boolean {
  const parts = text.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Reports whether a text is the address of a machine, in the notation
 * of the sixth version of the protocol.
 *
 * @param text the text a service answered with.
 */
function isIpv6(text: string): boolean {
  if (!text.includes(':')) return false
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return false
  const halves = text.split('::')
  if (halves.length > 2) return false
  const groups = (half: string): number =>
    half.split(':').filter((group) => group !== '' && !group.includes('.')).length
  const left = groups(halves[0]!)
  const right = halves[1] === undefined ? 0 : groups(halves[1]!)
  if (halves.length === 2) return left + right <= 7
  return left === 8
}

/**
 * The range of an address, as the network rules of Azure take it.
 *
 * The service that holds the state refuses a range of one address: the
 * tightest range it takes is a range of four addresses, and a range
 * that is narrower is widened to the range that holds the address. A
 * range the operator named is the range of the network that holds it,
 * so that the service reads the range and not the address.
 *
 * @param text the address, with its prefix when it carries one.
 */
export function rangeOf(text: string): string {
  const parts = text.split('/')
  const address = parts[0] ?? ''
  if (!isAddress(address)) return text
  const bits = isIpv4(address) ? 30 : 64
  const given = parts.length > 1 ? Number(parts[1]) : undefined
  if (given !== undefined && Number.isInteger(given) && given >= 0 && given <= bits) {
    return `${networkOf(address, given)}/${given}`
  }
  return `${networkOf(address, bits)}/${bits}`
}

/**
 * The address of the network of an address.
 *
 * The network of an address holds the address, and it is the address
 * of the network with the bits of the host set to zero.
 *
 * @param address the address of the machine.
 * @param bits the number of bits of the prefix of the network.
 */
export function networkOf(address: string, bits: number): string {
  if (isIpv4(address)) {
    const size = 32n - BigInt(bits)
    const masked = ((ipv4Of(address) >> size) << size) & 0xffffffffn
    return [24n, 16n, 8n, 0n].map((shift) => Number((masked >> shift) & 0xffn)).join('.')
  }
  const size = 128n - BigInt(bits)
  const masked = ((ipv6Of(address) >> size) << size) & ((1n << 128n) - 1n)
  const groups: string[] = []
  for (let index = 7; index >= 0; index -= 1) {
    groups.push(((masked >> BigInt(index * 16)) & 0xffffn).toString(16))
  }
  return groups.join(':')
}

/**
 * The value of an address of the fourth version of the protocol.
 *
 * @param address the address of the machine.
 */
function ipv4Of(address: string): bigint {
  return address.split('.').reduce((value, part) => (value << 8n) + BigInt(Number(part)), 0n)
}

/**
 * The value of an address of the sixth version of the protocol.
 *
 * @param address the address of the machine.
 */
function ipv6Of(address: string): bigint {
  const halves = address.split('::')
  const head = halves[0] === '' ? [] : halves[0]!.split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : []
  const missing = Math.max(8 - groups(head) - groups(tail), 0)
  const parts = [...head, ...new Array<string>(missing).fill('0'), ...tail]
  let value = 0n
  for (const part of parts) {
    if (part.includes('.')) {
      value = (value << 32n) + ipv4Of(part)
      continue
    }
    value = (value << 16n) + BigInt(`0x${part}`)
  }
  return value
}

/**
 * The number of groups of a set of groups of an address.
 *
 * A group that holds an address of the fourth version of the protocol
 * is two groups of the sixth version.
 *
 * @param parts the groups of one half of the address.
 */
function groups(parts: readonly string[]): number {
  return parts.reduce((total, part) => total + (part.includes('.') ? 2 : 1), 0)
}
