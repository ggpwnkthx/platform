import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { type AddressInfo, connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTlsServer } from 'node:tls'
import {
  addressList,
  clientAddress,
  originAllowed,
  relayOptionsFromEnv,
  startRelay,
  startupPacketIn,
} from '../src/relay.ts'

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

/** A TCP server that counts the connections it is given, and answers as the echo does. */
function countingServer(): { port: number; connections: () => number; stop: () => void } {
  let connections = 0
  const server = Bun.listen({
    port: 0,
    hostname: '127.0.0.1',
    socket: {
      open() {
        connections++
      },
      data(socket, data) {
        socket.write(data)
      },
    },
  })
  return { port: server.port, connections: () => connections, stop: () => server.stop(true) }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

describe('a side that falls behind', () => {
  test('a browser that does not read stops the relay reading PostgreSQL, and loses nothing', async () => {
    // A PostgreSQL that signs the session in and then sends as much as it is allowed to.
    const total = 64 * 1024 * 1024
    let written = 0
    const upstream = createServer((socket) => {
      socket.once('data', () => {
        socket.write(authenticationOk())
        socket.write(parameterStatus('session_authorization', 'alice@example.com'))
        const piece = dataRow('x'.repeat(1024 * 1024))
        const more = () => {
          while (written < total) {
            written += piece.length
            if (!socket.write(piece)) return
          }
        }
        socket.on('drain', more)
        more()
      })
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const relay = startRelay({
      upstream: { host: '127.0.0.1', port: (upstream.address() as AddressInfo).port },
      port: 0,
      allowedOrigins: [],
      sessionsPerAddress: 20,
      sessionsPerRole: 20,
    })
    // A browser that opens a session, logs in and never reads what it is sent.
    const browser = connect({ host: '127.0.0.1', port: relay.port })
    try {
      await new Promise((resolve) => browser.once('connect', resolve))
      browser.write(
        'GET / HTTP/1.1\r\nHost: relay\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
      )
      await new Promise((resolve) => browser.once('data', resolve))
      browser.pause()
      const packet = startupPacket('alice@example.com')
      // One binary frame, masked with zeros as a client's frames must be masked.
      browser.write(Buffer.concat([Buffer.from([0x82, 0x80 | packet.length, 0, 0, 0, 0]), packet]))
      // PostgreSQL is stopped long before it has sent everything, and stays stopped.
      await pause(500)
      const held = written
      expect(held).toBeLessThan(total / 2)
      await pause(300)
      expect(written).toBe(held)
      // The session was kept, and nothing of it was dropped: a browser that reads again is
      // sent all of it.
      let received = 0
      const all = new Promise<void>((resolve, reject) => {
        browser.on('data', (data) => {
          received += data.length
          if (received >= total) resolve()
        })
        browser.on('close', () => reject(new Error(`The session ended after ${received} bytes`)))
      })
      browser.resume()
      await all
    } finally {
      browser.destroy()
      relay.stop()
      upstream.close()
    }
  })
})

/** A certificate for localhost and its key, made for the test: null where openssl is absent. */
function certificate(): { cert: string; key: string } | null {
  const dir = mkdtempSync(join(tmpdir(), 'relay-tls-'))
  try {
    const made = Bun.spawnSync(
      [
        'openssl',
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdout: 'ignore', stderr: 'ignore' }
    )
    if (made.exitCode !== 0) return null
    return {
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
    }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

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

describe('the first packet of a session', () => {
  test('is a startup packet of protocol 3, whole or not yet', () => {
    const packet = startupPacket('alice@example.com')
    expect(startupPacketIn(packet)).toBe('whole')
    expect(startupPacketIn(packet.subarray(0, 4))).toBe('partial')
    expect(startupPacketIn(packet.subarray(0, packet.length - 1))).toBe('partial')
    // Protocol 3.2, as libpq 18 may ask for it.
    expect(startupPacketIn(Buffer.concat([int32(9), int32(196610), Buffer.alloc(1)]))).toBe('whole')
  })

  test('is nothing else: no request for TLS, no cancel, no length PostgreSQL would not read', () => {
    expect(startupPacketIn(Buffer.concat([int32(8), int32(80877103)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(8), int32(80877104)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(16), int32(80877102)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(10001), int32(196608)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(4), int32(196608)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(-1), int32(196608)]))).toBe('refused')
  })
})

describe('the options a deployment sets', () => {
  const env = {
    RELAY_UPSTREAM: 'postgres:5432',
    RELAY_UPSTREAM_TLS: 'off',
    RELAY_ORIGINS: 'https://platform.example.com/',
  }

  test('have defaults that keep a login short and counted', () => {
    const options = relayOptionsFromEnv(env)
    expect(options.sessionsLoggingIn).toBe(64)
    expect(options.loginTimeoutMs).toBe(30000)
    expect(options.trustedProxies).toEqual([])
    expect(options.upstream).toEqual({ host: 'postgres', port: 5432 })
    expect(options.allowedOrigins).toEqual(['https://platform.example.com'])
  })

  test('check no origin when the deployment names none, or says any', () => {
    expect(relayOptionsFromEnv({ ...env, RELAY_ORIGINS: undefined }).allowedOrigins).toEqual([])
    expect(relayOptionsFromEnv({ ...env, RELAY_ORIGINS: '*' }).allowedOrigins).toEqual([])
    expect(() => relayOptionsFromEnv({ ...env, RELAY_ORIGINS: '*, https://a.example' })).toThrow(
      'alone'
    )
  })

  test('reach a PostgreSQL on another machine in the clear only when the deployment says so', () => {
    const elsewhere = { ...env, RELAY_UPSTREAM_TLS: undefined }
    expect(() => relayOptionsFromEnv(elsewhere)).toThrow('RELAY_UPSTREAM_TLS')
    // On this machine the stream crosses no network.
    for (const here of ['127.0.0.1:5432', 'localhost:5432'])
      expect(relayOptionsFromEnv({ ...elsewhere, RELAY_UPSTREAM: here }).upstream.tls).toBe(
        undefined
      )
  })

  test('name the proxies to believe and ask for TLS to PostgreSQL', () => {
    const options = relayOptionsFromEnv({
      ...env,
      RELAY_TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.1',
      RELAY_UPSTREAM_TLS: 'verify',
      RELAY_LOGIN_SECONDS: '10',
    })
    expect(options.trustedProxies).toEqual(['10.0.0.0/8', '192.168.1.1'])
    expect(options.upstream).toEqual({ host: 'postgres', port: 5432, tls: {} })
    expect(options.loginTimeoutMs).toBe(10000)
  })

  test('refuse what they cannot mean', () => {
    expect(() => relayOptionsFromEnv({ ...env, RELAY_TRUSTED_PROXIES: 'ingress' })).toThrow('CIDR')
    expect(() => relayOptionsFromEnv({ ...env, RELAY_UPSTREAM_TLS: 'maybe' })).toThrow('verify')
    expect(() => relayOptionsFromEnv({ ...env, RELAY_UPSTREAM_CA: '/ca.pem' })).toThrow('verify')
    expect(() => relayOptionsFromEnv({ ...env, RELAY_LOGIN_SECONDS: '0' })).toThrow('seconds')
  })
})
