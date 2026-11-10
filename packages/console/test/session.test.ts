import { describe, expect, test } from 'bun:test'
import { safeRedirect } from '../src/domains/authentication'
import {
  LoginStore,
  needsRenewal,
  RENEWAL_MARGIN_MS,
  SessionStore,
  sign,
  unsign,
} from '../src/domains/session'

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

  test('a renewal replaces the tokens of the session', async () => {
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 10_000 })
    const session = store.create({
      principal,
      accessToken: 'the-first-token',
      accessTokenExpiresAt: 1000,
      refreshToken: 'the-first-refresh',
    })
    await store.renew(session, async () => ({
      accessToken: 'the-second-token',
      accessTokenExpiresAt: 2000,
      refreshToken: 'the-second-refresh',
    }))
    expect(session.accessToken).toBe('the-second-token')
    expect(session.accessTokenExpiresAt).toBe(2000)
    expect(session.refreshToken).toBe('the-second-refresh')
  })

  test('two renewals of the same session run one at a time', async () => {
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 10_000 })
    const session = store.create({
      principal,
      accessToken: 'the-first-token',
      accessTokenExpiresAt: 1000,
      refreshToken: 'the-first-refresh',
    })
    let calls = 0
    const renew = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return {
        accessToken: `the-token-${calls}`,
        accessTokenExpiresAt: 2000,
        refreshToken: `the-refresh-${calls}`,
      }
    }
    await Promise.all([store.renew(session, renew), store.renew(session, renew)])
    // The refresh token of Access is single use: the session is renewed
    // once, and the second caller waits for the result.
    expect(calls).toBe(1)
    expect(session.accessToken).toBe('the-token-1')
  })
})

describe('the renewal of the tokens of a session', () => {
  test('a token that expires soon is renewed', () => {
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 10_000 })
    const session = store.create({
      principal,
      accessToken: 't',
      accessTokenExpiresAt: 100_000,
      refreshToken: 'r',
    })
    expect(needsRenewal(session, 100_000 - RENEWAL_MARGIN_MS - 1)).toBe(false)
    expect(needsRenewal(session, 100_000 - RENEWAL_MARGIN_MS)).toBe(true)
  })

  test('a session that holds no refresh token is not renewed', () => {
    const store = new SessionStore({ ttlMs: 1000, maxAgeMs: 10_000 })
    const session = store.create({ principal, accessToken: 't', accessTokenExpiresAt: 100_000 })
    expect(needsRenewal(session, 100_000)).toBe(false)
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
