import { describe, expect, test } from 'bun:test'
import { startRelay } from '../src/relay.ts'
import { echoServer, startupPacket, open } from './relay-helpers.ts'

/**
 * The relay itself: what it does with the bytes it is given.
 */

describe('the relay', () => {
  test('carries the bytes in both directions, as they are', async () => {
    const server = await echoServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
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
      socket.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('refuses a handshake from an origin that is not allowed', async () => {
    const server = await echoServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: ['https://platform.example.com'],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    try {
      // No Origin header: only a browser sends one, and another site's page cannot forge it.
      await expect(open(`ws://127.0.0.1:${relay.port}`)).rejects.toThrow('refused')
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('caps how many sessions one address may have logging in at once', async () => {
    const server = await echoServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 1,
      sessionsPerRole: 20,
    })
    try {
      const first = await open(`ws://127.0.0.1:${relay.port}`)
      await expect(open(`ws://127.0.0.1:${relay.port}`)).rejects.toThrow('refused')
      first.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })
})
