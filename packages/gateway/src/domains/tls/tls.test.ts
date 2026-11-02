import { describe, expect, test } from 'bun:test'
import {
  coversName,
  expiresWithin,
  MemoryCertificateStore,
  parseCertificate,
  type DeploymentCertificate,
} from './index'

/**
 * The certificate of the deployment.
 *
 * The certificate is a secret of the deployment: it lives in the shared
 * state, the replicas of the deployment share it, and one of them obtains
 * it.
 */
const certificate: DeploymentCertificate = {
  key: 'the key',
  cert: 'the certificate',
  names: ['api.example.com', 'Access.Example.com'],
  expiresAt: 1_000_000,
}

describe('the certificate of the deployment', () => {
  test('a certificate is read out of the shared state', () => {
    expect(parseCertificate(JSON.stringify(certificate))).toEqual(certificate)
  })

  test('a value that is not a certificate is no certificate', () => {
    expect(parseCertificate(null)).toBeNull()
    expect(parseCertificate('')).toBeNull()
    expect(parseCertificate('not json')).toBeNull()
    expect(parseCertificate(JSON.stringify({ key: 'the key' }))).toBeNull()
  })

  test('a certificate that expires soon is renewed', () => {
    const now = Date.UTC(2029, 0, 1)
    const soon: DeploymentCertificate = {
      ...certificate,
      expiresAt: now + 10 * 24 * 60 * 60 * 1000,
    }
    expect(expiresWithin(soon, 30, now)).toBe(true)
    expect(expiresWithin(soon, 1, now)).toBe(false)
  })

  test('a certificate covers the names it names', () => {
    expect(coversName(certificate, 'api.example.com')).toBe(true)
    expect(coversName(certificate, 'API.example.com')).toBe(true)
    expect(coversName(certificate, 'console.example.com')).toBe(false)
  })
})

describe('the store of the certificate', () => {
  test('the challenge of the authority is published and withdrawn', async () => {
    const store = new MemoryCertificateStore()
    expect(await store.challenge('the-token')).toBeNull()
    await store.putChallenge('the-token', 'the-key-authorization', 60_000)
    expect(await store.challenge('the-token')).toBe('the-key-authorization')
    await store.removeChallenge('the-token')
    expect(await store.challenge('the-token')).toBeNull()
  })

  test('the lease of the renewal is taken by one replica at a time', async () => {
    const store = new MemoryCertificateStore()
    expect(await store.claimLease(60_000)).toBe(true)
    expect(await store.claimLease(60_000)).toBe(false)
    await store.releaseLease()
    expect(await store.claimLease(60_000)).toBe(true)
  })

  test('the certificate of the deployment is written and read', async () => {
    const store = new MemoryCertificateStore()
    expect(await store.read()).toBeNull()
    await store.write(certificate)
    expect(await store.read()).toEqual(certificate)
  })
})
