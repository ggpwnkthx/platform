import { createServer, type Server } from 'node:net'
import { startRelay } from '@platform/relay'

/**
 * The stands the relay's tests need: a PostgreSQL that speaks enough of the protocol to
 * hold a session open, and a relay in front of it.
 */

/**
 * A stand-in for PostgreSQL 18's token login, enough of the protocol to prove what the page
 * sends: it asks for OAUTHBEARER, and lets in the one token it knows, as the role it names.
 */
export function tokenServer(
  accept: string
): Promise<{ server: Server; port: number; seen: string[] }> {
  const message = (type: string, body: Buffer) => {
    const head = Buffer.alloc(5)
    head.write(type)
    head.writeInt32BE(body.length + 4, 1)
    return Buffer.concat([head, body])
  }
  const int = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeInt32BE(n)
    return b
  }
  const seen: string[] = []
  const server = createServer((socket) => {
    let started = false
    socket.on('data', (data: Buffer) => {
      if (!started) {
        started = true
        seen.push(data.subarray(8).toString().split('\0').join(' '))
        return socket.write(message('R', Buffer.concat([int(10), Buffer.from('OAUTHBEARER\0\0')])))
      }
      if (data.toString('latin1', 0, 1) !== 'p') return
      const said = data.toString()
      seen.push(said.slice(said.indexOf('n,,')))
      if (said.includes(`auth=Bearer ${accept}\x01\x01`))
        socket.write(Buffer.concat([message('R', int(0)), message('Z', Buffer.from('I'))]))
      else
        socket.end(
          message('E', Buffer.from('SFATAL\0C28000\0MOAuth bearer authentication failed\0\0'))
        )
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as { port: number }).port, seen })
    )
  )
}

export const relays: { stop(): void }[] = []
export const relayTo = (port: number, allowedOrigins: string[] = []) => {
  const relay = startRelay({ upstream: { host: '127.0.0.1', port }, port: 0, allowedOrigins })
  relays.push(relay)
  return `ws://127.0.0.1:${relay.port}/`
}
export const stopRelays = () => {
  for (const relay of relays) relay.stop()
  relays.length = 0
}

/** A startup packet, as PostgreSQL reads it: the role the client asks to be logged in as. */
export const startup = (user: string) => {
  const params = Buffer.from(`user\0${user}\0\0`, 'latin1')
  const head = Buffer.alloc(8)
  head.writeInt32BE(8 + params.length, 0)
  head.writeInt32BE(196608, 4)
  return Buffer.concat([head, params])
}
