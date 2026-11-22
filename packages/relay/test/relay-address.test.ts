import { describe, expect, test } from 'bun:test'
import { countingServer } from './relay-server.ts'
import { addressList, clientAddress, startRelay } from '../src/relay.ts'

/**
 * The address a session is counted against.
 */

describe('the address a session is counted against', () => {
  const proxies = addressList(['10.0.0.0/8', '192.168.1.1', 'fd00::/8'])

  test('is the peer, whatever the peer says, when the peer is not a trusted proxy', () => {
    expect(clientAddress('203.0.113.9', '198.51.100.1', proxies)).toBe('203.0.113.9')
    expect(clientAddress('203.0.113.9', null, addressList([]))).toBe('203.0.113.9')
  })

  test('is the nearest address a trusted proxy names that is not a proxy itself', () => {
    expect(clientAddress('10.1.2.3', '198.51.100.1', proxies)).toBe('198.51.100.1')
    expect(clientAddress('::ffff:10.1.2.3', '198.51.100.1, 192.168.1.1', proxies)).toBe(
      '198.51.100.1'
    )
    // What the client wrote itself, to the left, is not believed.
    expect(clientAddress('10.1.2.3', '1.2.3.4, 198.51.100.1', proxies)).toBe('198.51.100.1')
    expect(clientAddress('fd00::1', '2001:db8::7', proxies)).toBe('2001:db8::7')
  })

  test('is the proxy when the proxy names nobody', () => {
    expect(clientAddress('10.1.2.3', null, proxies)).toBe('10.1.2.3')
    expect(clientAddress('10.1.2.3', 'not an address', proxies)).toBe('10.1.2.3')
  })

  test('refuses a list that does not name addresses', () => {
    expect(() => addressList(['10.0.0.0/33'])).toThrow('CIDR')
    expect(() => addressList(['proxy.example.com'])).toThrow('CIDR')
  })

  test('gives each client behind a trusted proxy a budget of its own', async () => {
    const server = countingServer()
    const options = {
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 1,
      sessionsPerRole: 20,
    }
    const from = (port: number, address: string): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        // Bun's WebSocket takes the headers of its handshake.
        const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: { 'x-forwarded-for': address },
        } as unknown as string[])
        socket.onopen = () => resolve(socket)
        socket.onerror = () => reject(new Error('The relay refused the session'))
      })
    const trusting = startRelay({ ...options, trustedProxies: ['127.0.0.1'] })
    const plain = startRelay(options)
    try {
      const first = await from(trusting.port, '198.51.100.1')
      const second = await from(trusting.port, '198.51.100.2')
      await expect(from(trusting.port, '198.51.100.1')).rejects.toThrow('refused')
      first.close()
      second.close()
      // Without a trusted proxy the header is the client's own word, and counts for nothing.
      const third = await from(plain.port, '198.51.100.1')
      await expect(from(plain.port, '198.51.100.2')).rejects.toThrow('refused')
      third.close()
    } finally {
      trusting.stop()
      plain.stop()
      server.stop()
    }
  })
})
