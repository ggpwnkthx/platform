import { describe, expect, test } from 'bun:test'
import { AccessProvider, LoginError } from '../src/domains/authentication'

/**
 * The provider of the sign-in of the console.
 *
 * The console asks Access for its discovery document, and the answer
 * of the document is what tells it that Access is there. The budget of
 * the call is the budget of the caller: the readiness of the console
 * is asked by a probe of the platform that gives the console a few
 * seconds, and a call that waits longer than the probe that waits for
 * it answers nothing.
 */
describe('the discovery document of Access', () => {
  test('the document is read and kept', async () => {
    let asked = 0
    const provider = new AccessProvider({
      accessUrl: 'http://access.internal:8081',
      clientId: 'console',
      clientSecret: 'the-client-secret',
      timeoutMs: 1000,
      fetch: async () => {
        asked += 1
        return Response.json({
          issuer: 'https://access.example.com',
          authorization_endpoint: 'https://access.example.com/oauth/authorize',
        })
      },
    })
    const document = await provider.discovery()
    expect(document.issuer).toBe('https://access.example.com')
    expect(document.authorizationEndpoint).toBe('https://access.example.com/oauth/authorize')
    // The document is kept for ten minutes.
    await provider.discovery()
    expect(asked).toBe(1)
  })

  test('a call that is given a budget gives up inside it', async () => {
    const provider = new AccessProvider({
      accessUrl: 'http://access.internal:8081',
      clientId: 'console',
      clientSecret: 'the-client-secret',
      timeoutMs: 10_000,
      fetch: async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    const started = Date.now()
    await expect(provider.discovery(100)).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

/**
 * The renewal of the tokens of the console.
 *
 * The console renews the token of the caller with the refresh token of
 * the login, so the caller does not sign in again every five minutes.
 */
describe('the renewal of the tokens of the console', () => {
  test('the refresh token is exchanged for new tokens', async () => {
    let asked = ''
    const provider = new AccessProvider({
      accessUrl: 'http://access.internal:8081',
      clientId: 'console',
      clientSecret: 'the-client-secret',
      timeoutMs: 1000,
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        asked = String(init?.body ?? '')
        return Response.json({
          access_token: 'the-new-access-token',
          id_token: 'the-new-id-token',
          expires_in: 300,
          refresh_token: 'the-new-refresh-token',
        })
      },
    })
    const tokens = await provider.renew('the-refresh-token')
    expect(asked).toContain('grant_type=refresh_token')
    expect(asked).toContain('refresh_token=the-refresh-token')
    expect(tokens.accessToken).toBe('the-new-access-token')
    expect(tokens.refreshToken).toBe('the-new-refresh-token')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
  })

  test('a refusal of Access is a login error', async () => {
    const provider = new AccessProvider({
      accessUrl: 'http://access.internal:8081',
      clientId: 'console',
      clientSecret: 'the-client-secret',
      timeoutMs: 1000,
      fetch: async () =>
        Response.json(
          { error: 'invalid_grant', error_description: 'the refresh token is spent' },
          { status: 400 }
        ),
    })
    await expect(provider.renew('the-refresh-token')).rejects.toThrow(LoginError)
  })
})
