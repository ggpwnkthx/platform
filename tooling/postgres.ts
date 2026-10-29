#!/usr/bin/env bun
/**
 * The PostgreSQL of the development machine and of the tests.
 *
 * The script starts a PostgreSQL server in a directory of the working
 * tree, with a socket of its own and a port of its own. It is used by
 * the development stack and by the integration tests: the tests need a
 * real server, because the isolation, the locking and the claims of the
 * workers are the behaviour of a server and not of an embedded engine.
 *
 * The server of the working tree needs the binaries of PostgreSQL on
 * the machine. A machine without them starts the server in a container
 * instead: the image of the server is the one of the official
 * PostgreSQL, and the container is stopped when the run that started
 * it ends. The two ways of running the server answer the same way: the
 * url of the server, the url of its administrator and the way to stop
 * it.
 *
 * The development machine, the tests and the continuous integration use
 * the version `DEVELOPMENT_MAJOR`. A deployment may run an older major:
 * the requirement of a deployment is in `README.md`, and it is not
 * checked here.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { join, resolve } from 'node:path'

/**
 * The image of the PostgreSQL server of a container.
 *
 * The name is the full name of the image: a runtime that does not
 * guess the registry of a short name needs it.
 */
export const CONTAINER_IMAGE = 'docker.io/library/postgres'

/**
 * The runtimes of the containers that the platform knows.
 *
 * Docker is the runtime of a machine that has it, and podman is the
 * runtime of a machine that has podman instead.
 */
const RUNTIMES = ['docker', 'podman']

/**
 * The way out of a machine that has no runtime of containers.
 *
 * A machine that has the binaries of PostgreSQL does not need a runtime
 * of containers: the server of the development machine starts with the
 * binaries, and the container is the fallback of a machine that has
 * none.
 */
const WITHOUT_CONTAINER =
  'A machine that has the binaries of PostgreSQL does not need a runtime of containers: ' +
  'the server of the development machine starts with them.'

/**
 * The runtime of the containers of the development machine.
 *
 * The environment names it, and the machine that names nothing is
 * asked: the first runtime of the list that is on the machine is the
 * runtime of the run. The answer of the machine is kept with the path
 * it was found in, and it is asked again when the path changes.
 */
let detected: { path: string; runtime: string } | undefined

function runtimeName(): string {
  const named = process.env.PLATFORM_CONTAINER_RUNTIME
  if (named) return named
  const path = process.env.PATH ?? ''
  if (detected?.path !== path) {
    detected = { path, runtime: RUNTIMES.find((candidate) => answers(candidate)) ?? RUNTIMES[0]! }
  }
  return detected.runtime
}

/**
 * The label of the containers of the platform.
 *
 * It names the role of the container, and it is what the leftovers of
 * a run that did not stop are found with.
 */
const CONTAINER_LABEL = 'com.platform.postgres'

/**
 * The label of the role of a container.
 *
 * The leftovers of a run are the containers of the same role: the
 * machine of the development and the tests of Data are two
 * roles, and one of them never removes the container of the other.
 */
const CONTAINER_ROLE_LABEL = 'com.platform.postgres.role'

/**
 * The major of PostgreSQL that the development machine, the tests and
 * the continuous integration use.
 *
 * It is the newest major that the repository proves, and it is not the
 * requirement of a deployment: a deployment may run an older major, and
 * the suites of the floor prove it.
 */
export const DEVELOPMENT_MAJOR = 18

/**
 * The major that the machine asks for.
 *
 * It is the way the continuous integration proves the floor of the
 * deployments: the suites run against the version of the development
 * machine and against the oldest major that a deployment may run.
 */
function requestedMajor(): number | null {
  const requested = process.env.POSTGRES_MAJOR
  if (!requested) return null
  if (!/^\d+$/.test(requested)) {
    throw new Error(`the major of PostgreSQL is not a number: ${requested}`)
  }
  return Number(requested)
}

/** The candidates for the binaries of PostgreSQL, the newest first. */
const BINARIES = [
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/15/bin',
  '/usr/lib/postgresql/14/bin',
  '/usr/local/pgsql/bin',
  '/opt/homebrew/opt/postgresql@18/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
]

/**
 * The directory of the binaries of PostgreSQL.
 *
 * It is null when the machine has no binaries: the server of the
 * development machine is then started in a container.
 */
export function localBinaries(): string | null {
  const requested = requestedMajor()
  if (requested !== null) {
    const candidate = `/usr/lib/postgresql/${requested}/bin`
    return existsSync(join(candidate, 'initdb')) ? candidate : null
  }
  for (const candidate of BINARIES) {
    if (existsSync(join(candidate, 'initdb'))) return candidate
  }
  return null
}

/** The directory of the binaries of PostgreSQL. */
export function binaries(): string {
  const requested = requestedMajor()
  if (requested !== null) {
    const candidate = `/usr/lib/postgresql/${requested}/bin`
    if (existsSync(join(candidate, 'initdb'))) return candidate
    throw new Error(`the binaries of the PostgreSQL ${requested} were not found`)
  }
  const found = localBinaries()
  if (!found) throw new Error('the binaries of PostgreSQL were not found')
  return found
}

/**
 * The major of the server of a directory of binaries.
 *
 * It is null when the binaries do not answer: the version is then
 * unknown, and it is not guessed.
 */
export function majorOf(bin: string): number | null {
  const version = spawnSync(join(bin, 'postgres'), ['--version'], { encoding: 'utf8' })
  if (version.status !== 0) return null
  const match = /\(\s*PostgreSQL\)\s+(\d+)\./.exec(version.stdout)
  return match ? Number(match[1]) : null
}

/** Finds a free port. */
export async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** A PostgreSQL server of the development machine. */
export interface StartedPostgres {
  /** The url of the server, with the superuser of the development machine. */
  readonly url: string
  /** The port of the server. */
  readonly port: number
  /** The directory of the data. It is empty for a server in a container. */
  readonly dataDir: string
  /** The way the server runs: in the working tree, or in a container. */
  readonly kind: 'local' | 'container'
  /** The url of the administrator of the server. */
  readonly adminUrl: string
  /** Stops the server. */
  stop: () => void
}

/** The options of the container of a server. */
export interface PostgresContainerOptions {
  /** The name of the container. */
  readonly name?: string
  /**
   * The role of the container.
   *
   * The containers of a role are the ones a run of that role removes
   * when it starts.
   */
  readonly role?: string
  /**
   * The base name of the volume that holds the data of the server.
   *
   * The major of the server is part of the name of the volume: the data
   * of a server of another major is not the data of this server.
   */
  readonly volume?: string
  /** The port of the server on the machine. */
  readonly port?: number
  /** The user of the administrator of the server. */
  readonly user?: string
  /** The password of the administrator of the server. */
  readonly password?: string
  /** The major of the server of the container. */
  readonly major?: number
  /** Removes the data of a previous run. */
  readonly fresh?: boolean
}

/** The options of the server. */
export interface PostgresOptions {
  /** The directory of the data. */
  readonly dataDir?: string
  /** The port of the server. */
  readonly port?: number
  /** The user of the server. */
  readonly user?: string
  /** The password of the user. */
  readonly password?: string
  /** Removes the data of a previous run. */
  readonly fresh?: boolean
  /**
   * The container that stands in for the binaries of the machine.
   *
   * The container is started only when the machine has no binaries of
   * PostgreSQL: a machine that has them runs the server in the working
   * tree.
   */
  readonly container?: PostgresContainerOptions
}

/**
 * Runs the runtime of the containers and answers with its result.
 *
 * The answer of the runtime is the whole of what it wrote: a developer
 * reads the refusal of the runtime in the message of the failure.
 */
function runtimeOf(args: string[]): { status: number | null; output: string } {
  const result = spawnSync(runtimeName(), args, { encoding: 'utf8' })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

/**
 * Reports whether a runtime of the containers is on the machine.
 *
 * The runtime is asked for its version: the answer does not need a
 * daemon, and a runtime without a daemon answers the question later.
 */
function answers(name: string): boolean {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8' })
  return result.status === 0
}

/**
 * The containers of the platform that are still there.
 *
 * They are the leftovers of a run that did not stop, and the machine of
 * the development has one server.
 */
function leftovers(role: string): string[] {
  const listed = runtimeOf([
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=${CONTAINER_ROLE_LABEL}=${role}`,
  ])
  if (listed.status !== 0) return []
  return listed.output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Waits for the server of a container to answer.
 *
 * The readiness of the server is asked **on the port of the machine**,
 * and not inside the container: the image of PostgreSQL starts a
 * temporary server on the socket alone while it initializes the data
 * directory of a fresh volume, and that server does not listen on the
 * network at all. A check that asks the socket of the container answers
 * during that phase, and the client of the machine then reaches the
 * published port of the container, whose proxy has no upstream to give
 * it: the connection is reset.
 *
 * The check of the container is therefore asked over the network of the
 * container, and the check of the machine asks the server itself: a
 * server that answers the startup message of the protocol is a server
 * that a client of the machine can talk to.
 */
async function waitForPostgres(name: string, user: string, port: number): Promise<void> {
  const deadline = Date.now() + 60_000
  let inside = ''
  while (Date.now() < deadline) {
    // The check of the container is asked over the network of the
    // container: the socket of the container answers during the
    // initialization of the data directory, and the network of the
    // container does not.
    const ready = runtimeOf([
      'exec',
      name,
      'pg_isready',
      '--host',
      '127.0.0.1',
      '--port',
      '5432',
      '--username',
      user,
      '--dbname',
      'postgres',
    ])
    inside = ready.output
    // The check of the machine is the decisive one: the server itself
    // has to answer on the published port.
    if (await speaksPostgres(port, user)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const logs = runtimeOf(['logs', '--tail', '20', name]).output
  throw new Error(
    `the PostgreSQL of the container ${name} did not answer on the port ${port}. ` +
      `The server of the container answers: ${inside || 'nothing'}. ` +
      `The log of the container is: ${logs}`
  )
}

/**
 * The startup message of the protocol of PostgreSQL.
 *
 * The message names the user and the database of the server, and the
 * server answers it with the request of the authentication or with an
 * error: both of them are the proof that the server speaks.
 */
function startupMessage(user: string, database: string): Buffer {
  const pairs = Buffer.from(`user\0${user}\0database\0${database}\0\0`, 'utf8')
  const header = Buffer.alloc(8)
  // The version 3.0 of the protocol.
  header.writeUInt32BE(196608, 0)
  const body = Buffer.concat([header, pairs])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length, 0)
  return Buffer.concat([length, body])
}

/**
 * Reports whether a port of the machine speaks the protocol of
 * PostgreSQL.
 *
 * The answer of the server is the first byte of it: the request of the
 * authentication (`R`) or the error of the server (`E`). A port that
 * accepts the connection and resets it, which is what the proxy of a
 * container does when the server of the container does not listen on
 * the network yet, is not a port that speaks.
 */
export async function speaksPostgres(port: number, user = 'data'): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let answered = false
    const done = (answer: boolean): void => {
      if (answered) return
      answered = true
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(2000)
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
    // A peer that resets the connection closes the socket without
    // answering: the reset of the proxy of a container arrives here.
    socket.on('close', () => done(false))
    socket.on('end', () => done(false))
    socket.on('data', (chunk: Buffer) => {
      const type = chunk.length > 0 ? String.fromCharCode(chunk[0]!) : ''
      done(type === 'R' || type === 'E')
    })
    socket.on('connect', () => {
      socket.write(startupMessage(user, 'postgres'))
    })
  })
}

/**
 * Starts a PostgreSQL server in a container.
 *
 * The container runs the official image of PostgreSQL, and it is
 * stopped when the run that started it ends: the stop is the signal of
 * the image, and the image stops the server with a fast shutdown.
 */
export async function startPostgresContainer(
  options: PostgresContainerOptions = {}
): Promise<StartedPostgres> {
  const major = options.major ?? requestedMajor() ?? DEVELOPMENT_MAJOR
  const user = options.user ?? 'data'
  const password = options.password ?? 'data'
  const port = options.port ?? (await freePort())
  const name = options.name ?? `platform-postgres-${port}`
  const role = options.role ?? 'server'
  const volume = options.volume ? `${options.volume}-${major}` : undefined

  if (!answers(runtimeName())) {
    throw new Error(
      `the runtime of the containers is needed to start the PostgreSQL ${major} of the development machine, ` +
        `and ${runtimeName()} is not on it. The runtimes the platform knows are ${RUNTIMES.join(' and ')}, ` +
        `and PLATFORM_CONTAINER_RUNTIME names the runtime of the run. ${WITHOUT_CONTAINER}`
    )
  }

  // The containers of a run that did not stop are removed: the machine
  // of the development has one server, and it is the one of this run.
  for (const leftover of leftovers(role)) {
    runtimeOf(['rm', '--force', leftover])
  }
  if (options.fresh && volume) {
    runtimeOf(['volume', 'rm', '--force', volume])
  }

  const arguments_ = [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    `${CONTAINER_LABEL}=true`,
    '--label',
    `${CONTAINER_ROLE_LABEL}=${role}`,
    '--publish',
    `127.0.0.1:${port}:5432`,
    '--env',
    `POSTGRES_USER=${user}`,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    'POSTGRES_DB=postgres',
  ]
  if (volume) {
    arguments_.push('--volume', `${volume}:/var/lib/postgresql`)
  }
  arguments_.push(`${CONTAINER_IMAGE}:${major}`)

  const started = runtimeOf(arguments_)
  if (started.status !== 0) {
    throw new Error(
      `the container of the PostgreSQL ${major} did not start: ${started.output}. ` +
        `The runtime of the containers is ${runtimeName()}: the platform knows ${RUNTIMES.join(' and ')}, ` +
        `and PLATFORM_CONTAINER_RUNTIME names the runtime of the run. ${WITHOUT_CONTAINER}`
    )
  }

  try {
    await waitForPostgres(name, user, port)
  } catch (error) {
    // The container of a server that never answered is stopped: the
    // machine of the development has one server, and it is not the one
    // of a container that does not answer.
    runtimeOf(['stop', '--time', '10', name])
    runtimeOf(['rm', '--force', name])
    throw error
  }

  const url = `postgres://${user}:${password}@127.0.0.1:${port}/postgres`
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    // The signal of the stop is the one of the image: it stops the
    // server with a fast shutdown, and the data of the server is
    // written before the container goes away.
    runtimeOf(['stop', '--time', '30', name])
    runtimeOf(['rm', '--force', name])
  }
  return { url, port, dataDir: '', kind: 'container', adminUrl: url, stop }
}

/** Starts a PostgreSQL server. */
export async function startPostgres(options: PostgresOptions = {}): Promise<StartedPostgres> {
  const container = options.container
  if (container && !localBinaries()) {
    // The machine has no binaries of PostgreSQL: the server of the
    // development machine runs in a container instead. The options of
    // the server are the options of the container when the container
    // does not name them itself.
    return await startPostgresContainer({
      ...container,
      port: container.port ?? options.port,
      user: container.user ?? options.user,
      password: container.password ?? options.password,
      fresh: container.fresh ?? options.fresh,
    })
  }
  const bin = binaries()
  const major = majorOf(bin)
  if (major !== null && major !== DEVELOPMENT_MAJOR && requestedMajor() === null) {
    // The suites prove the semantics of a version, and a suite that
    // runs against another major proves another version. The warning is
    // on the standard error: the standard output is the url.
    console.warn(
      `the server of the development is PostgreSQL ${major} and not ${DEVELOPMENT_MAJOR}: the suites prove another version`
    )
  }
  const dataDir = resolve(options.dataDir ?? join(process.cwd(), '.pg', 'data'))
  const socketDir = resolve(join(dataDir, '..', 'socket'))
  const port = options.port ?? (await freePort())
  const user = options.user ?? 'data'
  const password = options.password ?? 'data'

  if (options.fresh && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
  mkdirSync(socketDir, { recursive: true })

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    const init = spawnSync(
      join(bin, 'initdb'),
      ['-D', dataDir, '-U', user, '--auth-local=trust', '--auth-host=scram-sha-256', '-E', 'UTF8'],
      { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }
    )
    if (init.status !== 0) {
      throw new Error(`initdb failed: ${init.stderr}`)
    }
  } else if (major !== null) {
    // A data directory of another major is not a data directory of this
    // server: the server refuses to start on it, and the refusal of the
    // server is not the message that the developer needs.
    const installed = readFileSync(join(dataDir, 'PG_VERSION'), 'utf8').trim()
    if (installed !== String(major)) {
      throw new Error(
        `the data directory ${dataDir} is of the version ${installed} and the server is the version ${major}: remove it or start with --fresh`
      )
    }
  }

  // The server refuses a data directory that another user may read: the
  // permissions of the directory are the ones the server asks for, and
  // the machine of a developer may have given it other ones.
  chmodSync(dataDir, 0o700)

  const start = spawnSync(
    join(bin, 'pg_ctl'),
    [
      '-D',
      dataDir,
      '-l',
      join(dataDir, '..', 'server.log'),
      '-o',
      `-p ${port} -k ${socketDir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
      '-w',
      'start',
    ],
    { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }
  )
  if (start.status !== 0) {
    throw new Error(`pg_ctl failed: ${start.stderr}\n${start.stdout}`)
  }

  // The server of the working tree answers on the port of the machine:
  // the runner reaches it with a client that speaks the protocol, and
  // the client is the proof that the server accepts the connections.
  const deadline = Date.now() + 60_000
  let speaking = false
  while (!speaking && Date.now() < deadline) {
    speaking = await speaksPostgres(port, user)
    if (!speaking) await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!speaking) {
    throw new Error(`the PostgreSQL of the directory ${dataDir} did not answer on the port ${port}`)
  }

  const url = `postgres://${user}:${password}@127.0.0.1:${port}/postgres`
  // The administrator of the server of the working tree goes through
  // the socket of the server: the local connections are trusted, and
  // the password of the administrator of the server is never set.
  const adminUrl = `postgres://${user}@localhost/postgres?host=${encodeURIComponent(socketDir)}&port=${port}`
  const stop = (): void => {
    spawnSync(join(bin, 'pg_ctl'), ['-D', dataDir, '-m', 'fast', 'stop'], { encoding: 'utf8' })
  }
  return { url, port, dataDir, kind: 'local', adminUrl, stop }
}

if (import.meta.main) {
  const postgres = await startPostgres({
    ...(process.argv.includes('--fresh') ? { fresh: true } : {}),
    container: {
      name: 'platform-postgres-dev',
      role: 'dev',
      volume: 'platform-postgres-dev',
    },
  })
  console.log(postgres.url)
}
