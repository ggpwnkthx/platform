import { describe, expect, test } from 'bun:test'
import { certificate } from './relay-server.ts'
import type { AddressInfo } from 'node:net'
import { createServer as createTlsServer } from 'node:tls'
import { startRelay } from '../src/relay.ts'
import { closed, open, startupPacket } from './relay-helpers.ts'

/**
 * The connection to PostgreSQL in TLS.
 */

describe('the connection to PostgreSQL in TLS', () => {
  const made = certificate()

  /** A server that takes TLS from the first byte, as PostgreSQL does, and echoes. */
  const tlsServer = (pair: { cert: string; key: string }) =>
    new Promise<{ port: number; protocols: (string | false | null)[]; stop: () => void }>(
      (resolve) => {
        const protocols: (string | false | null)[] = []
        const server = createTlsServer({ ...pair, ALPNProtocols: ['postgresql'] }, (socket) => {
          protocols.push(socket.alpnProtocol)
          socket.on('data', (data) => socket.write(data))
          socket.on('error', () => undefined)
        })
        server.listen(0, '127.0.0.1', () =>
          resolve({
            port: (server.address() as AddressInfo).port,
            protocols,
            stop: () => server.close(),
          })
        )
      }
    )

  test.skipIf(!made)('carries the bytes inside TLS, and names the protocol', async () => {
    const pair = made as { cert: string; key: string }
    const server = await tlsServer(pair)
    const relay = startRelay({
      upstream: { host: 'localhost', port: server.port, tls: { ca: pair.cert } },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      const sent = startupPacket('alice@example.com')
      const answer = new Promise<Uint8Array>((resolve) => {
        socket.onmessage = (event) => resolve(new Uint8Array(event.data as ArrayBuffer))
      })
      socket.send(new Uint8Array(sent))
      expect(Buffer.from(await answer).equals(sent)).toBe(true)
      expect(server.protocols).toEqual(['postgresql'])
      socket.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test.skipIf(!made)('refuses a server whose certificate it was not told to trust', async () => {
    const pair = made as { cert: string; key: string }
    const server = await tlsServer(pair)
    const relay = startRelay({
      // No authority is named, so the system's are asked, and none of them signed this.
      upstream: { host: 'localhost', port: server.port, tls: {} },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      const carried: unknown[] = []
      socket.onmessage = (event) => carried.push(event.data)
      const end = closed(socket)
      socket.send(new Uint8Array(startupPacket('alice@example.com')))
      await end
      expect(carried).toEqual([])
    } finally {
      relay.stop()
      server.stop()
    }
  })
})
