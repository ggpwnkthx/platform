import { describe, expect, test } from 'bun:test'
import { callerAddress as accessAddress } from '../packages/access/src/domains/forwarding'
import { callerAddress as consoleAddress } from '../packages/console/src/domains/forwarding'
import { buildUpstreamHeaders } from '../packages/gateway/src/domains/forwarding/headers'
import { resolveForwardingContext } from '../packages/gateway/src/domains/forwarding/context'

/**
 * The address of the caller, from the browser to the audit.
 *
 * The address of the caller is resolved once, at the edge, and it travels
 * with the request: the gateway resolves it and writes it in `x-real-ip`,
 * the console passes it on to Access, and Access writes it in the audit of
 * the change. The chain is the one a deployment behind an ingress that is
 * the only way in walks: the ingress is the peer of every service, and
 * the address it observed is the address of the caller.
 */
describe('the address of the caller, from the browser to the audit', () => {
  test('the gateway resolves it and the console and Access carry it', () => {
    // The browser reaches the gateway through the ingress of the
    // environment, and the ingress reports the address it observed.
    const incoming = new Headers({
      host: 'console.platform.test',
      'x-forwarded-for': '203.0.113.7',
    })
    const forwarding = resolveForwardingContext({
      peerAddress: '100.100.0.57',
      headers: incoming,
      trustedProxies: [],
      trustedProxyHops: 1,
      ingressOnly: true,
      externalProto: 'https',
    })
    expect(forwarding.clientIp).toBe('203.0.113.7')

    // The gateway forwards the request to the console.
    const upstream = buildUpstreamHeaders({
      incoming,
      forwarding,
      identity: undefined,
      signature: undefined,
      gatewayCookies: [],
    })
    expect(upstream.get('x-real-ip')).toBe('203.0.113.7')

    // The console relays it to Access.
    const reported = consoleAddress({ headers: upstream, ingressOnly: true })
    expect(reported).toBe('203.0.113.7')

    // Access writes it in the audit.
    const audited = accessAddress({
      peerAddress: '100.100.0.118',
      headers: new Headers({ 'x-real-ip': reported ?? '' }),
      ingressOnly: true,
    })
    expect(audited).toBe('203.0.113.7')
  })

  test('a caller that sends the header itself chooses nothing', () => {
    // The ingress appends the address it observed to the chain the
    // caller sent, and the entry the caller wrote is on the left.
    const forwarding = resolveForwardingContext({
      peerAddress: '100.100.0.57',
      headers: new Headers({ 'x-forwarded-for': '192.0.2.66, 203.0.113.7' }),
      trustedProxies: [],
      trustedProxyHops: 1,
      ingressOnly: true,
      externalProto: 'https',
    })
    expect(forwarding.clientIp).toBe('203.0.113.7')
  })

  test('a deployment that trusts no ingress names the proxy in its audit', () => {
    const forwarding = resolveForwardingContext({
      peerAddress: '100.100.0.57',
      headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }),
      trustedProxies: [],
      trustedProxyHops: 1,
      externalProto: 'https',
    })
    expect(forwarding.clientIp).toBe('100.100.0.57')
  })
})
