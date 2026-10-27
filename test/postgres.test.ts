import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTAINER_IMAGE,
  DEVELOPMENT_MAJOR,
  localBinaries,
  speaksPostgres,
  startPostgres,
  startPostgresContainer,
} from '../tooling/postgres'

/**
 * The PostgreSQL of the development machine in a container.
 *
 * The machine of a developer has no binaries of PostgreSQL, and the
 * server of the development machine runs in a container. The runtime of
 * the containers is replaced by a script that writes the commands it
 * is given: the test proves the commands of the container and the way
 * the container is stopped, and it needs no runtime of the containers.
 */

const runtime = process.env.PLATFORM_CONTAINER_RUNTIME
const log = process.env.PLATFORM_CONTAINER_LOG

afterEach(() => {
  if (runtime === undefined) delete process.env.PLATFORM_CONTAINER_RUNTIME
  else process.env.PLATFORM_CONTAINER_RUNTIME = runtime
  if (log === undefined) delete process.env.PLATFORM_CONTAINER_LOG
  else process.env.PLATFORM_CONTAINER_LOG = log
})

/** A runtime of the containers that writes the commands it is given. */
function fakeRuntime(
  directory: string,
  name = 'runtime'
): { path: string; commands: () => string[] } {
  const path = join(directory, name)
  const file = join(directory, 'commands.log')
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'echo "$@" >> "$PLATFORM_CONTAINER_LOG"',
      'case "$1" in',
      '  run) echo "a-container" ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n')
  )
  chmodSync(path, 0o755)
  writeFileSync(file, '')
  return {
    path,
    commands: () =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
  }
}

/** A port that accepts a connection. */
async function listeningPort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve(port)
    })
  })
}

/**
 * A port that speaks the protocol of PostgreSQL.
 *
 * The server answers the startup message with the request of the
 * authentication, which is what a server of PostgreSQL does.
 */
async function speakingPort(): Promise<number> {
  const server = createServer((socket) => {
    socket.on('data', () => {
      socket.write('R')
    })
  })
  return await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve(port)
    })
  })
}

describe('the PostgreSQL of the development machine in a container', () => {
  test('the container runs the image of the major of the development machine', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-postgres-'))
    const fake = fakeRuntime(directory)
    process.env.PLATFORM_CONTAINER_RUNTIME = fake.path
    process.env.PLATFORM_CONTAINER_LOG = join(directory, 'commands.log')
    const port = await speakingPort()

    const server = await startPostgresContainer({
      name: 'platform-postgres-dev',
      volume: 'platform-postgres-dev',
      port,
    })

    expect(server.kind).toBe('container')
    expect(server.port).toBe(port)
    expect(server.url).toBe(`postgres://data:data@127.0.0.1:${port}/postgres`)
    expect(server.adminUrl).toBe(server.url)

    const commands = fake.commands()
    const run = commands.find((command) => command.startsWith('run ')) ?? ''
    expect(run).toContain(`--name platform-postgres-dev`)
    expect(run).toContain(`--publish 127.0.0.1:${port}:5432`)
    expect(run).toContain('--env POSTGRES_USER=data')
    expect(run).toContain('--env POSTGRES_PASSWORD=data')
    expect(run).toContain(`--volume platform-postgres-dev-${DEVELOPMENT_MAJOR}:/var/lib/postgresql`)
    expect(run).toContain(`${CONTAINER_IMAGE}:${DEVELOPMENT_MAJOR}`)

    server.stop()
  })

  test('the container is stopped with the signal of the image', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-postgres-'))
    const fake = fakeRuntime(directory)
    process.env.PLATFORM_CONTAINER_RUNTIME = fake.path
    process.env.PLATFORM_CONTAINER_LOG = join(directory, 'commands.log')
    const port = await speakingPort()

    const server = await startPostgresContainer({
      name: 'platform-postgres-dev',
      port,
    })

    server.stop()
    server.stop()

    const commands = fake.commands()
    expect(commands).toContain('stop --time 30 platform-postgres-dev')
    // The container is removed once, and the second stop of the server
    // does not remove it again.
    expect(
      commands.filter((command) => command === 'rm --force platform-postgres-dev')
    ).toHaveLength(1)
  })

  test.skipIf(localBinaries() !== null)(
    'the machine without the binaries starts the server in a container',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'platform-postgres-'))
      const fake = fakeRuntime(directory)
      process.env.PLATFORM_CONTAINER_RUNTIME = fake.path
      process.env.PLATFORM_CONTAINER_LOG = join(directory, 'commands.log')
      const port = await speakingPort()

      const server = await startPostgres({
        dataDir: join(directory, 'data'),
        port,
        container: { name: 'platform-postgres-dev' },
      })

      expect(server.kind).toBe('container')

      server.stop()
    }
  )

  test('the runtime of the containers is the one that the machine has', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-postgres-'))
    const fake = fakeRuntime(directory, 'podman')
    const path = process.env.PATH
    delete process.env.PLATFORM_CONTAINER_RUNTIME
    process.env.PLATFORM_CONTAINER_LOG = join(directory, 'commands.log')
    // The path of the machine holds the runtime and nothing else: the
    // machine has podman and no docker.
    process.env.PATH = directory
    try {
      const port = await speakingPort()
      const server = await startPostgresContainer({
        name: 'platform-postgres-dev',
        port,
      })
      expect(server.kind).toBe('container')
      server.stop()
    } finally {
      process.env.PATH = path
    }
    expect(fake.commands().length).toBeGreaterThan(0)
  })
})

/**
 * A port that accepts a connection and resets it.
 *
 * It is what the proxy of a container does when the server of the
 * container does not listen on the network yet.
 */
async function resettingPort(): Promise<number> {
  const server = createServer((socket) => {
    socket.destroy()
  })
  return await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve(port)
    })
  })
}

/**
 * The readiness of a port of the machine.
 *
 * A port that accepts a connection is not a port that answers: the
 * proxy of a container accepts the connection of the machine and resets
 * it when the server of the container does not listen on the network
 * yet, which is what the image of PostgreSQL does while it initializes
 * the data directory of a fresh volume.
 */
describe('the readiness of a port of the machine', () => {
  test('a port that speaks the protocol of PostgreSQL is ready', async () => {
    const port = await speakingPort()
    expect(await speaksPostgres(port)).toBe(true)
  })

  test('a port that accepts a connection and does not speak is not ready', async () => {
    const port = await listeningPort()
    expect(await speaksPostgres(port)).toBe(false)
  })

  test('a port that resets the connection is not ready', async () => {
    const port = await resettingPort()
    expect(await speaksPostgres(port)).toBe(false)
  })
})
