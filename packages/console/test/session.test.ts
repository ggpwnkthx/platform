import { describe, expect, test } from 'bun:test'
import { safeRedirect } from '../src/domains/authentication'
import { LoginStore, SessionStore, sign, unsign } from '../src/domains/session'

const SECRET = 'a-session-secret-that-is-long-enough-0001'
const principal = { id: 'p-1', tenant: 'acme', email: 'alice@acme.test', name: null, roles: [] }

describe('the cookies of the console', () => {
  test('a signed value reads back', () => {
    expect(unsign(sign('the-id', SECRET), SECRET)).toBe('the-id')
  })

  test('a value whose signature does not hold is no value', () => {
    const signed = sign('the-id', SECRET)
    expect(unsign(signed.replace('the-id', 'other-id'), SECRET)).toBeNull()
    expect(unsign(signed, 'another-secret-that-is-long-enough-01')).toBeNull()
    expect(unsign('no-signature', SECRET)).toBeNull()
    expect(unsign(undefined, SECRET)).toBeNull()
  })
})

describe('the sessions of the console', () => {
  test('a session lives as long as it is used, and no longer than its maximum age', () => {
    let now = 0
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 2500 }, () => now)
    const session = store.create({ principal, accessToken: 't', accessTokenExpiresAt: 300_000 })
    now = 900
    expect(store.read(session.id)?.id).toBe(session.id)
    now = 1800
    expect(store.read(session.id)?.id).toBe(session.id)
    now = 2600
    expect(store.read(session.id)).toBeNull()
  })

  test('an idle session ends', () => {
    let now = 0
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 10_000 }, () => now)
    const session = store.create({ principal, accessToken: 't', accessTokenExpiresAt: 0 })
    now = 1000
    expect(store.read(session.id)).toBeNull()
  })

  test('the cookie never outlives the session', () => {
    let now = 0
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 1500 }, () => now)
    const session = store.create({ principal, accessToken: 't', accessTokenExpiresAt: 0 })
    now = 800
    store.read(session.id)
    expect(store.remainingMs(session)).toBe(700)
  })

  test('a destroyed session is gone', () => {
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 1000 })
    const session = store.create({ principal, accessToken: 't', accessTokenExpiresAt: 0 })
    store.destroy(session.id)
    expect(store.read(session.id)).toBeNull()
  })
})

describe('the logins in flight', () => {
  test('a login is taken once', () => {
    const logins = new LoginStore()
    logins.begin({ state: 's', nonce: 'n', verifier: 'v', redirect: '/' })
    expect(logins.take('s')?.nonce).toBe('n')
    expect(logins.take('s')).toBeNull()
  })

  test('a login expires', () => {
    let now = 0
    const logins = new LoginStore(() => now, 100)
    logins.begin({ state: 's', nonce: 'n', verifier: 'v', redirect: '/' })
    now = 100
    expect(logins.take('s')).toBeNull()
  })
})

describe('the target of a login', () => {
  test('it is a path of the console', () => {
    expect(safeRedirect('/workspaces?x=1')).toBe('/workspaces?x=1')
    expect(safeRedirect('https://evil.example')).toBe('/')
    expect(safeRedirect('//evil.example')).toBe('/')
    expect(safeRedirect('/\\evil.example')).toBe('/')
    expect(safeRedirect('/auth/login')).toBe('/')
    expect(safeRedirect(undefined)).toBe('/')
  })
})
