import { afterAll, expect, test } from 'bun:test'
import { relayOptionsFromEnv, startRelay } from '@platform/relay'
import { relays, startup, stopRelays, tokenServer } from './fake.ts'

/** The relay: the only part of ours that answers on the network. */

const fake = await tokenServer('the.right.token')
afterAll(() => {
  stopRelays()
  fake.server.close()
})

test('only the site may open a session, and only with a startup packet', async () => {
  const guarded = startRelay({
    upstream: { host: '127.0.0.1', port: fake.port },
    port: 0,
    allowedOrigins: ['https://platform.example.com'],
  })
  relays.push(guarded)
  const site = `http://127.0.0.1:${guarded.port}/`
  expect((await fetch(site)).status).toBe(403)
  expect((await fetch(`${site}health`)).status).toBe(200)
  const relay = startRelay({
    upstream: { host: '127.0.0.1', port: fake.port },
    port: 0,
    allowedOrigins: [],
  })
  relays.push(relay)
  const closed = await new Promise<CloseEvent>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/`)
    ws.onopen = () => ws.send(new Uint8Array([0, 0, 0, 8, 4, 210, 22, 47])) // an SSLRequest
    ws.onclose = resolve
  })
  expect(closed.code).toBe(1008)
})

test('a token never crosses a network in the clear by accident', () => {
  expect(() => relayOptionsFromEnv({ RELAY_UPSTREAM: 'db.example.com:5432' })).toThrow(
    'RELAY_UPSTREAM_TLS'
  )
  expect(() =>
    relayOptionsFromEnv({
      RELAY_UPSTREAM: 'db.example.com:5432',
      RELAY_UPSTREAM_TLS: 'verify',
      RELAY_ORIGINS: 'https://a.example/, *',
    })
  ).toThrow('RELAY_ALLOW_ANY_ORIGIN')
  expect(
    relayOptionsFromEnv({
      RELAY_UPSTREAM: 'db.example.com:5432',
      RELAY_UPSTREAM_TLS: 'verify',
      RELAY_ORIGINS: 'https://a.example/',
    })
  ).toMatchObject({
    upstream: { host: 'db.example.com', port: 5432, tls: {} },
    allowedOrigins: ['https://a.example'],
    sessionsPerAddress: 0,
    sessionsPerRole: 0,
  })
})

test('an origin that is not checked is said out loud', () => {
  expect(() => relayOptionsFromEnv({ RELAY_UPSTREAM: '127.0.0.1:5432' })).toThrow('RELAY_ORIGINS')
  expect(
    relayOptionsFromEnv({ RELAY_UPSTREAM: '127.0.0.1:5432', RELAY_ALLOW_ANY_ORIGIN: '1' })
  ).toMatchObject({ allowedOrigins: [] })
  expect(
    relayOptionsFromEnv({
      RELAY_UPSTREAM: '127.0.0.1:5432',
      RELAY_ALLOW_ANY_ORIGIN: '1',
      RELAY_SESSIONS_PER_ADDRESS: '20',
      RELAY_SESSIONS_PER_ROLE: '5',
    })
  ).toMatchObject({ sessionsPerAddress: 20, sessionsPerRole: 5 })
  expect(() =>
    relayOptionsFromEnv({
      RELAY_UPSTREAM: '127.0.0.1:5432',
      RELAY_ALLOW_ANY_ORIGIN: '1',
      RELAY_SESSIONS_PER_ROLE: 'many',
    })
  ).toThrow('RELAY_SESSIONS_PER_ROLE')
})

test('the relay holds a role to the sessions it may hold', async () => {
  const relay = startRelay({
    upstream: { host: '127.0.0.1', port: fake.port },
    port: 0,
    allowedOrigins: [],
    sessionsPerRole: 1,
  })
  relays.push(relay)
  const url = `ws://127.0.0.1:${relay.port}/`
  const session = (user: string) =>
    new Promise<CloseEvent>((resolve) => {
      const ws = new WebSocket(url)
      ws.onopen = () => ws.send(startup(user))
      ws.onclose = resolve
    })
  const first = session('alice@example.com')
  await Bun.sleep(100)
  const second = await session('alice@example.com')
  expect(second.code).toBe(1008)
  first.catch(() => undefined)
})

test('the relay holds an address to the sessions it may hold', async () => {
  const relay = startRelay({
    upstream: { host: '127.0.0.1', port: fake.port },
    port: 0,
    allowedOrigins: [],
    sessionsPerAddress: 1,
  })
  relays.push(relay)
  const url = `ws://127.0.0.1:${relay.port}/`
  const first = new WebSocket(url)
  await new Promise((resolve) => {
    first.onopen = resolve
  })
  const second = new WebSocket(url)
  const refused = await new Promise<boolean>((resolve) => {
    second.onerror = () => resolve(true)
    second.onopen = () => resolve(false)
  })
  expect(refused).toBe(true)
})
