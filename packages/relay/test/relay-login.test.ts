import { describe, expect, test } from 'bun:test'
import { countingServer, pause } from './relay-server.ts'
import { startRelay } from '../src/relay.ts'
import { closed, int32, open, signingServer, startupPacket } from './relay-helpers.ts'

/**
 * The origin check, and the sessions that have not logged in.
 */

describe('a session that has not logged in', () => {
  test('has no connection to PostgreSQL until it speaks', async () => {
    const server = countingServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      await pause(50)
      expect(server.connections()).toBe(0)
      const answer = new Promise((resolve) => {
        socket.onmessage = resolve
      })
      socket.send(new Uint8Array(startupPacket('alice@example.com')))
      await answer
      expect(server.connections()).toBe(1)
      socket.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('is closed when it does not log in in time, and its place is given back', async () => {
    const server = countingServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 1,
      sessionsPerRole: 20,
      loginTimeoutMs: 100,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      // It speaks, and is answered, but PostgreSQL never signs it in.
      socket.send(new Uint8Array(startupPacket('alice@example.com')))
      const event = await closed(socket)
      expect(event.code).toBe(1008)
      expect(event.reason).toContain('in time')
      const next = await open(`ws://127.0.0.1:${relay.port}`)
      next.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('is left open once PostgreSQL has signed it in', async () => {
    const server = await signingServer(null)
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
      loginTimeoutMs: 100,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      socket.send(new Uint8Array(startupPacket('alice@example.com')))
      await server.signed
      await pause(250)
      expect(socket.readyState).toBe(WebSocket.OPEN)
      socket.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('may not send more than a login takes', async () => {
    const server = countingServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      const end = closed(socket)
      socket.send(new Uint8Array(70 * 1024))
      expect((await end).code).toBe(1008)
      expect(server.connections()).toBe(0)
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('has no connection to PostgreSQL until its startup packet is whole', async () => {
    const server = countingServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      const packet = startupPacket('alice@example.com')
      socket.send(new Uint8Array(packet.subarray(0, 11)))
      await pause(50)
      expect(server.connections()).toBe(0)
      const answer = new Promise((resolve) => {
        socket.onmessage = resolve
      })
      socket.send(new Uint8Array(packet.subarray(11)))
      await answer
      expect(server.connections()).toBe(1)
      socket.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('is refused, with no connection to PostgreSQL, when it opens with anything else', async () => {
    const server = countingServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    // A request for TLS inside the stream, one to cancel a statement, and no packet at all.
    const openings = [
      Buffer.concat([int32(8), int32(80877103)]),
      Buffer.concat([int32(16), int32(80877102), int32(1), int32(2)]),
      Buffer.from('not a packet'),
    ]
    try {
      for (const opening of openings) {
        const socket = await open(`ws://127.0.0.1:${relay.port}`)
        const end = closed(socket)
        socket.send(new Uint8Array(opening))
        const event = await end
        expect(event.code).toBe(1008)
        expect(event.reason).toContain('startup packet')
      }
      expect(server.connections()).toBe(0)
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('counts against a cap on every address together', async () => {
    const server = countingServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
      sessionsLoggingIn: 2,
    })
    try {
      const first = await open(`ws://127.0.0.1:${relay.port}`)
      const second = await open(`ws://127.0.0.1:${relay.port}`)
      await expect(open(`ws://127.0.0.1:${relay.port}`)).rejects.toThrow('refused')
      // A session that goes gives its place back.
      first.close()
      await pause(50)
      const third = await open(`ws://127.0.0.1:${relay.port}`)
      second.close()
      third.close()
    } finally {
      relay.stop()
      server.stop()
    }
  })
})
