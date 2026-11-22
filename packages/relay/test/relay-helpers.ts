/**
 * The world the relay's own tests are written against: a PostgreSQL that signs a session in
 * and says who it signed it in as, and the tools a test needs to open a session.
 */

/** A TCP server that answers with the bytes it is given, one for one. */
export function echoServer(): Promise<{ port: number; stop: () => void }> {
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
 * A server that signs a session in, and says who it signed it in as: the relay reads that
 * one setting, and nothing else. The bytes that carry it are written the way the server
 * writes them.
 */
function signing(
  role: (packet: Buffer) => string | null,
  write: (socket: { write: (bytes: Buffer) => void }, role: string) => void
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
        const name = role(data)
        socket.write(authenticationOk())
        write(socket, name ?? 'unknown@example.com')
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

/** A PostgreSQL that signs a session in and says who it signed it in as. */
export const signingServer = (as: string | null) =>
  signing(
    (packet) => as ?? roleIn(packet),
    (socket, role) => {
      socket.write(parameterStatus('session_authorization', role))
      socket.write(readyForQuery())
    }
  )

/**
 * A PostgreSQL that reports the role in pieces and then sends a large result: the relay
 * reads the setting out of a stream that does not arrive neatly.
 */
export const awkwardServer = (role: string) =>
  signing(
    () => role,
    (socket, name) => {
      const setting = parameterStatus('session_authorization', name)
      socket.write(setting.subarray(0, 5))
      socket.write(setting.subarray(5))
      socket.write(dataRow('x'.repeat(200000)))
    }
  )

/** The role a startup packet asks for. */
function roleIn(packet: Buffer): string {
  const text = packet.subarray(8).toString('utf8')
  const at = text.indexOf('user\0')
  if (at < 0) return 'unknown@example.com'
  const end = text.indexOf('\0', at + 5)
  return text.slice(at + 5, end)
}

/** A row message with one long value: the relay steps over it rather than copying it. */
export const dataRow = (value: string) => {
  const body = Buffer.concat([int16(1), int32(0), Buffer.from(value, 'utf8')])
  return Buffer.concat([Buffer.from('D'), int32(body.length + 4), body])
}

/** The message PostgreSQL sends when it has accepted the sign-in. */
export const authenticationOk = () => Buffer.concat([Buffer.from('R'), int32(8), int32(0)])

/** The message PostgreSQL sends for each setting it reports. */
export const parameterStatus = (key: string, value: string) => {
  const body = Buffer.concat([Buffer.from(`${key}\0${value}\0`, 'utf8')])
  return Buffer.concat([Buffer.from('S'), int32(body.length + 4), body])
}

/** The message PostgreSQL sends when the session is ready for a statement. */
const readyForQuery = () => Buffer.concat([Buffer.from('Z'), int32(5), Buffer.from('I')])

/** The startup packet a client sends to name the role it wants to be. */
export function startupPacket(user: string): Buffer {
  const body = Buffer.from(`user\0${user}\0database\0platform\0\0`, 'utf8')
  return Buffer.concat([int32(body.length + 8), int32(196608), body])
}

/** Opens a session to the relay, and waits for it to be open. */
export const open = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => resolve(socket)
    socket.onerror = () => reject(new Error('The relay refused the session'))
  })

/** The close a session gets, when it gets one. */
export const closed = (socket: WebSocket): Promise<CloseEvent> =>
  new Promise((resolve) => {
    socket.onclose = (event) => resolve(event)
  })

/** A number, as PostgreSQL writes it. */
export const int32 = (value: number) => {
  const bytes = Buffer.alloc(4)
  bytes.writeInt32BE(value)
  return bytes
}

/** A small number, as PostgreSQL writes it. */
const int16 = (value: number) => {
  const bytes = Buffer.alloc(2)
  bytes.writeInt16BE(value)
  return bytes
}
