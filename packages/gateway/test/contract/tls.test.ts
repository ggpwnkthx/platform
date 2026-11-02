import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestCertificates, type TestCertificates } from '../../services/fixtures/certificates'
import { createHarness, type Harness } from '../support/contract-harness'

/**
 * The TLS of the deployment.
 *
 * The gateway terminates the TLS of the callers when it has a certificate
 * of the deployment, and the certificate comes from a file or from an
 * authority of certificates. The plain listener sends the callers of a
 * name of the certificate to the same name over TLS.
 */
let harness: Harness
let certificates: TestCertificates
let directory: string

beforeAll(async () => {
  certificates = await createTestCertificates()
  directory = await mkdtemp(join(tmpdir(), 'gateway-tls-'))
  const certPath = join(directory, 'cert.pem')
  const keyPath = join(directory, 'key.pem')
  await writeFile(certPath, certificates.serverCert)
  await writeFile(keyPath, certificates.serverKey)
  harness = await createHarness({
    routes: (context) => [
      {
        id: 'api',
        match: { host: 'api.gateway.test', path: '/{rest}' },
        upstream: context.upstreamA,
        auth: { mode: 'none' },
      },
    ],
    env: {
      GATEWAY_TLS_NAMES: 'api.gateway.test',
      GATEWAY_TLS_PORT: '0',
      GATEWAY_TLS_CERT_FILE: certPath,
      GATEWAY_TLS_KEY_FILE: keyPath,
    },
  })
})

afterAll(async () => {
  await harness.stop()
  await certificates.cleanup()
  await rm(directory, { recursive: true, force: true })
})

describe('the TLS of the deployment', () => {
  test('the gateway answers over TLS', async () => {
    const response = await fetch(`${harness.tlsUrl}/thing`, {
      headers: { host: 'api.gateway.test' },
      // The certificate of the test is signed by an authority the test
      // knows: the answer is about the TLS of the gateway, not about the
      // trust of the authority of the test.
      tls: { rejectUnauthorized: false },
    } as never)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { service: string }
    expect(body.service).toBe('upstream-a')
  })

  test('the plain listener sends the callers of a name of the certificate to TLS', async () => {
    const response = await fetch(`${harness.gatewayUrl}/thing`, {
      headers: { host: 'api.gateway.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://api.gateway.test/thing')
  })

  test('the plain listener answers the callers of another name', async () => {
    const response = await fetch(`${harness.gatewayUrl}/thing`, {
      headers: { host: 'internal.gateway.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(404)
  })
})
