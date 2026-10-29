import { describe, expect, test } from 'bun:test'
import { claimsOf, signIn } from '../src/domains/identity'
import { CliFailure } from '../src/domains/failure'
import { FakeHttp } from './support'

/** The machine of the test: it opens the browser and answers the callback. */
function machineOf() {
  const opened: string[] = []
  let answer: { code: string; state: string } = { code: 'the-code', state: '' }
  return {
    opened,
    browser: {
      async open(url: string): Promise<void> {
        opened.push(url)
        const state = new URL(url).searchParams.get('state') ?? ''
        answer = { code: 'the-code', state }
      },
    },
    callback: {
      async start(): Promise<{
        redirectUri: string
        wait(): Promise<{ code: string; state: string }>
      }> {
        return {
          redirectUri: 'http://127.0.0.1:8765/oauth/callback',
          wait: async () => answer,
        }
      },
    },
    crypto: {
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
      sha256: (value: Uint8Array) => new Uint8Array(value.length).fill(9),
    },
  }
}

describe('the login of the caller', () => {
  test('the login asks the provider and exchanges the code for a token', async () => {
    const machine = machineOf()
    const http = new FakeHttp(FakeHttp.json(200, { access_token: 'the-token', expires_in: 300 }))
    const written: unknown[] = []
    const credential = await signIn({
      http,
      browser: machine.browser,
      callback: machine.callback,
      crypto: machine.crypto,
      credentials: {
        read: async () => null,
        write: async (value) => {
          written.push(value)
        },
        clear: async () => undefined,
      },
      accessUrl: 'https://access.example.com',
      clientId: 'the-client',
      clientSecret: 'the-secret',
      redirectUri: 'http://127.0.0.1:8765/oauth/callback',
    })
    expect(credential.accessToken).toBe('the-token')
    expect(written).toHaveLength(1)

    const authorize = new URL(machine.opened[0]!)
    expect(authorize.pathname).toBe('/oauth/authorize')
    expect(authorize.searchParams.get('client_id')).toBe('the-client')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('state')).toBeTruthy()

    const exchange = http.last
    expect(exchange.method).toBe('POST')
    expect(exchange.url).toBe('https://access.example.com/oauth/token')
    expect(exchange.headers?.authorization).toBe(
      `Basic ${Buffer.from('the-client:the-secret').toString('base64')}`
    )
    const body = new URLSearchParams(exchange.body ?? '')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toBeTruthy()
  })

  test('a provider that answers another state is refused', async () => {
    const machine = machineOf()
    machine.browser.open = async (): Promise<void> => undefined
    const http = new FakeHttp(FakeHttp.json(200, { access_token: 'the-token' }))
    try {
      await signIn({
        http,
        browser: machine.browser,
        callback: machine.callback,
        crypto: machine.crypto,
        credentials: {
          read: async () => null,
          write: async () => undefined,
          clear: async () => undefined,
        },
        accessUrl: 'https://access.example.com',
        clientId: 'the-client',
        clientSecret: 'the-secret',
        redirectUri: 'http://127.0.0.1:8765/oauth/callback',
      })
      throw new Error('the login was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).code).toBe('state_mismatch')
    }
  })

  test('the claims of the caller are read from Access', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { sub: '00u1', email: 'alice@example.test' }))
    const claims = (await claimsOf(http, 'https://access.example.com', {
      accessToken: 'the-token',
    })) as { sub: string }
    expect(claims.sub).toBe('00u1')
    expect(http.last.url).toBe('https://access.example.com/oauth/userinfo')
    expect(http.last.token).toBe('the-token')
  })
})
