import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { startTestRuntime, type TestRuntime } from '../fixtures/runtime'

/** A private key of the tests. */
function aKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey
}

let service: TestRuntime

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ISSUER: 'https://access.example.com',
    ACCESS_SIGNING_KEY: aKey(),
    ACCESS_SIGNING_KID: 'access-1',
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the provider of Access', () => {
  test('the JWKS publishes the key of the service', async () => {
    const response = await fetch(`${service.base}/oauth/jwks`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { keys: { kid: string; alg: string; n: string }[] }
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0]?.kid).toBe('access-1')
    expect(body.keys[0]?.alg).toBe('RS256')
    expect(body.keys[0]?.n).toBeTruthy()
  })

  test('the discovery document carries the issuer of the service', async () => {
    const response = await fetch(`${service.base}/.well-known/openid-configuration`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.issuer).toBe('https://access.example.com')
    expect(body.token_endpoint).toBe('https://access.example.com/oauth/token')
    expect(body.jwks_uri).toBe('https://access.example.com/oauth/jwks')
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
    expect(body.token_endpoint_auth_methods_supported).toEqual(['client_secret_basic'])
  })

  test('the userinfo without a token is refused', async () => {
    const response = await fetch(`${service.base}/oauth/userinfo`)
    expect(response.status).toBe(401)
  })

  test('the userinfo with a wrong token is refused', async () => {
    const response = await fetch(`${service.base}/oauth/userinfo`, {
      headers: { authorization: 'Bearer not-a-token' },
    })
    expect(response.status).toBe(401)
  })
})
