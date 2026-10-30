import { describe, expect, test } from 'bun:test'
import {
  ADDRESS_SERVICES,
  isAddress,
  publicAddressOf,
  rangeOf,
  servicesOf,
  type Fetcher,
} from '../src/platform/address'

/**
 * The public address of the machine of the operator.
 *
 * The account of the state of a deployment is closed to every address
 * but the ones of the operator, and the address that reaches Azure is
 * the address the internet sees. The tests prove that the address is
 * read, that a service that cannot be reached is not a failure, and
 * that an answer that is not an address is refused.
 */

/** A service that answers with a body. */
function answerOf(body: string, ok = true): Fetcher {
  return async () => ({ ok, text: async () => body })
}

/** A service that cannot be reached. */
function broken(): Fetcher {
  return async () => {
    throw new Error('the service cannot be reached')
  }
}

describe('the public address of the machine', () => {
  test('the address is read from the service that answers with it', async () => {
    const asked: string[] = []
    const address = await publicAddressOf(async (url) => {
      asked.push(url)
      return { ok: true, text: async () => '203.0.113.4\n' }
    })
    expect(address).toBe('203.0.113.4')
    expect(asked).toEqual([ADDRESS_SERVICES[0]!])
  })

  test('a service that cannot be reached is not a failure', async () => {
    const address = await publicAddressOf(broken())
    expect(address).toBeUndefined()
  })

  test('a service that answers with an error is not an answer', async () => {
    const address = await publicAddressOf(answerOf('nope', false))
    expect(address).toBeUndefined()
  })

  test('a service that answers with something that is not an address is not an answer', async () => {
    const address = await publicAddressOf(answerOf('<html>hello</html>'))
    expect(address).toBeUndefined()
  })

  test('every service is asked when none of them answers', async () => {
    const asked: string[] = []
    await publicAddressOf(async (url) => {
      asked.push(url)
      throw new Error('the service cannot be reached')
    })
    expect(asked).toEqual([...ADDRESS_SERVICES])
  })

  test('the second service answers when the first one does not', async () => {
    const address = await publicAddressOf(async (url) => {
      if (url === ADDRESS_SERVICES[0]) throw new Error('the service cannot be reached')
      return { ok: true, text: async () => '198.51.100.7' }
    })
    expect(address).toBe('198.51.100.7')
  })
})

describe('the services the address is read from', () => {
  test('the services of the platform are asked when the reader names none', () => {
    expect(servicesOf({})).toEqual([...ADDRESS_SERVICES])
  })

  test('the reader names the service that answers with the address', () => {
    expect(servicesOf({ PLATFORMCTL_ADDRESS_SERVICE: 'https://example.com/ip' })).toEqual([
      'https://example.com/ip',
    ])
  })

  test('the reader refuses the reading of the address', () => {
    expect(servicesOf({ PLATFORMCTL_ADDRESS_LOOKUP: 'off' })).toEqual([])
    expect(servicesOf({ PLATFORMCTL_ADDRESS_LOOKUP: 'no' })).toEqual([])
  })

  test('the refusal of the reading holds over the service that is named', () => {
    expect(
      servicesOf({
        PLATFORMCTL_ADDRESS_LOOKUP: 'off',
        PLATFORMCTL_ADDRESS_SERVICE: 'https://example.com/ip',
      })
    ).toEqual([])
  })
})

describe('the address of a machine', () => {
  test('an address in the fourth version of the protocol is an address', () => {
    expect(isAddress('203.0.113.4')).toBe(true)
    expect(isAddress('0.0.0.0')).toBe(true)
    expect(isAddress('255.255.255.255')).toBe(true)
  })

  test('a number that is not an address is not an address', () => {
    expect(isAddress('203.0.113.256')).toBe(false)
    expect(isAddress('203.0.113')).toBe(false)
    expect(isAddress('203.0.113.4.5')).toBe(false)
    expect(isAddress('')).toBe(false)
    expect(isAddress('here')).toBe(false)
  })

  test('an address in the sixth version of the protocol is an address', () => {
    expect(isAddress('2001:db8::1')).toBe(true)
    expect(isAddress('::1')).toBe(true)
    expect(isAddress('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(true)
  })

  test('a range of one address is the range of the network that holds it', () => {
    expect(rangeOf('203.0.113.4')).toBe('203.0.113.4/30')
    expect(rangeOf('203.0.113.7')).toBe('203.0.113.4/30')
    expect(rangeOf('159.96.225.85/32')).toBe('159.96.225.84/30')
  })

  test('a range that is wider than the network is the range it names', () => {
    expect(rangeOf('203.0.113.4/24')).toBe('203.0.113.0/24')
    expect(rangeOf('203.0.113.4/16')).toBe('203.0.0.0/16')
  })

  test('an address of the sixth version of the protocol is a network of sixty-four bits', () => {
    expect(rangeOf('2001:db8::1')).toBe('2001:db8:0:0:0:0:0:0/64')
  })
})
