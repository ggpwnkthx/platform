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

/**
 * A PostgreSQL that signs a session in and says who it signed it in as: the relay reads
 * that one setting, and nothing else. The role is the one the client asked for, unless
 * the server is told to name another.
 */
function signingServer(
  as: string | null
): Promise<{ port: number; signed: Promise<void>; stop: () => void }> {
  let signed: () => void = () => undefined
  const isSigned = new Promise<void>((resolve) => {
    signed = resolve
  })
  const server = Bun.listen({
    port: 0,
    hostname: '127.0.0.1',
    socket: {
      data(socket, data) {
        if (data.length < 8) return
        const length = data.readInt32BE(0)
        if (data.length < length) return
        if (data.readInt32BE(4) !== 196608) return
        const role = as ?? roleIn(data)
        socket.write(authenticationOk())
        socket.write(parameterStatus('session_authorization', role))
        socket.write(readyForQuery())
        signed()
      },
    },
  })
  return Promise.resolve({
    port: server.port,
    signed: isSigned,
    stop: () => {
      server.stop(true)
    },
  })
}

/** The role a startup packet asks for. */
function roleIn(packet: Buffer): string {
  const text = packet.subarray(8).toString('utf8')
  const at = text.indexOf('user\0')
  if (at < 0) return 'unknown@example.com'
  const end = text.indexOf('\0', at + 5)
  return text.slice(at + 5, end)
}

/** A row message with one long value: the relay steps over it rather than copying it. */
const dataRow = (value: string) => {
  const body = Buffer.concat([int16(1), int32(0), Buffer.from(value, 'utf8')])
  return Buffer.concat([Buffer.from('D'), int32(body.length + 4), body])
}

/**
 * A PostgreSQL that reports the role in pieces and then sends a large result: the relay
 * reads the setting out of a stream that does not arrive neatly.
 */
function awkwardServer(
  role: string
): Promise<{ port: number; signed: Promise<void>; stop: () => void }> {
  let signed: () => void = () => undefined
  const isSigned = new Promise<void>((resolve) => {
    signed = resolve
  })
  const server = Bun.listen({
    port: 0,
    hostname: '127.0.0.1',
    socket: {
      data(socket, data) {
        if (data.length < 8) return
        const length = data.readInt32BE(0)
        if (data.length < length) return
        socket.write(authenticationOk())
        const setting = parameterStatus('session_authorization', role)
        socket.write(setting.subarray(0, 5))
        socket.write(setting.subarray(5))
        socket.write(dataRow('x'.repeat(200000)))
        signed()
      },
    },
  })
  return Promise.resolve({
    port: server.port,
    signed: isSigned,
    stop: () => {
      server.stop(true)
    },
  })
}

const int32 = (value: number) => {
  const bytes = Buffer.alloc(4)
  bytes.writeInt32BE(value)
  return bytes
}

const int16 = (value: number) => {
  const bytes = Buffer.alloc(2)
  bytes.writeInt16BE(value)
  return bytes
}

/** The message PostgreSQL sends when it has accepted the sign-in. */
const authenticationOk = () => Buffer.concat([Buffer.from('R'), int32(8), int32(0)])

/** The message PostgreSQL sends for each setting it reports. */
const parameterStatus = (key: string, value: string) => {
  const body = Buffer.concat([Buffer.from(`${key}\0${value}\0`, 'utf8')])
  return Buffer.concat([Buffer.from('S'), int32(body.length + 4), body])
}

/** The message PostgreSQL sends when the session is ready for a statement. */
const readyForQuery = () => Buffer.concat([Buffer.from('Z'), int32(5), Buffer.from('I')])

/** The startup packet a client sends to name the role it wants to be. */
function startupPacket(user: string): Buffer {
  const body = Buffer.from(`user\0${user}\0database\0platform\0\0`, 'utf8')
  return Buffer.concat([int32(body.length + 8), int32(196608), body])
}

const open = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => resolve(socket)
    socket.onerror = () => reject(new Error('The relay refused the session'))
  })

/** The close a session gets, when it gets one. */
const closed = (socket: WebSocket): Promise<CloseEvent> =>
  new Promise((resolve) => {
    socket.onclose = (event) => resolve(event)
  })

describe('the relay', () => {
  test('carries the bytes in both directions, and understands none of them', async () => {
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
