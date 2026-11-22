import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The servers the relay's tests are written against: one that counts the connections it is
 * given, and the certificate a TLS test needs.
 */

export function countingServer(): { port: number; connections: () => number; stop: () => void } {
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

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A certificate for localhost and its key, made for the test: null where openssl is absent. */
export function certificate(): { cert: string; key: string } | null {
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
