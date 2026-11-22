import { describe, expect, test } from 'bun:test'
import { pause } from './relay-server.ts'
import { type AddressInfo, connect, createServer } from 'node:net'
import { startRelay } from '../src/relay.ts'
import { authenticationOk, dataRow, parameterStatus, startupPacket } from './relay-helpers.ts'

/**
 * A side that falls behind.
 */

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
