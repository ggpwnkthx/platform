import { describe, expect, test } from 'bun:test'
import {
  invalidRanges,
  isRange,
  isWideRange,
  MAX_TRUSTED_PROXY_ADDRESSES,
  wideRanges,
} from './network'

/**
 * The width of the ranges of the trusted proxies.
 *
 * The trust of a forwarding header is the trust of an address: a peer that
 * is inside a trusted range chooses the host of the request, the address of
 * the caller and the protocol of the request. A range that covers a whole
 * private network is therefore the trust of every workload of that network.
 */
describe('the width of the ranges of the trusted proxies', () => {
  test('a range that covers few addresses is inside the bound', () => {
    expect(isWideRange('127.0.0.1/32')).toBe(false)
    expect(isWideRange('10.0.0.4/32')).toBe(false)
    expect(isWideRange('10.0.0.0/28')).toBe(false)
    expect(isWideRange('::1/128')).toBe(false)
    expect(isWideRange('2001:db8::/124')).toBe(false)
    // A single address without a prefix is a range of one address.
    expect(isWideRange('192.0.2.10')).toBe(false)
  })

  test('a range that covers a network is outside the bound', () => {
    expect(isWideRange('10.0.0.0/8')).toBe(true)
    expect(isWideRange('172.16.0.0/12')).toBe(true)
    expect(isWideRange('192.168.0.0/16')).toBe(true)
    expect(isWideRange('10.0.0.0/24')).toBe(true)
    expect(isWideRange('2001:db8::/64')).toBe(true)
  })

  test('the bound is the number of addresses it names', () => {
    // A /28 covers sixteen addresses of IPv4, and a /124 covers sixteen
    // addresses of IPv6.
    expect(MAX_TRUSTED_PROXY_ADDRESSES).toBe(16)
  })

  test('the ranges of a list that are too wide are named', () => {
    expect(wideRanges(['127.0.0.1/32', '10.0.0.0/8', '192.168.0.0/16'])).toEqual([
      '10.0.0.0/8',
      '192.168.0.0/16',
    ])
    expect(wideRanges(['127.0.0.1/32'])).toEqual([])
  })

  test('a value that is not a range is reported apart from a wide one', () => {
    expect(isRange('127.0.0.1/32')).toBe(true)
    expect(isRange('not-a-range')).toBe(false)
    expect(isRange('10.0.0.0/33')).toBe(false)
    expect(invalidRanges(['127.0.0.1/32', 'not-a-range'])).toEqual(['not-a-range'])
    // A value that cannot be read is not a range that is too wide: the two
    // problems are two different problems.
    expect(wideRanges(['not-a-range'])).toEqual([])
  })
})
