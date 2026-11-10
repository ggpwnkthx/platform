import { describe, expect, test } from 'bun:test'
import {
  RefreshError,
  RefreshService,
  REFRESH_SCOPE,
  REFRESH_TTL_SECONDS,
  type RefreshRecord,
  type RefreshTokenStore,
} from './refresh'

/** The store of the tests: it holds the records of the tokens. */
class Store implements RefreshTokenStore {
  readonly records = new Map<string, { record: RefreshRecord; expiresAt: number }>()
  readonly now = 1_700_000_000_000

  async put(hash: string, record: RefreshRecord, ttlSeconds: number): Promise<void> {
    this.records.set(hash, { record, expiresAt: this.now + ttlSeconds * 1000 })
  }

  async take(hash: string): Promise<RefreshRecord | null> {
    const found = this.records.get(hash)
    if (!found) return null
    this.records.delete(hash)
    if (found.expiresAt <= this.now) return null
    return found.record
  }
}

/**
 * A service of the tests.
 *
 * The principal of the tests is `the-subject`, and it is the only one
 * the store of the principals knows.
 */
function aService(store: Store): RefreshService {
  return new RefreshService({
    store,
    principals: {
      findById: async (id: string) =>
        id === 'the-subject'
          ? {
              id: 'the-subject',
              email: 'alice@acme.example',
              displayName: 'Alice',
              tenantSlug: 'acme',
              status: 'active',
            }
          : null,
    },
    tokens: {
      issueTokens: async (subject) => ({
        idToken: `id-${subject.subject}`,
        accessToken: `access-${subject.subject}`,
        expiresIn: 300,
        tokenType: 'Bearer',
      }),
    },
  })
}

/** The options of a login that asks for a refresh token. */
function aLogin() {
  return {
    clientId: 'gateway-acme',
    subject: 'the-subject',
    tenant: 'acme',
    audience: 'gateway-acme',
    scopes: ['openid', REFRESH_SCOPE],
  }
}

describe('the refresh tokens of Access', () => {
  test('a login that asks for the scope is given a token', async () => {
    const store = new Store()
    const service = aService(store)
    const token = await service.issue(aLogin())
    expect(token).toBeTruthy()
    expect(store.records.size).toBe(1)
  })

  test('a login that asks for no scope is given no token', async () => {
    const store = new Store()
    const service = aService(store)
    const token = await service.issue({ ...aLogin(), scopes: ['openid', 'groups'] })
    expect(token).toBeNull()
    expect(store.records.size).toBe(0)
  })

  test('the store holds the token under its hash, never in clear', async () => {
    const store = new Store()
    const service = aService(store)
    const token = await service.issue(aLogin())
    const held = [...store.records.values()][0]?.record
    expect(held?.subject).toBe('the-subject')
    expect(JSON.stringify([...store.records.keys()])).not.toContain(token ?? '')
  })

  test('the exchange of a token issues new tokens and a new token', async () => {
    const store = new Store()
    const service = aService(store)
    const token = await service.issue(aLogin())
    const pair = await service.exchange({ refreshToken: token ?? '', clientId: 'gateway-acme' })
    expect(pair.accessToken).toBe('access-the-subject')
    expect(pair.refreshToken).toBeTruthy()
    expect(pair.refreshToken).not.toBe(token)
  })

  test('a token is single use: the second exchange is refused', async () => {
    const store = new Store()
    const service = aService(store)
    const token = await service.issue(aLogin())
    await service.exchange({ refreshToken: token ?? '', clientId: 'gateway-acme' })
    await expect(
      service.exchange({ refreshToken: token ?? '', clientId: 'gateway-acme' })
    ).rejects.toThrow(RefreshError)
  })

  test('a token of another client is refused', async () => {
    const store = new Store()
    const service = aService(store)
    const token = await service.issue(aLogin())
    await expect(
      service.exchange({ refreshToken: token ?? '', clientId: 'gateway-other' })
    ).rejects.toThrow(/not issued to this client/)
  })

  test('a token of a principal that does not exist is refused', async () => {
    const store = new Store()
    const service = aService(store)
    // The principal is gone: the token of the login names a principal
    // that the store of the principals does not know.
    const token = await service.issue({ ...aLogin(), subject: 'the-other-subject' })
    await expect(
      service.exchange({ refreshToken: token ?? '', clientId: 'gateway-acme' })
    ).rejects.toThrow(/does not exist/)
  })

  test('a token lives twelve hours', async () => {
    const store = new Store()
    const service = aService(store)
    await service.issue(aLogin())
    const held = [...store.records.values()][0]
    expect(held?.expiresAt).toBe(store.now + REFRESH_TTL_SECONDS * 1000)
    expect(REFRESH_TTL_SECONDS).toBe(43_200)
  })
})
