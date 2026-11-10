import { describe, expect, test } from 'bun:test'
import { AdminClient } from '../src/domains/access'
import { callerAddress } from '../src/domains/forwarding'

/** The headers of a request the gateway answered. */
function headersOf(reported?: string): Headers {
  const headers = new Headers()
  if (reported !== undefined) headers.set('x-real-ip', reported)
  return headers
}

describe('the address of the caller', () => {
  test('a console that is published knows no address', () => {
    expect(callerAddress({ headers: headersOf('203.0.113.7'), ingressOnly: false })).toBeUndefined()
  })

  test('a console behind an ingress reads the address the gateway reports', () => {
    expect(callerAddress({ headers: headersOf('203.0.113.7'), ingressOnly: true })).toBe(
      '203.0.113.7'
    )
  })

  test('a request that reports no address leaves the console with none', () => {
    expect(callerAddress({ headers: headersOf(), ingressOnly: true })).toBeUndefined()
  })

  test('a value that is not an address is not one', () => {
    expect(
      callerAddress({ headers: headersOf('the address of the caller'), ingressOnly: true })
    ).toBeUndefined()
  })
})

describe('the client of the administration', () => {
  /** The headers of the calls the client made. */
  function headersOfCalls(calls: { url: string; init?: RequestInit }[]): Headers[] {
    return calls.map((call) => new Headers(call.init?.headers))
  }

  test('the client tells Access the address of the caller', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const client = new AdminClient({
      accessUrl: 'http://access.internal:8081',
      credential: 'the-credential-of-the-tenant',
      timeoutMs: 1000,
      callerAddress: '203.0.113.7',
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return Response.json({ tenants: [], total: 0, limit: 0, offset: 0 })
      },
    })
    await client.tenants()
    expect(headersOfCalls(calls)[0]!.get('x-real-ip')).toBe('203.0.113.7')
  })

  test('a client that knows no address tells Access none', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const client = new AdminClient({
      accessUrl: 'http://access.internal:8081',
      credential: 'the-credential-of-the-tenant',
      timeoutMs: 1000,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return Response.json({ tenants: [], total: 0, limit: 0, offset: 0 })
      },
    })
    await client.tenants()
    expect(headersOfCalls(calls)[0]!.get('x-real-ip')).toBeNull()
  })
})
