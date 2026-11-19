import { ConnectionError, type Transport } from './wire.ts'

/**
 * The browser's way to the database: a WebSocket to the relay, which forwards the bytes to
 * PostgreSQL's port and back. The relay holds no credentials and reads nothing it carries;
 * the token inside the stream is checked by PostgreSQL alone.
 */
export function openSocket(url: string, timeoutMs = 10000): Promise<Transport> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      reject(new ConnectionError(`The database relay address is not valid: ${url}`))
      return
    }
    socket.binaryType = 'arraybuffer'
    let open = false
    const timer = setTimeout(() => {
      if (open) return
      socket.close()
      reject(new ConnectionError('The database relay did not answer in time'))
    }, timeoutMs)
    const transport: Transport = {
      send: (bytes) => socket.send(bytes as Uint8Array<ArrayBuffer>),
      close: () => socket.close(),
      ondata: null,
      onclose: null,
    }
    socket.onopen = () => {
      open = true
      clearTimeout(timer)
      resolve(transport)
    }
    socket.onmessage = (event) => {
      const data = event.data
      if (data instanceof ArrayBuffer) transport.ondata?.(new Uint8Array(data))
    }
    socket.onerror = () => {
      if (!open) {
        clearTimeout(timer)
        reject(new ConnectionError('The database relay could not be reached'))
      }
    }
    socket.onclose = (event) => {
      // The relay closes a session it refuses with 1008, and says why.
      const refused = event.code === 1008 ? event.reason : ''
      if (!open) {
        clearTimeout(timer)
        reject(
          new ConnectionError(
            refused
              ? `The database relay refused the session: ${refused}`
              : 'The database relay could not be reached'
          )
        )
        return
      }
      transport.onclose?.(
        refused
          ? new ConnectionError(`The database relay refused the session: ${refused}`)
          : new ConnectionError('The connection to the database closed')
      )
    }
  })
}
