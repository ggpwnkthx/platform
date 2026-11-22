import type { Transport } from '../src/wire.ts'

/**
 * A PostgreSQL server, for the client to talk to.
 *
 * It speaks the protocol itself: the startup packet without a type byte, the messages of a
 * statement with one, and the server's own answers. It is what the client is checked
 * against, so that the client may be changed without a database to hand.
 */

const encoder = new TextEncoder()

/** One message: a type byte, then a length that counts itself and the body. */
function message(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + body.length)
  const view = new DataView(out.buffer)
  out[0] = type.charCodeAt(0)
  view.setInt32(1, body.length + 4)
  out.set(body, 5)
  return out
}

function cstring(text: string): Uint8Array {
  return encoder.encode(`${text}\0`)
}

function int32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setInt32(0, value)
  return out
}

function int16(value: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setInt16(0, value)
  return out
}

function join(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export type FakeColumn = { name: string; type: number }

export type FakeServer = {
  port: number
  /** The settings the client named in its startup packet. */
  startup: () => Record<string, string>
  /** The types of the messages the client sent, in order. */
  sent: string[]
  /** What the client offered as its sign-in, when it was asked for one. */
  offered: () => string | null
  stop: () => void
}

export type FakeServerOptions = {
  /** The columns a statement answers with. */
  columns?: FakeColumn[]
  /** The rows a statement answers with. */
  rows?: unknown[][]
  /** The error a statement is refused with, when it is refused. */
  error?: { code: string; message: string }
  /** Whether the server asks for the sign-in token, as PostgreSQL 18 does. */
  token?: boolean
}

/** A server that answers as PostgreSQL does. */
export function startServer(options: FakeServerOptions = {}): FakeServer {
  const sent: string[] = []
  let startup: Record<string, string> = {}
  let offered: string | null = null
  let buffer = new Uint8Array(0)
  let started = false

  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket, chunk) {
        buffer = new Uint8Array([...buffer, ...new Uint8Array(chunk)])
        // The startup packet has no type byte: it is a length and a body.
        if (!started) {
          if (buffer.length < 4) return
          const length = new DataView(buffer.buffer, buffer.byteOffset).getInt32(0)
          // The length counts itself: the whole packet is that many bytes.
          if (buffer.length < length) return
          // The packet is a length, the protocol version, and then the settings.
          const body = new TextDecoder().decode(buffer.subarray(8, length))
          // The startup packet is a list of names and values, each ended by a NUL.
          const words = body.split('\0')
          startup = {}
          for (let at = 0; at + 1 < words.length; at += 2)
            if (words[at]) startup[words[at]!] = words[at + 1]!
          buffer = buffer.subarray(length)
          started = true
          // The server asks for the sign-in token, or lets the client in.
          socket.write(
            Buffer.from(
              join(
                options.token
                  ? [message('R', join([int32(10), cstring('OAUTHBEARER'), cstring('')]))]
                  : [
                      message('R', int32(0)),
                      message('S', join([cstring('server_version'), cstring('17.0')])),
                      message('K', join([int32(1), int32(2)])),
                      message('Z', encoder.encode('I')),
                    ]
              )
            )
          )
        }
        while (buffer.length >= 5) {
          const type = String.fromCharCode(buffer[0]!)
          const length = new DataView(buffer.buffer, buffer.byteOffset + 1).getInt32(0)
          if (buffer.length < length + 1) break
          const body = buffer.subarray(5, length + 1)
          buffer = buffer.subarray(length + 1)
          sent.push(type)
          answer(socket, type, body)
        }
      },
    },
  })

  function answer(socket: { write: (bytes: Uint8Array) => void }, type: string, body: Uint8Array) {
    const write = (bytes: Uint8Array) => socket.write(Buffer.from(bytes))
    switch (type) {
      case 'P': // Parse
        return write(message('1', new Uint8Array(0)))
      case 'B': // Bind
        return write(message('2', new Uint8Array(0)))
      case 'D': // Describe
        return write(message('T', rowDescription(options.columns ?? [])))
      case 'E': // Execute
        if (options.error) {
          write(
            message(
              'E',
              join([
                new Uint8Array([0x53]),
                cstring('ERROR'),
                new Uint8Array([0x43]),
                cstring(options.error.code),
                new Uint8Array([0x4d]),
                cstring(options.error.message),
                new Uint8Array([0]),
              ])
            )
          )
          return
        }
        for (const row of options.rows ?? []) write(message('D', dataRow(row)))
        return write(message('C', cstring('SELECT 1')))
      case 'S': // Sync
        return write(message('Z', encoder.encode('I')))
      case 'p': // The sign-in token
        offered = new TextDecoder().decode(body)
        write(message('R', int32(12)))
        return write(message('Z', encoder.encode('I')))
      case 'X': // Terminate
        return socket.write(Buffer.from([]))
    }
  }

  return {
    port: server.port,
    startup: () => startup,
    sent,
    offered: () => offered,
    stop: () => server.stop(true),
  }
}

function rowDescription(columns: FakeColumn[]): Uint8Array {
  const parts: Uint8Array[] = [int16(columns.length)]
  for (const column of columns)
    parts.push(
      cstring(column.name),
      int32(0), // the table the column comes from
      int16(0), // its number in that table
      int32(column.type),
      int16(-1), // the type's size
      int32(-1), // the type's modifier
      int16(0) // the text format
    )
  return join(parts)
}

function dataRow(row: unknown[]): Uint8Array {
  const parts: Uint8Array[] = [int16(row.length)]
  for (const value of row) {
    if (value === null) {
      parts.push(int32(-1))
      continue
    }
    const bytes = encoder.encode(String(value))
    parts.push(int32(bytes.length), bytes)
  }
  return join(parts)
}

/** A transport that carries the bytes to a server over TCP. */
export async function transport(port: number): Promise<Transport> {
  const carrier: Transport = {
    send: (bytes) => socket.write(bytes),
    close: () => socket.end(),
    ondata: null,
    onclose: null,
  }
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_socket, data) {
        carrier.ondata?.(new Uint8Array(data))
      },
      close() {
        carrier.onclose?.(null)
      },
      error() {},
    },
  })
  return carrier
}
