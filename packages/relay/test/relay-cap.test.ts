import { describe, expect, test } from 'bun:test'
import { startRelay } from '../src/relay.ts'
import { signingServer, awkwardServer, startupPacket, open, closed } from './relay-helpers.ts'

/**
 * The cap on a role: how many sessions one role may hold.
 */

describe('the cap on a role', () => {
  test('refuses a session for a role that already holds as many sessions as it may', async () => {
    const server = await signingServer(null)
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 1,
    })
    try {
      const first = await open(`ws://127.0.0.1:${relay.port}`)
      first.send(new Uint8Array(startupPacket('alice@example.com')))
      await server.signed
      const second = await open(`ws://127.0.0.1:${relay.port}`)
      const end = closed(second)
      const carried: unknown[] = []
      second.onmessage = (event) => carried.push(event.data)
      second.send(new Uint8Array(startupPacket('alice@example.com')))
      const event = await end
      expect(event.code).toBe(1008)
      expect(event.reason).toContain('alice@example.com')
      // The refused session must not look to the client like one that has signed in.
      expect(carried).toEqual([])
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('counts a session against the role PostgreSQL signed it in as', async () => {
    const server = await signingServer('bob@example.com')
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 1,
    })
    try {
      // The client asks to be Alice, but PostgreSQL signs the session in as Bob: the
      // session counts against Bob, because Bob is the role that holds it.
      const first = await open(`ws://127.0.0.1:${relay.port}`)
      first.send(new Uint8Array(startupPacket('alice@example.com')))
      await server.signed
      const second = await open(`ws://127.0.0.1:${relay.port}`)
      const end = closed(second)
      second.send(new Uint8Array(startupPacket('bob@example.com')))
      expect((await end).code).toBe(1008)
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('reads the role when the setting arrives in pieces', async () => {
    const server = await awkwardServer('alice@example.com')
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 1,
    })
    try {
      const first = await open(`ws://127.0.0.1:${relay.port}`)
      first.send(new Uint8Array(startupPacket('alice@example.com')))
      await server.signed
      const second = await open(`ws://127.0.0.1:${relay.port}`)
      const end = closed(second)
      second.send(new Uint8Array(startupPacket('alice@example.com')))
      expect((await end).code).toBe(1008)
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('lets another role have a session while one role is at its cap', async () => {
    const server = await signingServer(null)
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 1,
    })
    try {
      const first = await open(`ws://127.0.0.1:${relay.port}`)
      first.send(new Uint8Array(startupPacket('bob@example.com')))
      await server.signed
      // A session for a role nobody holds yet is welcome: the cap is per role.
      const second = await open(`ws://127.0.0.1:${relay.port}`)
      second.send(new Uint8Array(startupPacket('carol@example.com')))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(second.readyState).toBe(WebSocket.OPEN)
    } finally {
      relay.stop()
      server.stop()
    }
  })
})
