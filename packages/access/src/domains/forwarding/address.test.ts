import { describe, expect, test } from 'bun:test'
import { callerAddress, reportedAddress } from './address'

/** The headers of a request that reports an address. */
function headersOf(reported?: string): Headers {
  const headers = new Headers()
  if (reported !== undefined) headers.set('x-real-ip', reported)
  return headers
}

describe('the address of the caller', () => {
  test('the address of the socket is the address of the caller', () => {
    expect(
      callerAddress({
        peerAddress: '100.100.0.57',
        headers: headersOf('203.0.113.7'),
        ingressOnly: false,
      })
    ).toBe('100.100.0.57')
  })

  test('a deployment behind an ingress reads the address it reports', () => {
    expect(
      callerAddress({
        peerAddress: '100.100.0.57',
        headers: headersOf('203.0.113.7'),
        ingressOnly: true,
      })
    ).toBe('203.0.113.7')
  })

  test('a request that reports no address keeps the address of the socket', () => {
    expect(
      callerAddress({ peerAddress: '100.100.0.57', headers: headersOf(), ingressOnly: true })
    ).toBe('100.100.0.57')
  })

  test('a value that is not an address is not one', () => {
    expect(
      callerAddress({
        peerAddress: '100.100.0.57',
        headers: headersOf('the address of the caller'),
        ingressOnly: true,
      })
    ).toBe('100.100.0.57')
  })

  test('the address of a host of the internet is an address', () => {
    expect(reportedAddress(headersOf('203.0.113.7'))).toBe('203.0.113.7')
    expect(reportedAddress(headersOf('2001:db8::1'))).toBe('2001:db8::1')
    expect(reportedAddress(headersOf('203.0.113.7 '))).toBe('203.0.113.7')
    expect(reportedAddress(headersOf('203.0.113.7, 198.51.100.9'))).toBeUndefined()
    expect(reportedAddress(headersOf('not an address'))).toBeUndefined()
    expect(reportedAddress(headersOf())).toBeUndefined()
  })
})
