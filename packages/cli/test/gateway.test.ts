import { describe, expect, test } from 'bun:test'
import {
  activeConfiguration,
  configurationHistory,
  purgeDecisions,
  revokeSessions,
  rollbackConfiguration,
  validateConfiguration,
  writeConfiguration,
} from '../src/domains/gateway'
import { CliFailure } from '../src/domains/failure'
import { FakeHttp } from './support'

/**
 * The parameters of a call to the control plane.
 *
 * @param http the transport of the call.
 */
function callOf(http: FakeHttp) {
  return { http, baseUrl: 'https://control.example.com', token: 'the-control-token' }
}

describe('the control plane of the gateway', () => {
  test('the active table is read from the control plane', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, { revision: 4, table: { version: 1, routes: [] }, warnings: [] })
    )
    const active = await activeConfiguration(callOf(http))
    expect(active.revision).toBe(4)
    expect(http.last.method).toBe('GET')
    expect(http.last.url).toBe('https://control.example.com/v1/config')
    expect(http.last.token).toBe('the-control-token')
  })

  test('a table is validated without being written', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { ok: true, errors: [], warnings: [] }))
    const validation = await validateConfiguration(callOf(http), { version: 1 })
    expect(validation.ok).toBe(true)
    expect(http.last.method).toBe('POST')
    expect(http.last.url).toBe('https://control.example.com/v1/config/validate')
    expect(http.last.body).toBe(JSON.stringify({ version: 1 }))
  })

  test('a write carries the revision it replaces', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { revision: 5 }))
    const revision = await writeConfiguration(callOf(http), { version: 1 }, 4)
    expect(revision).toBe(5)
    expect(http.last.method).toBe('PUT')
    expect(http.last.headers?.['if-match']).toBe('4')
  })

  test('a rollback writes an older revision again', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { revision: 6 }))
    const revision = await rollbackConfiguration(callOf(http), 2)
    expect(revision).toBe(6)
    expect(http.last.method).toBe('POST')
    expect(http.last.body).toBe(JSON.stringify({ revision: 2 }))
  })

  test('the history is a page', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { revisions: [] }))
    await configurationHistory(callOf(http), 10, 20)
    expect(http.last.url).toBe('https://control.example.com/v1/config/history?limit=10&offset=20')
  })

  test('the sessions of a caller are ended through the control plane', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { revoked: 3 }))
    const revoked = await revokeSessions(callOf(http), 'alice')
    expect(revoked).toBe(3)
    expect(http.last.method).toBe('DELETE')
    expect(http.last.url).toBe('https://control.example.com/v1/sessions?subject=alice')
  })

  test('the cached decisions are purged for a subject or a workspace', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { purged: 2 }))
    const purged = await purgeDecisions(callOf(http), 'alice')
    expect(purged).toBe(2)
    expect(http.last.url).toBe('https://control.example.com/v1/decisions?subject=alice')
  })

  test('purging nothing is refused', async () => {
    const http = new FakeHttp()
    try {
      await purgeDecisions(callOf(http))
      throw new Error('the purge was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).exit).toBe(2)
    }
  })
})
