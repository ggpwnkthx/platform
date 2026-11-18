import { describe, expect, test } from 'bun:test'
import { originAllowed, startRelay } from '../src/relay.ts'

/** A TCP server that answers with the bytes it is given, one for one. */
function echoServer(): Promise<{ port: number; stop: () => void }> {
  const server = Bun.listen({
    port: 0,
    hostname: '127.0.0.1',
    socket: {
      data(socket, data) {
        socket.write(data)
      },
    },
  })
  return Promise.resolve({
    port: server.port,
    stop: () => {
      server.stop(true)
    },
  })
}

const open = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => resolve(socket)
    socket.onerror = () => reject(new Error('The relay refused the session'))
  })

describe('the relay', () => {
  test('carries the bytes in both directions, and understands none of them', async () => {
    const server = await echoServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
    })
    try {
      const socket = await open(`ws://127.0.0.1:${relay.port}`)
      const sent = new TextEncoder().encode('a startup packet')
      const answer = new Promise<Uint8Array>((resolve) => {
        socket.onmessage = (event) => resolve(new Uint8Array(event.data as ArrayBuffer))
      })
      socket.send(sent)
      expect(new TextDecoder().decode(await answer)).toBe('a startup packet')
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
    })
    try {
      // No Origin header: only a browser sends one, and another site's page cannot forge it.
      await expect(open(`ws://127.0.0.1:${relay.port}`)).rejects.toThrow('refused')
    } finally {
      relay.stop()
      server.stop()
    }
  })

  test('caps how many sessions one address may hold', async () => {
    const server = await echoServer()
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: server.port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 1,
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

describe('the origin check', () => {
  const request = (origin?: string) =>
    new Request('https://relay.example.com/', {
      headers: origin ? { origin } : {},
    })
  test('allows an origin on the list and refuses every other', () => {
    expect(
      originAllowed(request('https://platform.example.com'), ['https://platform.example.com'])
    ).toBe(true)
    expect(
      originAllowed(request('https://other.example.com'), ['https://platform.example.com'])
    ).toBe(false)
    expect(originAllowed(request(), ['https://platform.example.com'])).toBe(false)
    expect(originAllowed(request('https://other.example.com'), [])).toBe(true)
  })
})
