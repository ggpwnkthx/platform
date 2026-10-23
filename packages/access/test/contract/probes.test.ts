import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { VERSION } from '../../src/runtime/version'

/** The runtime the probes are asked on. */
let service: TestRuntime

beforeAll(async () => {
  service = await startTestRuntime()
})

afterAll(async () => {
  await service.stop()
})

describe('the probes of the access service', () => {
  test('the health says that the process answers', async () => {
    const response = await fetch(`${service.base}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'access',
      version: VERSION,
    })
  })

  test('the readiness is ready when the database answers', async () => {
    const response = await fetch(`${service.base}/readyz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  test('the readiness is not ready when the database is down', async () => {
    await service.runtime.database.close()
    try {
      const response = await fetch(`${service.base}/readyz`)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ status: 'not-ready' })
    } finally {
      // The database is closed for the rest of the file: the other probes
      // do not need it.
      await service.runtime.database.close().catch(() => undefined)
    }
  })

  test('the readiness is draining while the service drains', async () => {
    service.runtime.setDraining(true)
    try {
      const response = await fetch(`${service.base}/readyz`)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ status: 'draining' })
    } finally {
      service.runtime.setDraining(false)
    }
  })

  test('every answer carries the identifier of the request', async () => {
    const generated = await fetch(`${service.base}/healthz`)
    expect(generated.headers.get('x-request-id')).toBeTruthy()

    const reused = await fetch(`${service.base}/healthz`, {
      headers: { 'x-request-id': 'the-request' },
    })
    expect(reused.headers.get('x-request-id')).toBe('the-request')
  })

  test('an unknown path is refused', async () => {
    const response = await fetch(`${service.base}/v1/unknown`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'not_found',
      message: 'unknown path',
    })
  })
})
